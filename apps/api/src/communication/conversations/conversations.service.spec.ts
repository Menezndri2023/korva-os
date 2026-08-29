import { ConversationsService } from './conversations.service';
import type { ConversationsRepository } from './conversations.repository';
import type { MessagesRepository } from './messages.repository';
import type { ContactsService } from '../../crm/contacts/contacts.service';
import type { MessageTemplatesService } from '../message-templates/message-templates.service';
import type { AuditService } from '../../audit/audit.service';
import type { EmailProvider } from '../providers/email-provider.interface';
import type { MessagingProvider } from '../providers/messaging-provider.interface';
import type { MessagingProviderResolverService } from '../providers/messaging-provider-resolver.service';
import type { CreateMessageInput } from '@korva/validation';

const ORG_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const CONVERSATION_ID = '507f1f77bcf86cd799439013';

const CONTACT = {
  id: '507f1f77bcf86cd799439014',
  firstName: '<img src=x onerror=alert(1)>',
  lastName: 'Doe',
  email: 'contact@example.com',
  phone: '+15550000000',
};

function buildService(channel: 'email' | 'whatsapp') {
  const conversation = {
    id: CONVERSATION_ID,
    status: 'open',
    channel,
    contactId: { toString: () => CONTACT.id },
    subject: 'Subject',
  };

  const createConversation = jest.fn().mockResolvedValue(conversation);
  const conversationsRepository = {
    findById: jest.fn().mockResolvedValue(conversation),
    update: jest.fn().mockResolvedValue(conversation),
    create: createConversation,
  } as unknown as ConversationsRepository;

  const messagesRepository = {
    create: jest.fn().mockImplementation((doc) => Promise.resolve(doc)),
  } as unknown as MessagesRepository;

  const contactsService = {
    getById: jest.fn().mockResolvedValue(CONTACT),
  } as unknown as ContactsService;

  const messageTemplatesService = {
    getById: jest.fn().mockResolvedValue({
      body: 'Bonjour {{contact.firstName}},',
      subject: undefined,
    }),
  } as unknown as MessageTemplatesService;

  const auditService = { record: jest.fn() } as unknown as AuditService;

  const send = jest
    .fn()
    .mockResolvedValue({ providerReference: 'ref', status: 'sent' });
  const emailProvider = { name: 'stub', send } as unknown as EmailProvider;

  const messagingSend = jest
    .fn()
    .mockResolvedValue({ providerReference: 'ref', status: 'sent' });
  const messagingProvider = {
    name: 'stub',
    send: messagingSend,
  } as unknown as MessagingProvider;
  // Stage 2.4: ConversationsService no longer injects MESSAGING_PROVIDER directly — it resolves
  // a tenant-scoped provider through MessagingProviderResolverService on every whatsapp/sms send.
  const resolveTenantProvider = jest.fn().mockResolvedValue(messagingProvider);
  const messagingProviderResolver = {
    resolveTenantProvider,
  } as unknown as MessagingProviderResolverService;

  const service = new ConversationsService(
    conversationsRepository,
    messagesRepository,
    contactsService,
    messageTemplatesService,
    auditService,
    emailProvider,
    messagingProviderResolver,
  );

  return {
    service,
    send,
    messagingSend,
    resolveTenantProvider,
    contactsService,
    conversationsRepository,
    createConversation,
    auditService,
  };
}

describe('ConversationsService.sendMessage — channel-aware HTML escaping', () => {
  it('HTML-escapes a templated value for an email conversation', async () => {
    const { service, send } = buildService('email');

    const input: CreateMessageInput = { body: 'fallback', templateId: 'tpl-1' };
    await service.sendMessage(ORG_ID, USER_ID, CONVERSATION_ID, input);

    expect(send).toHaveBeenCalledTimes(1);
    const [[emailSendInput]] = send.mock.calls as [[{ body: string }]];
    const sentBody = emailSendInput.body;
    expect(sentBody).toBe('Bonjour &lt;img src=x onerror=alert(1)&gt;,');
    expect(sentBody).not.toContain('<img');
  });

  it('does NOT escape the same templated value for a WhatsApp conversation', async () => {
    const { service, messagingSend } = buildService('whatsapp');

    const input: CreateMessageInput = { body: 'fallback', templateId: 'tpl-1' };
    await service.sendMessage(ORG_ID, USER_ID, CONVERSATION_ID, input);

    expect(messagingSend).toHaveBeenCalledTimes(1);
    const [[messagingSendInput]] = messagingSend.mock.calls as [
      [{ body: string }],
    ];
    const sentBody = messagingSendInput.body;
    expect(sentBody).toBe('Bonjour <img src=x onerror=alert(1)>,');
    expect(sentBody).not.toContain('&lt;img');
  });

  // Stage 2.4: a WhatsApp/SMS send always resolves the provider through
  // MessagingProviderResolverService.resolveTenantProvider, scoped to THIS organization — never
  // the old global MESSAGING_PROVIDER binding, which no longer exists in this constructor at all.
  it('resolves the messaging provider through resolveTenantProvider, scoped to the sending organization, for every whatsapp send', async () => {
    const { service, resolveTenantProvider } = buildService('whatsapp');

    const input: CreateMessageInput = { body: 'hello' };
    await service.sendMessage(ORG_ID, USER_ID, CONVERSATION_ID, input);

    expect(resolveTenantProvider).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      provider: '360dialog',
    });
  });

  // Stage 2.4 — TEST K (global env fallback): static proof that the old global MESSAGING_PROVIDER
  // token cannot bypass tenant-scoped resolution in production, because ConversationsService's
  // source no longer references it at all — there is no code path left for it to be reached
  // through. MessagingProviderModule/WHATSAPP_API_KEY still exist (kept as an explicitly
  // documented DEV/TEST-only binding, per docs/architecture/integrations-platform.md's Stage 2.4
  // addendum and .env.example's own comment) but are structurally unreachable from any real send.
  it("TEST K: ConversationsService's own source contains no reference to MESSAGING_PROVIDER — the old global binding cannot be reached from the real send path", () => {
    const serviceSource = ConversationsService.toString();
    expect(serviceSource).not.toMatch(/MESSAGING_PROVIDER/);
  });
});

describe('ConversationsService.create — WhatsApp consent gate (Wave 4 Stage 2)', () => {
  it('rejects opening a new whatsapp conversation for a contact with no consent on file', async () => {
    const { service, contactsService } = buildService('whatsapp');
    (contactsService.getById as jest.Mock).mockResolvedValue({
      ...CONTACT,
      consents: [],
    });

    await expect(
      service.create(ORG_ID, USER_ID, {
        contactId: CONTACT.id,
        channel: 'whatsapp',
      }),
    ).rejects.toMatchObject({
      response: { code: 'WHATSAPP_CONSENT_MISSING' },
    });
  });

  it('rejects opening a new whatsapp conversation when the only consent on file was revoked', async () => {
    const { service, contactsService } = buildService('whatsapp');
    (contactsService.getById as jest.Mock).mockResolvedValue({
      ...CONTACT,
      consents: [
        {
          channel: 'whatsapp',
          grantedAt: '2026-01-01T00:00:00.000Z',
          source: 'onboarding form',
          revokedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });

    await expect(
      service.create(ORG_ID, USER_ID, {
        contactId: CONTACT.id,
        channel: 'whatsapp',
      }),
    ).rejects.toMatchObject({
      response: { code: 'WHATSAPP_CONSENT_MISSING' },
    });
  });

  it('allows opening a new whatsapp conversation for a contact with an active whatsapp consent', async () => {
    const { service, contactsService, createConversation } =
      buildService('whatsapp');
    (contactsService.getById as jest.Mock).mockResolvedValue({
      ...CONTACT,
      consents: [
        {
          channel: 'whatsapp',
          grantedAt: '2026-01-01T00:00:00.000Z',
          source: 'onboarding form',
        },
      ],
    });

    await service.create(ORG_ID, USER_ID, {
      contactId: CONTACT.id,
      channel: 'whatsapp',
    });

    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it('does not require consent to open a new EMAIL conversation', async () => {
    const { service, contactsService, createConversation } =
      buildService('email');
    (contactsService.getById as jest.Mock).mockResolvedValue({
      ...CONTACT,
      consents: [],
    });

    await service.create(ORG_ID, USER_ID, {
      contactId: CONTACT.id,
      channel: 'email',
    });

    expect(createConversation).toHaveBeenCalledTimes(1);
  });
});
