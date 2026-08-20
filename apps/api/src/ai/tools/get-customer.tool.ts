import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ContactsService } from '../../crm/contacts/contacts.service';

const inputSchema = z.object({ contactId: z.string().min(1) });

@Injectable()
export class GetCustomerTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'get_customer',
    description:
      "Récupère les détails complets d'un contact/client par son id.",
    inputSchema: {
      type: 'object',
      properties: { contactId: { type: 'string' } },
      required: ['contactId'],
    },
  };
  readonly requiredPermission = 'contacts.read' as const;
  readonly auditEntity = 'contact';

  constructor(private readonly contactsService: ContactsService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const contact = await this.contactsService.getById(
      organizationId,
      input.contactId,
    );
    return {
      id: contact.id as string,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      tags: contact.tags,
    };
  }
}
