import {
  createContactSchema,
  type CreateContactInput,
} from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ContactsService } from '../../crm/contacts/contacts.service';

@Injectable()
export class CreateCustomerTool implements AiTool<CreateContactInput> {
  readonly definition = {
    name: 'create_customer',
    description: 'Crée un nouveau contact/client.',
    inputSchema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        company: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  };
  readonly requiredPermission = 'contacts.create' as const;
  readonly auditEntity = 'contact';

  constructor(private readonly contactsService: ContactsService) {}

  parseInput(raw: unknown) {
    return createContactSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: CreateContactInput,
  ) {
    const contact = await this.contactsService.create(
      organizationId,
      userId,
      input,
    );
    return {
      id: contact.id as string,
      firstName: contact.firstName,
      lastName: contact.lastName,
    };
  }
}
