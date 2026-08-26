import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  INTEGRATION_ACCOUNTS_READER,
  type IntegrationAccountsReader,
} from '../../integrations/integrations.types';

export interface ResolveMessagingAccountInput {
  organizationId: string;
  /** e.g. '360dialog' — the WhatsApp BSP provider key the tenant is expected to have connected. */
  provider: string;
}

/**
 * Checks whether a tenant has an active WhatsApp integration configured before a template/session
 * send is attempted, per docs/architecture/integrations-platform.md §5: "the resolver here is
 * simpler than payments (no market branch): given organizationId, look up the tenant's own row;
 * if none/status !== 'active', the send fails closed with a typed WHATSAPP_NOT_CONNECTED error
 * surfaced to the frontend — not a silent no-op."
 *
 * This service does not itself send anything or select a `MessagingProvider` adapter — it only
 * answers "is this tenant allowed to send via this provider right now?". Wiring it into the real
 * send path (ConversationsService/CommunicationModule) is Stage 2/later, not this task.
 */
@Injectable()
export class MessagingProviderResolverService {
  constructor(
    @Inject(INTEGRATION_ACCOUNTS_READER)
    private readonly integrationAccountsReader: IntegrationAccountsReader,
  ) {}

  async assertTenantConnected(
    input: ResolveMessagingAccountInput,
  ): Promise<void> {
    const { organizationId, provider } = input;

    const account = await this.integrationAccountsReader.findTenantAccount({
      organizationId,
      domain: 'messaging',
      provider,
    });

    if (!account || account.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'WHATSAPP_NOT_CONNECTED',
        message: `Organization "${organizationId}" has no active "${provider}" messaging integration connected`,
      });
    }
  }
}
