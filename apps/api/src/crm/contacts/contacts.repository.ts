import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Contact, ContactDocument } from './schemas/contact.schema';

export interface FindContactsOptions {
  page: number;
  limit: number;
  search?: string;
  tag?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
}

@Injectable()
export class ContactsRepository {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  create(data: Partial<Contact>): Promise<ContactDocument> {
    return this.contactModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ContactDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.contactModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findByEmail(
    organizationId: string,
    email: string,
  ): Promise<ContactDocument | null> {
    return this.contactModel
      .findOne({ organizationId: new Types.ObjectId(organizationId), email })
      .exec();
  }

  existsById(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(false);
    return this.contactModel
      .exists({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .then((res) => Boolean(res));
  }

  async findAll(
    organizationId: string,
    options: FindContactsOptions,
  ): Promise<Paginated<ContactDocument>> {
    const filter: FilterQuery<Contact> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.tag) filter.tags = options.tag;
    if (options.search) filter.$text = { $search: options.search };

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.contactModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.contactModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Contact>,
    session?: ClientSession,
  ): Promise<ContactDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.contactModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true, session },
      )
      .exec();
  }

  async delete(
    organizationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.contactModel
      .deleteOne(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { session },
      )
      .exec();
    return res.deletedCount > 0;
  }

  /**
   * Groups contacts sharing the same email or the same phone within the organization — the
   * two identifiers a real duplicate ("customer called in twice, staff typed it in fresh both
   * times") is actually likely to share. Contacts with neither set never group (an empty
   * string/undefined would otherwise "match" every other contact missing that field too).
   * Backs the merge feature's "find candidates" step — this only ever suggests, the actual
   * merge decision (and which side is primary) stays a human call.
   */
  async findDuplicateGroups(
    organizationId: string,
  ): Promise<
    { field: 'email' | 'phone'; value: string; contacts: ContactDocument[] }[]
  > {
    const orgObjectId = new Types.ObjectId(organizationId);

    async function groupsFor(
      model: Model<ContactDocument>,
      field: 'email' | 'phone',
    ): Promise<
      { field: 'email' | 'phone'; value: string; ids: Types.ObjectId[] }[]
    > {
      const rows = await model.aggregate<{
        _id: string;
        ids: Types.ObjectId[];
      }>([
        {
          $match: {
            organizationId: orgObjectId,
            [field]: { $exists: true, $nin: [null, ''] },
          },
        },
        { $group: { _id: `$${field}`, ids: { $push: '$_id' } } },
        { $match: { $expr: { $gt: [{ $size: '$ids' }, 1] } } },
      ]);
      return rows.map((row) => ({ field, value: row._id, ids: row.ids }));
    }

    const [emailGroups, phoneGroups] = await Promise.all([
      groupsFor(this.contactModel, 'email'),
      groupsFor(this.contactModel, 'phone'),
    ]);

    const allIds = [...emailGroups, ...phoneGroups].flatMap((g) => g.ids);
    const contacts = await this.contactModel
      .find({ _id: { $in: allIds } })
      .exec();
    const contactById = new Map<string, ContactDocument>(
      contacts.map((c) => [c.id as string, c]),
    );

    return [...emailGroups, ...phoneGroups].map((group) => ({
      field: group.field,
      value: group.value,
      contacts: group.ids
        .map((id) => contactById.get(id.toString()))
        .filter((c): c is ContactDocument => c != null),
    }));
  }

  /**
   * Coarse, cheap pre-filter for CustomerInactivitySchedulerService's sweep: contacts that
   * COULD possibly be past the inactivity threshold (old enough, and not already notified
   * recently) — the precise check (real last-activity across other modules vs this contact's
   * own `inactiveNotifiedAt`) happens in the scheduler itself once it has fetched that activity.
   * Global, not organization-scoped, same shape as QuotesRepository.findExpirable.
   */
  findPotentiallyInactive(
    thresholdDate: Date,
    limit = 200,
  ): Promise<ContactDocument[]> {
    return this.contactModel
      .find({
        createdAt: { $lt: thresholdDate },
        $or: [
          { inactiveNotifiedAt: { $exists: false } },
          { inactiveNotifiedAt: { $lt: thresholdDate } },
        ],
      })
      .limit(limit)
      .exec();
  }

  /**
   * Atomically claims this contact's current inactivity episode, guarded so a concurrent sweep
   * tick (another API instance) can't double-publish: only succeeds if this contact hasn't
   * already been notified for an episode at least as recent as `lastActivityAt`. Mirrors
   * QuotesRepository.expireIfEligible's "re-verify the guard in the same atomic write" pattern.
   */
  async claimInactivity(
    organizationId: string,
    id: string,
    lastActivityAt: Date,
    notifiedAt: Date,
  ): Promise<boolean> {
    const res = await this.contactModel
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          $or: [
            { inactiveNotifiedAt: { $exists: false } },
            { inactiveNotifiedAt: { $lt: lastActivityAt } },
          ],
        },
        { inactiveNotifiedAt: notifiedAt },
      )
      .exec();
    return res.modifiedCount > 0;
  }
}
