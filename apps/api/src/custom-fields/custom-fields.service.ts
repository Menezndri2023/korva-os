import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
} from '@korva/validation';
import type { CustomFieldEntity, CustomFieldValues } from '@korva/types';
import { CustomFieldsRepository } from './custom-fields.repository';
import { CustomFieldDocument } from './schemas/custom-field.schema';

interface MongoDuplicateKeyError {
  code: number;
}

function isDuplicateKeyError(error: unknown): error is MongoDuplicateKeyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as MongoDuplicateKeyError).code === 11000
  );
}

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly customFieldsRepository: CustomFieldsRepository,
  ) {}

  async create(
    organizationId: string,
    input: CreateCustomFieldInput,
  ): Promise<CustomFieldDocument> {
    try {
      return await this.customFieldsRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        ...input,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'CUSTOM_FIELD_KEY_TAKEN',
          message: `A custom field with key "${input.key}" already exists for ${input.entity}`,
        });
      }
      throw error;
    }
  }

  list(
    organizationId: string,
    entity: CustomFieldEntity,
  ): Promise<CustomFieldDocument[]> {
    return this.customFieldsRepository.findByOrganizationAndEntity(
      organizationId,
      entity,
    );
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateCustomFieldInput,
  ): Promise<CustomFieldDocument> {
    const updated = await this.customFieldsRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'CUSTOM_FIELD_NOT_FOUND',
        message: 'Custom field not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const deleted = await this.customFieldsRepository.delete(
      organizationId,
      id,
    );
    if (!deleted) {
      throw new NotFoundException({
        code: 'CUSTOM_FIELD_NOT_FOUND',
        message: 'Custom field not found',
      });
    }
  }

  /**
   * Validates `values` against the custom fields defined for `entity` in this organization:
   * rejects unknown keys, checks required fields are present, and does a light type check.
   * Returns the (possibly narrower) validated value map to persist.
   */
  async validateValues(
    organizationId: string,
    entity: CustomFieldEntity,
    values: CustomFieldValues | undefined,
  ): Promise<CustomFieldValues> {
    const definitions = await this.list(organizationId, entity);
    const input = values ?? {};

    const unknownKeys = Object.keys(input).filter(
      (key) => !definitions.some((d) => d.key === key),
    );
    if (unknownKeys.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_CUSTOM_FIELD',
        message: `Unknown custom field(s): ${unknownKeys.join(', ')}`,
      });
    }

    const result: CustomFieldValues = {};
    for (const field of definitions) {
      const value = input[field.key];

      if (value === undefined || value === null) {
        if (field.required) {
          throw new BadRequestException({
            code: 'CUSTOM_FIELD_REQUIRED',
            message: `Custom field "${field.key}" is required`,
          });
        }
        continue;
      }

      this.assertType(field.key, field.type, field.options, value);
      result[field.key] = value;
    }

    return result;
  }

  private assertType(
    key: string,
    type: CustomFieldDocument['type'],
    options: string[] | undefined,
    value: unknown,
  ): void {
    const fail = () => {
      throw new BadRequestException({
        code: 'CUSTOM_FIELD_TYPE_MISMATCH',
        message: `Custom field "${key}" expects a value of type ${type}`,
      });
    };

    switch (type) {
      case 'text':
      case 'email':
      case 'phone':
      case 'url':
        if (typeof value !== 'string') fail();
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) fail();
        break;
      case 'boolean':
        if (typeof value !== 'boolean') fail();
        break;
      case 'date':
      case 'datetime':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
          fail();
        break;
      case 'select':
        if (typeof value !== 'string' || (options && !options.includes(value)))
          fail();
        break;
      case 'multiselect':
        if (
          !Array.isArray(value) ||
          !value.every(
            (v) => typeof v === 'string' && (!options || options.includes(v)),
          )
        ) {
          fail();
        }
        break;
    }
  }
}
