import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@korva/validation';
import { CategoriesRepository } from './categories.repository';
import { CategoryReferencesRepository } from './category-references.repository';
import { CategoryDocument } from './schemas/category.schema';
import { AuditService } from '../../audit/audit.service';

/**
 * Category is a first-class, independently managed entity — own collection, its own CRUD, its
 * own delete-protection — closing the gap the audit found (no Category schema/controller/
 * service existed; Offer.categories was the only place a "category" was represented at all, as
 * an unvalidated free-text string[]).
 *
 * Offer.categories itself is deliberately left untouched (still free-text string[], not
 * switched to an array of Category ids): the existing catalog e2e test creates an offer with
 * categories: ['clothing'] — a plain label with no corresponding Category document — and
 * createOfferSchema (packages/validation/src/catalog.ts) has always accepted arbitrary strings
 * there. Requiring Offer.categories to reference real Category ids would be a breaking
 * validation change for every existing caller, which "add the missing entity" does not ask for
 * and "never break existing tests" forbids. Delete-protection (see
 * CategoryReferencesRepository) therefore matches Offers by the Category's name, the same
 * free-text value Offer.categories already stores — documented as a limitation (renaming a
 * Category does not relabel Offers already referencing its old name), not silently glossed over.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoriesRepository: CategoriesRepository,
    private readonly categoryReferencesRepository: CategoryReferencesRepository,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateCategoryInput,
  ): Promise<CategoryDocument> {
    const existing = await this.categoriesRepository.findByName(
      organizationId,
      input.name,
    );
    if (existing) {
      throw new ConflictException({
        code: 'CATEGORY_EXISTS',
        message: `Category "${input.name}" already exists`,
      });
    }

    const category = await this.categoriesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      description: input.description,
      attributeKeys: input.attributeKeys,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'category',
      entityId: category.id as string,
    });

    return category;
  }

  async getById(organizationId: string, id: string): Promise<CategoryDocument> {
    const category = await this.categoriesRepository.findById(
      organizationId,
      id,
    );
    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
    return category;
  }

  list(organizationId: string): Promise<CategoryDocument[]> {
    return this.categoriesRepository.findAllForOrganization(organizationId);
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryDocument> {
    if (input.name) {
      const existing = await this.categoriesRepository.findByName(
        organizationId,
        input.name,
      );
      if (existing && (existing.id as string) !== id) {
        throw new ConflictException({
          code: 'CATEGORY_EXISTS',
          message: `Category "${input.name}" already exists`,
        });
      }
    }

    const updated = await this.categoriesRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'category',
      entityId: id,
    });

    return updated;
  }

  async delete(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    const category = await this.getById(organizationId, id);

    const isReferenced =
      await this.categoryReferencesRepository.isReferencedByName(
        organizationId,
        category.name,
      );
    if (isReferenced) {
      throw new ConflictException({
        code: 'CATEGORY_IN_USE',
        message:
          'This category is still referenced by one or more offers and cannot be deleted',
      });
    }

    const deleted = await this.categoriesRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'DELETE',
      entity: 'category',
      entityId: id,
    });
  }
}
