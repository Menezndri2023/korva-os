import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateApiKeyInput } from '@korva/validation';
import type { ApiKeyDocument } from '../schemas/api-key.schema';
import { ApiKeysRepository } from './api-keys.repository';
import { generateApiKey } from './api-key-generator.util';
import { RolesService } from '../roles/roles.service';
import { AuditService } from '../../audit/audit.service';

/**
 * CRUD + rotation for org-scoped server-to-server API keys (see ApiKey's schema doc for the
 * storage/hashing posture, and ApiKeyGuard for how a presented key is authenticated).
 *
 * Every key is tied to an existing Role of the calling organization — deliberately reusing the
 * exact same RBAC model memberships use (Role.permissions) rather than inventing a parallel
 * "scopes" taxonomy: a "read-only" key is just one issued against a role whose permission list
 * only contains `*.read` permissions (e.g. STAFF), a "full-access" key one issued against
 * OWNER/ADMIN.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly apiKeysRepository: ApiKeysRepository,
    private readonly rolesService: RolesService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    actorUserId: string,
    input: CreateApiKeyInput,
  ) {
    const role = await this.rolesService.getRoleById(input.roleId);
    if (!role || role.organizationId.toString() !== organizationId) {
      throw new BadRequestException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }

    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      expiresAt = new Date(input.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException({
          code: 'INVALID_EXPIRATION',
          message: 'expiresAt must be in the future',
        });
      }
    }

    const generated = generateApiKey();
    const apiKey = await this.apiKeysRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      keyHash: generated.hash,
      keyPrefix: generated.displayPrefix,
      roleId: new Types.ObjectId(input.roleId),
      createdByUserId: new Types.ObjectId(actorUserId),
      expiresAt,
    });

    // Metadata never includes the hash or the plaintext key — see ApiKey's schema doc and
    // ApiKeyGuard's class doc.
    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'SETTINGS_CHANGE',
      entity: 'api_key',
      entityId: apiKey.id as string,
      metadata: {
        event: 'created',
        name: apiKey.name,
        prefix: apiKey.keyPrefix,
        roleId: input.roleId,
      },
    });

    return withPlaintext(apiKey, generated.plaintext);
  }

  list(organizationId: string): Promise<ApiKeyDocument[]> {
    return this.apiKeysRepository.findByOrganization(organizationId);
  }

  async revoke(organizationId: string, actorUserId: string, id: string) {
    const apiKey = await this.apiKeysRepository.findByIdForOrganization(
      id,
      organizationId,
    );
    if (!apiKey) {
      throw new NotFoundException({
        code: 'API_KEY_NOT_FOUND',
        message: 'API key not found',
      });
    }

    if (!apiKey.revokedAt) {
      await this.apiKeysRepository.revoke(id);

      await this.auditService.record({
        organizationId,
        userId: actorUserId,
        action: 'SETTINGS_CHANGE',
        entity: 'api_key',
        entityId: id,
        metadata: {
          event: 'revoked',
          name: apiKey.name,
          prefix: apiKey.keyPrefix,
        },
      });
    }

    return { id: apiKey.id as string, revokedAt: true };
  }

  /**
   * Revokes the existing key and issues a brand new one carrying the same name/role/expiry —
   * the old plaintext stops authenticating immediately (its row is marked `revokedAt`), the new
   * plaintext is returned exactly once, same as `create`. Implemented as a single endpoint
   * rather than two (revoke + create) so a caller can never end up in the gap state of having
   * revoked their only key without yet having a replacement.
   */
  async rotate(organizationId: string, actorUserId: string, id: string) {
    const existing = await this.apiKeysRepository.findByIdForOrganization(
      id,
      organizationId,
    );
    if (!existing) {
      throw new NotFoundException({
        code: 'API_KEY_NOT_FOUND',
        message: 'API key not found',
      });
    }
    if (existing.revokedAt) {
      throw new ForbiddenException({
        code: 'API_KEY_REVOKED',
        message: 'Cannot rotate an already-revoked API key',
      });
    }

    const generated = generateApiKey();
    const rotated = await this.apiKeysRepository.create({
      organizationId: existing.organizationId,
      name: existing.name,
      keyHash: generated.hash,
      keyPrefix: generated.displayPrefix,
      roleId: existing.roleId,
      createdByUserId: new Types.ObjectId(actorUserId),
      expiresAt: existing.expiresAt,
      rotatedFromKeyId: existing._id,
    });

    await this.apiKeysRepository.revoke(id);

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'SETTINGS_CHANGE',
      entity: 'api_key',
      entityId: rotated.id as string,
      metadata: {
        event: 'rotated',
        name: rotated.name,
        prefix: rotated.keyPrefix,
        rotatedFromKeyId: id,
      },
    });

    return withPlaintext(rotated, generated.plaintext);
  }
}

/** `apiKey.toJSON()` runs the schema's idToJson transform (id + timestamps, no keyHash — it was
 *  never loaded, being `select: false`); `key` is layered on top only for this one response. */
function withPlaintext(apiKey: ApiKeyDocument, plaintext: string) {
  return { ...apiKey.toJSON(), key: plaintext };
}
