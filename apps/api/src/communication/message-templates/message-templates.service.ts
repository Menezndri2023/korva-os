import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateMessageTemplateInput,
  UpdateMessageTemplateInput,
} from '@korva/validation';
import { MessageTemplatesRepository } from './message-templates.repository';
import { MessageTemplateDocument } from './schemas/message-template.schema';

@Injectable()
export class MessageTemplatesService {
  constructor(
    private readonly messageTemplatesRepository: MessageTemplatesRepository,
  ) {}

  create(
    organizationId: string,
    input: CreateMessageTemplateInput,
  ): Promise<MessageTemplateDocument> {
    return this.messageTemplatesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
    });
  }

  list(organizationId: string): Promise<MessageTemplateDocument[]> {
    return this.messageTemplatesRepository.findAll(organizationId);
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<MessageTemplateDocument> {
    const template = await this.messageTemplatesRepository.findById(
      organizationId,
      id,
    );
    if (!template) {
      throw new NotFoundException({
        code: 'MESSAGE_TEMPLATE_NOT_FOUND',
        message: 'Message template not found',
      });
    }
    return template;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateMessageTemplateInput,
  ): Promise<MessageTemplateDocument> {
    const updated = await this.messageTemplatesRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'MESSAGE_TEMPLATE_NOT_FOUND',
        message: 'Message template not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const deleted = await this.messageTemplatesRepository.delete(
      organizationId,
      id,
    );
    if (!deleted) {
      throw new NotFoundException({
        code: 'MESSAGE_TEMPLATE_NOT_FOUND',
        message: 'Message template not found',
      });
    }
  }
}
