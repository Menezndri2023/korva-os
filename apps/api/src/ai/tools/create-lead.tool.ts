import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { LeadsService } from '../../crm/leads/leads.service';
import { NotesService } from '../../crm/notes/notes.service';

const inputSchema = z
  .object({
    contactId: z.string().optional(),
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    phone: z.string().min(1).max(40).optional(),
    email: z.string().email().optional(),
    source: z.string().max(120).optional(),
    interest: z.string().max(2000).optional(),
  })
  .refine((input) => input.contactId || input.firstName || input.lastName, {
    message: 'Donne contactId (search_contacts) ou au moins un nom.',
  });
type Input = z.infer<typeof inputSchema>;

/**
 * A prospect — someone interested, not yet a customer: an agency's buyer or tenant, an
 * artisan's request for a quote, a training centre's company asking for a session. Without it
 * a real model asked to "add a prospect" created a customer and a task instead, and went looking
 * for a tool that does not exist.
 */
@Injectable()
export class CreateLeadTool implements AiTool<Input> {
  readonly definition = {
    name: 'create_lead',
    description:
      "Enregistre un prospect (personne intéressée, pas encore cliente). Donne contactId s'il existe déjà (search_contacts), sinon son nom et son téléphone ou e-mail. interest : ce qui l'intéresse (un bien, une prestation, un devis).",
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        source: {
          type: 'string',
          description: 'Ex. WhatsApp, téléphone, site, recommandation',
        },
        interest: {
          type: 'string',
          description: 'Ce qui l’intéresse, en une phrase',
        },
      },
    },
  };
  readonly requiredPermission = 'leads.create' as const;
  readonly auditEntity = 'lead';

  constructor(
    private readonly contactsService: ContactsService,
    private readonly leadsService: LeadsService,
    private readonly notesService: NotesService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw ?? {});
  }

  async execute(organizationId: string, userId: string, input: Input) {
    const contactId =
      input.contactId ??
      ((
        await this.contactsService.create(organizationId, userId, {
          type: 'person',
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email,
          tags: ['prospect'],
        })
      ).id as string);
    const lead = await this.leadsService.create(organizationId, userId, {
      contactId,
      source: input.source,
    });
    if (input.interest) {
      await this.notesService.create(organizationId, userId, {
        entity: 'lead',
        entityId: lead.id as string,
        content: input.interest,
      });
    }
    return { leadId: lead.id as string, contactId, status: lead.status };
  }
}
