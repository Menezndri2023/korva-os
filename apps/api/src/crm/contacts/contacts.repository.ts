import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
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
  ): Promise<ContactDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.contactModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.contactModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}
