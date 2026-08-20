import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ContactsService } from '../../crm/contacts/contacts.service';

const inputSchema = z.object({ search: z.string().optional() });

@Injectable()
export class SearchContactsTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'search_contacts',
    description:
      'Recherche des contacts (clients/prospects) par nom, email ou entreprise.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Terme de recherche libre' },
      },
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
    const { data } = await this.contactsService.list(organizationId, {
      page: 1,
      limit: 10,
      search: input.search,
    });
    return data.map((c) => ({
      id: c.id as string,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      email: c.email,
      phone: c.phone,
    }));
  }
}
