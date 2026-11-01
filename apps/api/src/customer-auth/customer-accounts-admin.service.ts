import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomerAccountSummary } from '@korva/types';
import { ContactsService } from '../crm/contacts/contacts.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CustomerAccountRepository } from './customer-account.repository';
import { CustomerSessionRepository } from './customer-session.repository';
import { CustomerAuthService } from './customer-auth.service';
import type { CustomerAccountDocument } from './schemas/customer-account.schema';

const LIST_LIMIT = 200;

/**
 * The business's side of its customers' accounts (Clients › Espaces clients): who has one, when
 * they last signed in, and three actions — suspend, restore, send a new-password link. The
 * business never sees nor sets a password.
 */
@Injectable()
export class CustomerAccountsAdminService {
  constructor(
    private readonly accounts: CustomerAccountRepository,
    private readonly sessions: CustomerSessionRepository,
    private readonly customerAuthService: CustomerAuthService,
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async list(
    organizationId: string,
    search?: string,
  ): Promise<CustomerAccountSummary[]> {
    const accounts = await this.accounts.list(
      organizationId,
      search?.trim() || undefined,
      LIST_LIMIT,
    );
    return Promise.all(accounts.map((a) => this.toSummary(organizationId, a)));
  }

  async forContact(
    organizationId: string,
    contactId: string,
  ): Promise<CustomerAccountSummary | null> {
    const account = await this.accounts.findByOrgAndContactId(
      organizationId,
      contactId,
    );
    return account ? this.toSummary(organizationId, account) : null;
  }

  async setDisabled(
    organizationId: string,
    id: string,
    disabled: boolean,
  ): Promise<CustomerAccountSummary> {
    const account = await this.accounts.setDisabled(
      organizationId,
      id,
      disabled,
    );
    if (!account) throw this.notFound();
    // Suspending ends every open session at once; restoring lets the customer sign in again.
    if (disabled) await this.sessions.revokeAllForAccount(id);
    return this.toSummary(organizationId, account);
  }

  /** The same e-mail as "Mot de passe oublié ?" on the site, sent on the customer's behalf. */
  async sendPasswordReset(organizationId: string, id: string): Promise<void> {
    const account = await this.accounts.findById(id);
    if (!account || account.organizationId.toString() !== organizationId) {
      throw this.notFound();
    }
    const organization =
      await this.organizationsService.getById(organizationId);
    await this.customerAuthService.forgotPassword(
      organization.slug,
      account.email,
    );
  }

  private async toSummary(
    organizationId: string,
    account: CustomerAccountDocument,
  ): Promise<CustomerAccountSummary> {
    const contact = await this.contactsService
      .getById(organizationId, account.contactId.toString())
      .catch(() => null);
    const name = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      : '';
    return {
      id: account.id as string,
      contactId: account.contactId.toString(),
      email: account.email,
      name: name || undefined,
      phone: contact?.phone || undefined,
      createdAt: (
        account as unknown as { createdAt: Date }
      ).createdAt.toISOString(),
      lastLoginAt: account.lastLoginAt?.toISOString(),
      disabledAt: account.disabledAt?.toISOString(),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOMER_ACCOUNT_NOT_FOUND',
      message: 'Customer account not found',
    });
  }
}
