import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './schemas/organization.schema';

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  create(data: Partial<Organization>): Promise<OrganizationDocument> {
    return this.organizationModel.create(data);
  }

  findById(id: string): Promise<OrganizationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.organizationModel.findById(id).exec();
  }

  findBySlug(slug: string): Promise<OrganizationDocument | null> {
    return this.organizationModel.findOne({ slug }).exec();
  }

  /** Phase E3 — used both by OrganizationsService.update's uniqueness check and by
   *  PublicSitesController#resolveDomain (apps/storefront's custom-domain middleware). */
  findByCustomDomain(
    customDomain: string,
  ): Promise<OrganizationDocument | null> {
    return this.organizationModel
      .findOne({ customDomain: customDomain.toLowerCase() })
      .exec();
  }

  findByIds(ids: string[]): Promise<OrganizationDocument[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    return this.organizationModel.find({ _id: { $in: objectIds } }).exec();
  }

  async update(
    id: string,
    data: Partial<Organization>,
  ): Promise<OrganizationDocument | null> {
    return this.organizationModel
      .findByIdAndUpdate(id, data, { new: true })
      .exec();
  }

  countBySlugPrefix(prefix: string): Promise<number> {
    return this.organizationModel
      .countDocuments({ slug: new RegExp(`^${prefix}(-\\d+)?$`) })
      .exec();
  }

  /** Phase E4 (docs/KORVA_OS_V2_AUDIT.md §2.6) — the storefront's sitemap.ts has no way to
   *  enumerate tenant slugs today; this is the minimal, unauthenticated-safe projection it
   *  needs (slug + freshness only, never the full organization document). */
  /** Sites that answer: website on, not suspended (a suspended site is offline). */
  async findWebsiteEnabledSlugs(): Promise<
    {
      _id: Types.ObjectId;
      slug: string;
      updatedAt: Date;
      enabledModules: string[];
    }[]
  > {
    const docs = await this.organizationModel
      .find(
        { enabledModules: 'website', suspendedAt: { $exists: false } },
        { slug: 1, updatedAt: 1, enabledModules: 1 },
      )
      .lean<
        {
          _id: Types.ObjectId;
          slug: string;
          updatedAt: Date;
          enabledModules: string[];
        }[]
      >()
      .exec();
    return docs;
  }
}
