import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { ResourcesService } from '../../booking/resources/resources.service';
import { OrganizationsService } from '../../organizations/organizations.service';

const inputSchema = z.object({});

/**
 * What can be booked — team members, rooms, tables, equipment — with their ids. Without it the
 * model had no way to learn a resourceId and invented one, so every availability check and
 * booking failed ("Resource not found"), as seen with a real model on 2026-10-23.
 */
@Injectable()
export class ListResourcesTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'list_resources',
    description:
      "Liste ce qui peut être réservé (membres de l'équipe, salles, tables, chambres, matériel) avec leur id. À appeler avant get_availability ou create_booking pour obtenir resourceId.",
    inputSchema: { type: 'object', properties: {} },
  };
  readonly requiredPermission = 'bookings.read' as const;
  readonly auditEntity = 'resource';

  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw ?? {});
  }

  async execute(organizationId: string) {
    // Same guarantee as the Resources page: a business that never set anyone up still has one.
    const organization =
      await this.organizationsService.getById(organizationId);
    await this.resourcesService.ensureDefaultResource(
      organizationId,
      organization.name,
    );
    const resources = await this.resourcesService.list(organizationId, true);
    return resources.map((resource) => ({
      id: resource.id as string,
      name: resource.name,
      type: resource.type,
      capacity: resource.capacity,
    }));
  }
}
