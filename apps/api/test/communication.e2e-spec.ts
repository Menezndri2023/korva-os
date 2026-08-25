import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Must be set before AppModule/ConfigModule compiles below (module-scope code runs before any
// beforeAll) — see the "resend delivery webhook" describe block near the bottom of this file.
process.env.RESEND_WEBHOOK_SECRET ??= 'whsec_ZTJlLXRlc3Qtd2ViaG9vay1zZWNyZXQ=';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface ContactPayload {
  id: string;
}
interface MessageTemplatePayload {
  id: string;
  name: string;
  body: string;
}
interface ConversationPayload {
  id: string;
  status: string;
  channel: string;
}
interface MessagePayload {
  id: string;
  status: string;
  body: string;
  to?: string;
}
interface NotificationPayload {
  id: string;
  title: string;
  read: boolean;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * 500ms (not 200ms): under a loaded full-suite run, aggressive polling here can stack with
 * other files' own polling against ThrottlerGuard's real 120-req/60s limit — see the identical
 * note in workflow.e2e-spec.ts, where this was confirmed directly via a reproduced 429.
 */
async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 18000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Communication module (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function registerOrgAndContact(
    email: string,
    orgName: string,
    contactEmail?: string,
  ) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: orgName,
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'communication', 'workflow'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Jane', lastName: 'Doe', email: contactEmail })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  describe('message templates CRUD', () => {
    let accessToken: string;
    let organizationId: string;
    let templateId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndContact(
        'templates-owner@korva.test',
        'Templates Org',
      ));
    });

    it('creates a message template', async () => {
      const res = await request(server)
        .post('/api/v1/message-templates')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Welcome email',
          channel: 'email',
          subject: 'Bienvenue {{contact.firstName}}',
          body: 'Bonjour {{contact.firstName}}, merci de nous avoir contactés.',
        })
        .expect(201);
      const template = asSuccess<MessageTemplatePayload>(res.body);
      templateId = template.id;
      expect(template.name).toBe('Welcome email');
    });

    it('lists and updates the template', async () => {
      const listRes = await request(server)
        .get('/api/v1/message-templates')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<MessageTemplatePayload[]>(listRes.body)).toHaveLength(1);

      const updateRes = await request(server)
        .patch(`/api/v1/message-templates/${templateId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Welcome email (updated)' })
        .expect(200);
      expect(asSuccess<MessageTemplatePayload>(updateRes.body).name).toBe(
        'Welcome email (updated)',
      );
    });

    it('deletes the template and then 404s on it', async () => {
      await request(server)
        .delete(`/api/v1/message-templates/${templateId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/message-templates/${templateId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('MESSAGE_TEMPLATE_NOT_FOUND');
    });
  });

  describe('conversations and messages over the email channel', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let templateId: string;
    let conversationId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, contactId } = await registerOrgAndContact(
        'convo-owner@korva.test',
        'Convo Org',
        'jane@customer.test',
      ));

      const templateRes = await request(server)
        .post('/api/v1/message-templates')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Follow-up',
          channel: 'email',
          body: 'Bonjour {{contact.firstName}}, où en êtes-vous ?',
        })
        .expect(201);
      templateId = asSuccess<MessageTemplatePayload>(templateRes.body).id;
    });

    it('creates a conversation with a contact', async () => {
      const res = await request(server)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, channel: 'email', subject: 'Question sur le devis' })
        .expect(201);
      const conversation = asSuccess<ConversationPayload>(res.body);
      conversationId = conversation.id;
      expect(conversation.status).toBe('open');
    });

    it('sends a plain outbound message, actually delivered via the log EmailProvider', async () => {
      const res = await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ body: 'Bonjour, votre devis est prêt.' })
        .expect(201);
      const message = asSuccess<MessagePayload>(res.body);
      expect(message.status).toBe('sent');
      expect(message.to).toBe('jane@customer.test');
    });

    it('sends a message from a template, interpolating the contact fields', async () => {
      const res = await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ body: '(unused)', templateId })
        .expect(201);
      const message = asSuccess<MessagePayload>(res.body);
      expect(message.body).toBe('Bonjour Jane, où en êtes-vous ?');
    });

    it('lists the messages in the conversation', async () => {
      const res = await request(server)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<MessagePayload[]>(res.body)).toHaveLength(2);
    });

    it('closes the conversation and then rejects sending a message on it', async () => {
      await request(server)
        .patch(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ status: 'closed' })
        .expect(200);

      const res = await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ body: 'Trop tard' })
        .expect(400);
      expect(asError(res.body).code).toBe('CONVERSATION_CLOSED');
    });

    it('rejects sending an email message to a contact with no email on file', async () => {
      const noEmailCtx = await registerOrgAndContact(
        'no-email-owner@korva.test',
        'No Email Org',
      );
      const convoRes = await request(server)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${noEmailCtx.accessToken}`)
        .set('X-Organization-Id', noEmailCtx.organizationId)
        .send({ contactId: noEmailCtx.contactId, channel: 'email' })
        .expect(201);
      const convoId = asSuccess<ConversationPayload>(convoRes.body).id;

      const res = await request(server)
        .post(`/api/v1/conversations/${convoId}/messages`)
        .set('Authorization', `Bearer ${noEmailCtx.accessToken}`)
        .set('X-Organization-Id', noEmailCtx.organizationId)
        .send({ body: 'Bonjour' })
        .expect(400);
      expect(asError(res.body).code).toBe('CONTACT_HAS_NO_EMAIL');
    });
  });

  describe('internal_notification workflow action broadcasts to org members', () => {
    let accessToken: string;
    let organizationId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndContact(
        'notif-owner@korva.test',
        'Notif Org',
      ));

      await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Notify team on new customer',
          trigger: 'customer.created',
          actions: [
            {
              type: 'internal_notification',
              config: { title: 'New customer: {{contactId}}' },
            },
          ],
        })
        .expect(201);
    });

    it('creates a notification for the org owner once the workflow processes customer.created', async () => {
      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'New' })
        .expect(201);
      const contactId = asSuccess<ContactPayload>(contactRes.body).id;

      const notification = await waitFor(async () => {
        const res = await request(server)
          .get('/api/v1/notifications')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const notifications = asSuccess<NotificationPayload[]>(res.body);
        return notifications.find(
          (n) => n.title === `New customer: ${contactId}`,
        );
      });
      expect(notification.read).toBe(false);

      const markRes = await request(server)
        .patch(`/api/v1/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<NotificationPayload>(markRes.body).read).toBe(true);
    }, 25000);

    it('marks all remaining notifications as read', async () => {
      const res = await request(server)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<{ updated: number }>(res.body)).toBeDefined();

      const listRes = await request(server)
        .get('/api/v1/notifications?read=false')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<NotificationPayload[]>(listRes.body)).toHaveLength(0);
    });
  });

  describe('tenant isolation for conversations and templates', () => {
    it('denies a user from another organization reading conversations via a foreign org id', async () => {
      const a = await registerOrgAndContact(
        'comm-iso-a@korva.test',
        'Comm Iso A',
        'contact-a@customer.test',
      );
      const b = await registerOrgAndContact(
        'comm-iso-b@korva.test',
        'Comm Iso B',
      );

      await request(server)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({ contactId: a.contactId, channel: 'internal' })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it("denies marking another organization's notification as read by its real id, even with a valid token for the caller's own organization", async () => {
      const a = await registerOrgAndContact(
        'comm-iso-notif-a@korva.test',
        'Comm Iso Notif A',
      );
      const b = await registerOrgAndContact(
        'comm-iso-notif-b@korva.test',
        'Comm Iso Notif B',
      );

      // Real notification, created in B via the same internal_notification workflow mechanism
      // used above — not a direct Mongo insert.
      await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .send({
          name: 'Notify team on new customer',
          trigger: 'customer.created',
          actions: [
            {
              type: 'internal_notification',
              config: { title: 'New customer: {{contactId}}' },
            },
          ],
        })
        .expect(201);

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .send({ firstName: 'Cross Tenant' })
        .expect(201);
      const contactId = asSuccess<ContactPayload>(contactRes.body).id;

      const notification = await waitFor(async () => {
        const res = await request(server)
          .get('/api/v1/notifications')
          .set('Authorization', `Bearer ${b.accessToken}`)
          .set('X-Organization-Id', b.organizationId)
          .expect(200);
        const notifications = asSuccess<NotificationPayload[]>(res.body);
        return notifications.find(
          (n) => n.title === `New customer: ${contactId}`,
        );
      }, 30000);
      expect(notification.read).toBe(false);

      // A's own token, A's own (valid) X-Organization-Id header, targeting B's real
      // notification id — there is no GET /notifications/:id endpoint, so PATCH .../read is the
      // only id-addressed endpoint available to prove NotificationsRepository.markRead is
      // scoped by organizationId (and userId), not just by the notification's _id.
      const res = await request(server)
        .patch(`/api/v1/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('NOTIFICATION_NOT_FOUND');

      // And not just an error response — B's notification must genuinely still be unread, not
      // silently flipped before the 404 was returned.
      const stillUnreadRes = await request(server)
        .get('/api/v1/notifications?read=false')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(200);
      const stillUnread = asSuccess<NotificationPayload[]>(stillUnreadRes.body);
      expect(stillUnread.some((n) => n.id === notification.id)).toBe(true);
    }, 25000);
  });

  /**
   * Full unit coverage of the actual signature-verification + status-update logic lives in
   * resend-webhook.controller.spec.ts / resend-webhook.service.spec.ts / verify-svix-signature
   * .spec.ts (constructing real signed payloads directly against the controller, no HTTP layer
   * involved). What's left to prove here, through the real bootstrapped HTTP stack, is the part
   * that's specific to going through an actual request: header validation, and the documented
   * raw-body limitation (see resend-webhook.controller.ts's class doc) — this app is built the
   * same way main.ts's bootstrap() builds it (no `{ rawBody: true }`), so `req.rawBody` is
   * genuinely unavailable here too, the same as it would be in production today.
   */
  describe('resend delivery webhook (e2e)', () => {
    it('rejects with 400 when svix signature headers are missing', async () => {
      const res = await request(server)
        .post('/api/v1/webhooks/resend')
        .send({ type: 'email.delivered', data: { email_id: 'irrelevant' } })
        .expect(400);
      expect(asError(res.body).code).toBe('MISSING_SIGNATURE_HEADERS');
    });

    it('fails closed with 503 when headers are present but req.rawBody is unavailable (known limitation, see resend-webhook.controller.ts)', async () => {
      const res = await request(server)
        .post('/api/v1/webhooks/resend')
        .set('svix-id', 'msg_e2e')
        .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
        .set('svix-signature', 'v1,irrelevant-because-rawbody-check-runs-first')
        .send({ type: 'email.delivered', data: { email_id: 'irrelevant' } })
        .expect(503);
      expect(asError(res.body).code).toBe(
        'RESEND_WEBHOOK_RAW_BODY_UNAVAILABLE',
      );
    });
  });
});
