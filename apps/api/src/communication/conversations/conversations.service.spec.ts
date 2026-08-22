import { ConversationsService } from './conversations.service';
import type { ConversationsRepository } from './conversations.repository';
import type { MessagesRepository } from './messages.repository';
import type { ContactsService } from '../../crm/contacts/contacts.service';
import type { MessageTemplatesService } from '../message-templates/message-templates.service';
import type { AuditService } from '../../audit/audit.service';
import type { EmailProvider } from '../providers/email-provider.interface';
import type { MessagingProvider } from '../providers/messaging-provider.interface';
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

  const conversationsRepository = {
    findById: jest.fn().mockResolvedValue(conversation),
    update: jest.fn().mockResolvedValue(conversation),
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

  const service = new ConversationsService(
    conversationsRepository,
    messagesRepository,
    contactsService,
    messageTemplatesService,
    auditService,
    emailProvider,
    messagingProvider,
  );

  return { service, send, messagingSend };
}

describe('ConversationsService.sendMessage — channel-aware HTML escaping', () => {
  it('HTML-escapes a templated value for an email conversation', async () => {
    const { service, send } = buildService('email');

    const input: CreateMessageInput = { body: 'fallback', templateId: 'tpl-1' };
    await service.sendMessage(ORG_ID, USER_ID, CONVERSATION_ID, input);

    expect(send).toHaveBeenCalledTimes(1);
    const sentBody = send.mock.calls[0][0].body as string;
    expect(sentBody).toBe('Bonjour &lt;img src=x onerror=alert(1)&gt;,');
    expect(sentBody).not.toContain('<img');
  });

  it('does NOT escape the same templated value for a WhatsApp conversation', async () => {
    const { service, messagingSend } = buildService('whatsapp');

    const input: CreateMessageInput = { body: 'fallback', templateId: 'tpl-1' };
    await service.sendMessage(ORG_ID, USER_ID, CONVERSATION_ID, input);

    expect(messagingSend).toHaveBeenCalledTimes(1);
    const sentBody = messagingSend.mock.calls[0][0].body as string;
    expect(sentBody).toBe('Bonjour <img src=x onerror=alert(1)>,');
    expect(sentBody).not.toContain('&lt;img');
  });
});
