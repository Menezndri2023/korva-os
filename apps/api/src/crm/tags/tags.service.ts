import { ConflictException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateTagInput } from '@korva/validation';
import { TagsRepository } from './tags.repository';
import { TagDocument } from './schemas/tag.schema';

@Injectable()
export class TagsService {
  constructor(private readonly tagsRepository: TagsRepository) {}

  async create(
    organizationId: string,
    input: CreateTagInput,
  ): Promise<TagDocument> {
    const existing = await this.tagsRepository.findByName(
      organizationId,
      input.name,
    );
    if (existing) {
      throw new ConflictException({
        code: 'TAG_EXISTS',
        message: `Tag "${input.name}" already exists`,
      });
    }
    return this.tagsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      color: input.color,
    });
  }

  list(organizationId: string): Promise<TagDocument[]> {
    return this.tagsRepository.findAllForOrganization(organizationId);
  }
}
