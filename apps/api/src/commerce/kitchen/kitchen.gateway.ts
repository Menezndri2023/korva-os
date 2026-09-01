import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { MembershipsService } from '../../identity/memberships/memberships.service';

/**
 * Push-only channel: a connected client never sends business data over the socket, it only
 * authenticates once on connect (JWT + claimed organizationId, exactly like TenantGuard's own
 * "the header is a hint, never a bypass" rule — resolveTenantContext is what actually decides
 * whether this connection may join that org's room) and then passively receives a bare
 * `kitchen.changed` signal whenever anything relevant happens. All real mutations (advancing a
 * ticket) still go through the ordinary REST+RBAC-guarded HTTP endpoints — the socket is never
 * a second, unguarded path to change state. This is this codebase's first WebSocket gateway;
 * see KitchenTicketsService for the one thing it's used for.
 */
@WebSocketGateway({
  namespace: '/kitchen',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  },
})
export class KitchenGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(KitchenGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      const organizationId = client.handshake.auth?.organizationId as
        string | undefined;
      if (!token || !organizationId) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      const tenant = await this.membershipsService.resolveTenantContext(
        payload.sub,
        organizationId,
      );
      if (!tenant) {
        client.disconnect(true);
        return;
      }

      await client.join(this.room(organizationId));
    } catch (error) {
      this.logger.debug(`Rejected kitchen socket connection: ${String(error)}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Nothing to clean up — room membership is torn down automatically by socket.io.
  }

  private room(organizationId: string): string {
    return `org:${organizationId}`;
  }

  /** The only outbound message this gateway ever sends — a bare signal, not a payload, so the
   *  client and server never need to keep two copies of the same data in sync (see this class's
   *  own doc comment). The dashboard just refetches the ticket list on receipt. */
  broadcastChange(organizationId: string): void {
    this.server.to(this.room(organizationId)).emit('kitchen.changed');
  }
}
