/**
 * Shared contract for the Stage 1 integrations platform (see
 * docs/architecture/integrations-platform.md). This file is intentionally the ONLY
 * cross-agent-boundary file authored ahead of the Stage 1 worktrees — every Stage 1 agent
 * branches from a commit that already contains it, so IntegrationAccount's shape and the
 * read-only lookup contract can't drift between the agent that implements the repository
 * (Agent A) and the agents that only need to read through it (Agent B's resolvers).
 *
 * Everything else under apps/integrations/** (the repository/service implementation, the
 * encryption service, the webhook pipeline, the concrete resolvers) is agent-owned — this file
 * only pins the shape both sides must agree on.
 */

export type IntegrationDomain = 'payment' | 'messaging';
export type IntegrationScope = 'platform' | 'tenant';
export type IntegrationAccountStatus =
  'pending' | 'active' | 'disabled' | 'revoked' | 'error';

/**
 * Read-side projection only — deliberately excludes secretEncrypted. Nothing that consumes this
 * type (resolvers, settlement, any future controller response) can leak a credential, because
 * the type itself doesn't carry one. Code that needs to decrypt a secret must go through
 * IntegrationsService's own narrow, audited path, not through this shape.
 */
export interface IntegrationAccountRecord {
  id: string;
  scope: IntegrationScope;
  organizationId: string | null;
  domain: IntegrationDomain;
  provider: string;
  /** Disambiguates multiple platform accounts in the same domain — e.g.
   * 'subscription-billing' vs 'merchant-of-record' for payment, 'bsp-partner' for messaging. */
  role: string;
  /** ISO country code ('CI' | 'MA' | ...) or null for a market-independent account. */
  market: string | null;
  status: IntegrationAccountStatus;
  metadata: Record<string, unknown>;
  lastVerifiedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}

export const INTEGRATION_ACCOUNTS_READER = Symbol(
  'INTEGRATION_ACCOUNTS_READER',
);

/**
 * The only way a resolver (payment or messaging) may look up an IntegrationAccount. Read-only
 * and metadata-only by construction (see IntegrationAccountRecord above) — a resolver can never
 * obtain a decrypted secret through this interface, only enough to pick which adapter to
 * instantiate and how to configure it (subaccount id, WABA id, etc. via `metadata`).
 */
export interface IntegrationAccountsReader {
  findPlatformAccount(input: {
    domain: IntegrationDomain;
    role: string;
    market: string | null;
  }): Promise<IntegrationAccountRecord | null>;

  findTenantAccount(input: {
    organizationId: string;
    domain: IntegrationDomain;
    provider: string;
  }): Promise<IntegrationAccountRecord | null>;
}
