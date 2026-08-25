import { BadRequestException, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  AI_PROVIDER,
  type AIProvider,
  type AiChatMessage,
  type AiChatResult,
} from '../src/ai/providers/ai-provider.interface';
import {
  AiPendingAction,
  AiPendingActionDocument,
} from '../src/ai/schemas/ai-pending-action.schema';
import { CancelBookingTool } from '../src/ai/tools/cancel-booking.tool';
import { BookingsService } from '../src/booking/bookings/bookings.service';
import type { AiTool } from '../src/ai/tools/tool.interface';
import { AuditService } from '../src/audit/audit.service';

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
interface PipelineStagePayload {
  id: string;
}
interface PipelinePayload {
  id: string;
  stages: PipelineStagePayload[];
}
interface ResourcePayload {
  id: string;
}
interface OfferPayload {
  id: string;
}
interface BookingPayload {
  id: string;
  status: string;
}
interface AiChatResponsePayload {
  conversationId: string;
  reply: string;
  pendingActions: { id: string; toolName: string; status: string }[];
}
interface AiMessagePayload {
  role: string;
  content?: string;
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  toolName?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * A deterministic AIProvider double for e2e tests: decides what to do purely from the
 * conversation history it's handed (exactly like a real stateless LLM call would), so the
 * full orchestrator loop (tool selection, permission checks, sensitive-action confirmation,
 * audit logging) is exercised for real without ever calling a live LLM.
 */
class ScriptedAIProvider implements AIProvider {
  readonly name = 'scripted';

  chat(input: {
    messages: AiChatMessage[];
    tools: unknown[];
  }): Promise<AiChatResult> {
    const last = input.messages[input.messages.length - 1];
    const loopForever = input.messages.some(
      (m) => m.role === 'user' && m.content.includes('LOOP_FOREVER'),
    );

    if (loopForever) {
      return Promise.resolve({
        type: 'tool_calls',
        toolCalls: [
          {
            id: `call_${input.messages.length}`,
            name: 'search_leads',
            input: {},
          },
        ],
      });
    }

    if (last?.role === 'tool') {
      return Promise.resolve({
        type: 'text',
        text: `Résultat: ${last.content}`,
      });
    }

    if (last?.role === 'user') {
      if (last.content.includes('SEARCH_LEADS')) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [{ id: 'call_1', name: 'search_leads', input: {} }],
        });
      }
      const cancelMatch = /CANCEL_BOOKING:(\S+)/.exec(last.content);
      if (cancelMatch) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_1',
              name: 'cancel_booking',
              input: { bookingId: cancelMatch[1] },
            },
          ],
        });
      }
      if (last.content.includes('UNKNOWN_TOOL')) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [{ id: 'call_1', name: 'not_a_real_tool', input: {} }],
        });
      }
      const quoteMatch = /CREATE_QUOTE:(\S+)/.exec(last.content);
      if (quoteMatch) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_1',
              name: 'create_quote',
              input: {
                contactId: quoteMatch[1],
                items: [
                  { description: 'Prestation', quantity: 1, unitPrice: 100 },
                ],
                currency: 'EUR',
              },
            },
          ],
        });
      }
    }

    return Promise.resolve({
      type: 'text',
      text: 'Bonjour, comment puis-je vous aider ?',
    });
  }
}

describe('AI module (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(new ScriptedAIProvider())
      .compile();

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

  async function registerFullOrg(email: string, orgName: string) {
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
      .send({ enabledModules: ['crm', 'catalog', 'booking', 'ai'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Prospect' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    const pipelineRes = await request(server)
      .post('/api/v1/pipelines')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Sales',
        isDefault: true,
        stages: [{ name: 'New', order: 0 }],
      })
      .expect(201);
    const pipeline = asSuccess<PipelinePayload>(pipelineRes.body);

    await request(server)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0]!.id,
      })
      .expect(201);

    return { accessToken, organizationId, contactId };
  }

  describe('chat without any tool call', () => {
    it('creates a conversation and stores the exchange', async () => {
      const { accessToken, organizationId } = await registerFullOrg(
        'ai-basic@korva.test',
        'AI Basic Org',
      );

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ message: 'Bonjour' })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      expect(chat.reply).toBe('Bonjour, comment puis-je vous aider ?');
      expect(chat.pendingActions).toHaveLength(0);

      const listRes = await request(server)
        .get('/api/v1/ai/conversations')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ id: string }[]>(listRes.body)).toHaveLength(1);

      const messagesRes = await request(server)
        .get(`/api/v1/ai/conversations/${chat.conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const messages = asSuccess<AiMessagePayload[]>(messagesRes.body);
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });
  });

  describe('chat that calls a real tool', () => {
    it('executes search_leads for real and feeds the result back to the model', async () => {
      const { accessToken, organizationId } = await registerFullOrg(
        'ai-tool@korva.test',
        'AI Tool Org',
      );

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ agent: 'sales_agent', message: 'SEARCH_LEADS' })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      expect(chat.reply).toContain('Résultat:');

      const messagesRes = await request(server)
        .get(`/api/v1/ai/conversations/${chat.conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const messages = asSuccess<AiMessagePayload[]>(messagesRes.body);
      expect(messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'tool',
        'assistant',
      ]);
      expect(messages[1]!.toolCalls?.[0]!.name).toBe('search_leads');
      expect(messages[2]!.toolName).toBe('search_leads');
    });

    it('rejects a tool the requested agent does not have access to', async () => {
      const { accessToken, organizationId, contactId } = await registerFullOrg(
        'ai-forbidden-tool@korva.test',
        'AI Forbidden Tool Org',
      );

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ agent: 'booking_agent', message: `CREATE_QUOTE:${contactId}` })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      expect(chat.reply).toContain('inconnu ou non autorisé');
    });

    it('reports an unknown tool name gracefully', async () => {
      const { accessToken, organizationId } = await registerFullOrg(
        'ai-unknown-tool@korva.test',
        'AI Unknown Tool Org',
      );

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ agent: 'sales_agent', message: 'UNKNOWN_TOOL' })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      expect(chat.reply).toContain('inconnu');
    });

    it('stops after the max tool iterations instead of looping forever', async () => {
      const { accessToken, organizationId } = await registerFullOrg(
        'ai-loop@korva.test',
        'AI Loop Org',
      );

      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ agent: 'sales_agent', message: 'LOOP_FOREVER' })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      expect(chat.reply).toContain("trop d'étapes");
    }, 15000);
  });

  describe('sensitive action requires confirmation', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let bookingId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, contactId } = await registerFullOrg(
        'ai-sensitive@korva.test',
        'AI Sensitive Org',
      ));

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Room 1',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      const resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Session',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;

      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 7);
      while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
      const day = date.toISOString().slice(0, 10);

      const bookingRes = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${day}T10:00:00.000Z`,
          endAt: `${day}T11:00:00.000Z`,
        })
        .expect(201);
      bookingId = asSuccess<BookingPayload>(bookingRes.body).id;
    });

    it('defers cancel_booking as a pending action instead of executing it inline', async () => {
      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          agent: 'booking_agent',
          message: `CANCEL_BOOKING:${bookingId}`,
        })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      expect(chat.pendingActions).toHaveLength(1);
      expect(chat.pendingActions[0]!.toolName).toBe('cancel_booking');
      expect(chat.pendingActions[0]!.status).toBe('pending');

      const pendingListRes = await request(server)
        .get(`/api/v1/ai/conversations/${chat.conversationId}/pending-actions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<{ id: string; status: string }[]>(pendingListRes.body),
      ).toHaveLength(1);

      const bookingRes = await request(server)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<BookingPayload>(bookingRes.body).status).not.toBe(
        'cancelled',
      );

      const actionId = chat.pendingActions[0]!.id;
      await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const afterConfirm = await request(server)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<BookingPayload>(afterConfirm.body).status).toBe(
        'cancelled',
      );

      const secondConfirm = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(secondConfirm.body).code).toBe(
        'AI_ACTION_ALREADY_RESOLVED',
      );
    });

    it('rejects a pending action without executing it', async () => {
      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          agent: 'booking_agent',
          message: `CANCEL_BOOKING:${bookingId}`,
        })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      const actionId = chat.pendingActions[0]!.id;

      await request(server)
        .post(`/api/v1/ai/actions/${actionId}/reject`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const confirmAfterReject = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(confirmAfterReject.body).code).toBe(
        'AI_ACTION_ALREADY_RESOLVED',
      );
    });
  });

  describe('tenant isolation for AI conversations', () => {
    it('denies a user from another organization reading a conversation via a foreign org id', async () => {
      const a = await registerFullOrg('ai-iso-a@korva.test', 'AI Iso A');
      const b = await registerFullOrg('ai-iso-b@korva.test', 'AI Iso B');

      const chatRes = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({ message: 'Bonjour' })
        .expect(201);
      const conversationId = asSuccess<AiChatResponsePayload>(
        chatRes.body,
      ).conversationId;

      const res = await request(server)
        .get(`/api/v1/ai/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });

  describe('atomic AI action confirmation (LOT P4)', () => {
    let accessToken: string;
    let organizationId: string;
    let resourceId: string;
    let offerId: string;
    let monday: string;
    let nextHour = 0;

    let accessTokenB: string;
    let organizationIdB: string;
    let resourceIdB: string;
    let offerIdB: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerFullOrg(
        'ai-p4@korva.test',
        'AI P4 Org',
      ));

      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 7);
      while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
      monday = date.toISOString().slice(0, 10);

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'P4 Room',
          type: 'room',
          // Wide window: every test below books a distinct hour so concurrent/repeated bookings
          // never collide on capacity (default 1) and a 400 from the resource layer is never
          // mistaken for the claim-rejection this suite is actually proving.
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '00:00', endTime: '23:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'P4 Session',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;

      // The free plan's ai_messages_per_month (5) is far below what this describe block's many
      // scenarios need — each creates its own booking + chat call. Upgrading is exercising a
      // real, existing endpoint (not a test-only bypass) purely to give this suite enough quota
      // headroom; it isn't what any test here is actually about.
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'pro' })
        .expect(201);

      ({ accessToken: accessTokenB, organizationId: organizationIdB } =
        await registerFullOrg('ai-p4-b@korva.test', 'AI P4 Org B'));
      const resourceResB = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessTokenB}`)
        .set('X-Organization-Id', organizationIdB)
        .send({
          name: 'P4 Room B',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '00:00', endTime: '23:00' },
          ],
        })
        .expect(201);
      resourceIdB = asSuccess<ResourcePayload>(resourceResB.body).id;
      const offerResB = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessTokenB}`)
        .set('X-Organization-Id', organizationIdB)
        .send({
          type: 'booking',
          name: 'P4 Session B',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);
      offerIdB = asSuccess<OfferPayload>(offerResB.body).id;

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessTokenB}`)
        .set('X-Organization-Id', organizationIdB)
        .send({ planKey: 'pro' })
        .expect(201);
    });

    /** Creates a fresh booking + the AI pending action to cancel it, on a never-reused hour. */
    async function createPendingCancelAction(
      token: string,
      orgId: string,
      resId: string,
      offId: string,
    ): Promise<{ bookingId: string; actionId: string }> {
      const hour = nextHour++;
      const startHour = String(hour).padStart(2, '0');
      const endHour = String(hour + 1).padStart(2, '0');

      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', orgId)
        .send({ firstName: `P4-${hour}` })
        .expect(201);
      const contactId = asSuccess<ContactPayload>(contactRes.body).id;

      const bookingRes = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', orgId)
        .send({
          resourceId: resId,
          offerId: offId,
          contactId,
          startAt: `${monday}T${startHour}:00:00.000Z`,
          endAt: `${monday}T${endHour}:00:00.000Z`,
        })
        .expect(201);
      const bookingId = asSuccess<BookingPayload>(bookingRes.body).id;

      const chatRes = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', orgId)
        .send({
          agent: 'booking_agent',
          message: `CANCEL_BOOKING:${bookingId}`,
        })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(chatRes.body);
      return { bookingId, actionId: chat.pendingActions[0]!.id };
    }

    async function getBookingStatus(
      token: string,
      orgId: string,
      bookingId: string,
    ): Promise<string> {
      const res = await request(server)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', orgId)
        .expect(200);
      return asSuccess<BookingPayload>(res.body).status;
    }

    function confirm(token: string, orgId: string, actionId: string) {
      return request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', orgId);
    }

    // Test 1 — two genuinely concurrent confirmations on the same action.
    it('two concurrent confirmations on the same action: exactly one executes the tool', async () => {
      const { bookingId, actionId } = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );

      const [a, b] = await Promise.all([
        confirm(accessToken, organizationId, actionId),
        confirm(accessToken, organizationId, actionId),
      ]);
      const responses = [a, b];
      const winners = responses.filter((r) => r.status === 201);
      const losers = responses.filter((r) => r.status === 400);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      // Proves the rejection came from the atomic claim itself — not from cancel_booking's own
      // idempotent guard (BOOKING_ALREADY_CANCELLED), which would also produce a 400 here if
      // the claim somehow let both requests reach tool.execute(). A booking ending up cancelled
      // alone can't distinguish those two cases; this error code can.
      expect(asError(losers[0]!.body).code).toBe('AI_ACTION_ALREADY_RESOLVED');

      // The single real execution is provable independently of which HTTP response won: the
      // booking's actual status is the ground truth for "how many times did the tool run".
      expect(
        await getBookingStatus(accessToken, organizationId, bookingId),
      ).toBe('cancelled');
    });

    // Test 2 — N concurrent confirmations, N = 5 and N = 10.
    it.each([5, 10])(
      '%d concurrent confirmations on the same action: exactly one wins',
      async (n) => {
        const { bookingId, actionId } = await createPendingCancelAction(
          accessToken,
          organizationId,
          resourceId,
          offerId,
        );

        const results = await Promise.all(
          Array.from({ length: n }, () =>
            confirm(accessToken, organizationId, actionId),
          ),
        );
        const winners = results.filter((r) => r.status === 201);
        const losers = results.filter((r) => r.status === 400);

        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(n - 1);
        // Every loser must have been rejected by the atomic claim itself — same rationale as
        // Test 1, checked for all N-1 losers here, not just inferred from the count.
        for (const loser of losers) {
          expect(asError(loser.body).code).toBe('AI_ACTION_ALREADY_RESOLVED');
        }
        expect(
          await getBookingStatus(accessToken, organizationId, bookingId),
        ).toBe('cancelled');
      },
    );

    // Test 3 — a confirm request against an action already 'confirming' is rejected immediately
    // and never reaches tool.execute() — proven by the booking staying uncancelled.
    it('a confirm request against an action already "confirming" is rejected without executing', async () => {
      const { bookingId, actionId } = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );
      const claimModel = app.get<Model<AiPendingActionDocument>>(
        getModelToken(AiPendingAction.name),
      );
      // Simulates another request having already won the atomic claim a moment ago and still
      // being inside tool.execute() — the only way to pin this exact window deterministically
      // without an artificial delay in production code.
      await claimModel.updateOne(
        { _id: new Types.ObjectId(actionId) },
        { $set: { status: 'confirming' } },
      );

      const res = await confirm(accessToken, organizationId, actionId);
      expect(res.status).toBe(400);
      expect(asError(res.body).code).toBe('AI_ACTION_ALREADY_RESOLVED');
      expect(
        await getBookingStatus(accessToken, organizationId, bookingId),
      ).not.toBe('cancelled');
    });

    // Test 5 — normal confirmation still works exactly as before the refactor.
    it('a normal, uncontested confirmation still succeeds', async () => {
      const { bookingId, actionId } = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );
      await confirm(accessToken, organizationId, actionId).expect(201);
      expect(
        await getBookingStatus(accessToken, organizationId, bookingId),
      ).toBe('cancelled');
    });

    // Test 6 — rejection still works, and a rejected action can never later be confirmed.
    it('rejection still works and a rejected action can never be confirmed afterward', async () => {
      const { bookingId, actionId } = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );
      await request(server)
        .post(`/api/v1/ai/actions/${actionId}/reject`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await confirm(accessToken, organizationId, actionId);
      expect(res.status).toBe(400);
      expect(asError(res.body).code).toBe('AI_ACTION_ALREADY_RESOLVED');
      expect(
        await getBookingStatus(accessToken, organizationId, bookingId),
      ).not.toBe('cancelled');
    });

    // Test 7 — tenant isolation: org B's confirm can never claim org A's pending action, even
    // when both organizations happen to be racing at the same time.
    it("tenant isolation: an organization can never claim another organization's pending action", async () => {
      const a = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );
      const b = await createPendingCancelAction(
        accessTokenB,
        organizationIdB,
        resourceIdB,
        offerIdB,
      );

      // Org B attempts to confirm org A's action id directly (wrong tenant header/token pair).
      const crossTenantAttempt = await confirm(
        accessTokenB,
        organizationIdB,
        a.actionId,
      );
      expect(crossTenantAttempt.status).toBe(404);

      // Confirms proceed normally and independently for each organization's own action.
      const [resA, resB] = await Promise.all([
        confirm(accessToken, organizationId, a.actionId),
        confirm(accessTokenB, organizationIdB, b.actionId),
      ]);
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(
        await getBookingStatus(accessToken, organizationId, a.bookingId),
      ).toBe('cancelled');
      expect(
        await getBookingStatus(accessTokenB, organizationIdB, b.bookingId),
      ).toBe('cancelled');
    });

    // Test 8 — confirmedBy is set exactly once, by the winning claimant, and is never
    // overwritten by a losing concurrent caller. Uses two genuinely distinct users (not the same
    // accessToken twice) so this can actually prove cross-user ownership rather than merely that
    // the field is set.
    it('confirmedBy records exactly the winning claimant, never a concurrent loser', async () => {
      const { actionId } = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );

      const secondUserEmail = 'ai-p4-confirmedby-b@korva.test';
      const secondUserAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: secondUserEmail, password: 'password123' })
        .expect(201);
      const secondUserAccessToken = asSuccess<AuthPayload>(
        secondUserAuthRes.body,
      ).accessToken;

      const ownerRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(organizationId),
        systemKey: 'OWNER',
      });
      expect(ownerRole).not.toBeNull();
      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ email: secondUserEmail, roleId: String(ownerRole?._id) })
        .expect(201);

      const firstUserDoc = await connection
        .collection('users')
        .findOne({ email: 'ai-p4@korva.test' });
      const secondUserDoc = await connection
        .collection('users')
        .findOne({ email: secondUserEmail });
      expect(firstUserDoc).not.toBeNull();
      expect(secondUserDoc).not.toBeNull();
      const firstUserId = firstUserDoc!._id.toString();
      const secondUserId = secondUserDoc!._id.toString();

      const [resA, resB] = await Promise.all([
        confirm(accessToken, organizationId, actionId),
        confirm(secondUserAccessToken, organizationId, actionId),
      ]);
      expect([resA.status, resB.status].sort()).toEqual([201, 400]);
      const winnerUserId = resA.status === 201 ? firstUserId : secondUserId;
      const loserUserId = resA.status === 201 ? secondUserId : firstUserId;

      const claimModel = app.get<Model<AiPendingActionDocument>>(
        getModelToken(AiPendingAction.name),
      );
      const doc = await claimModel.findById(actionId);
      expect(doc?.status).toBe('confirmed');
      expect(doc?.confirmedBy?.toString()).toBe(winnerUserId);
      expect(doc?.confirmedBy?.toString()).not.toBe(loserUserId);
    });

    // Test 9 — an action already 'confirming' can never be rejected by a concurrent request.
    it('an action already "confirming" cannot be rejected', async () => {
      const { bookingId, actionId } = await createPendingCancelAction(
        accessToken,
        organizationId,
        resourceId,
        offerId,
      );
      const claimModel = app.get<Model<AiPendingActionDocument>>(
        getModelToken(AiPendingAction.name),
      );
      await claimModel.updateOne(
        { _id: new Types.ObjectId(actionId) },
        { $set: { status: 'confirming' } },
      );

      const res = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/reject`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      expect(res.status).toBe(400);
      expect(asError(res.body).code).toBe('AI_ACTION_ALREADY_RESOLVED');

      // Restore to 'confirming' didn't get silently turned into 'rejected'.
      const doc = await claimModel.findById(actionId);
      expect(doc?.status).toBe('confirming');
      expect(
        await getBookingStatus(accessToken, organizationId, bookingId),
      ).not.toBe('cancelled');
    });
  });

  /**
   * Test 4 (LOT P4): an ordinary tool failure during confirmation must release the claim
   * (confirming → pending) rather than leaving the action permanently stuck — proven by a
   * second, later confirmation genuinely succeeding. This needs a tool double that fails
   * exactly once (a real Mongo/business-rule error is what the revert branch is built for, not
   * a process crash), so it boots its own dedicated app overriding CancelBookingTool — the real
   * BookingsService is still injected and still does the real cancellation on the second call.
   */
  describe('tool error releases the claim back to pending (LOT P4, Test 4)', () => {
    let app: INestApplication<App>;
    let server: App;
    let shouldFailOnce = false;
    let executeCallCount = 0;

    @Injectable()
    class OnceFailingCancelBookingTool implements AiTool<{
      bookingId: string;
    }> {
      // Same shape as the real CancelBookingTool's definition (cancel-booking.tool.ts) — copied
      // rather than instantiated from the real class, since this test double never needs the
      // real class's own constructor/BookingsService dependency to read a static object literal.
      readonly definition = {
        name: 'cancel_booking',
        description:
          'Annule une réservation existante. Nécessite une confirmation humaine.',
        inputSchema: {
          type: 'object',
          properties: { bookingId: { type: 'string' } },
          required: ['bookingId'],
        },
      };
      readonly requiredPermission = 'bookings.cancel' as const;
      readonly sensitive = true;
      readonly auditEntity = 'booking';

      constructor(private readonly bookingsService: BookingsService) {}

      parseInput(raw: unknown): { bookingId: string } {
        return raw as { bookingId: string };
      }

      async execute(
        organizationId: string,
        userId: string,
        input: { bookingId: string },
      ) {
        executeCallCount++;
        if (shouldFailOnce) {
          shouldFailOnce = false;
          throw new BadRequestException({
            code: 'SIMULATED_TRANSIENT_FAILURE',
            message: 'Simulated transient failure for LOT P4 Test 4',
          });
        }
        const booking = await this.bookingsService.cancel(
          organizationId,
          userId,
          input.bookingId,
        );
        return { id: booking.id as string, status: booking.status };
      }
    }

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(AI_PROVIDER)
        .useValue(new ScriptedAIProvider())
        .overrideProvider(CancelBookingTool)
        .useClass(OnceFailingCancelBookingTool)
        .compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.init();
      server = app.getHttpServer();
      // Additive only — the main describe block above already dropped/synced the database once
      // for this file; re-dropping here would destroy its fixtures if this block runs after it.
    });

    afterAll(async () => {
      await app.close();
    });

    it('reverts confirming -> pending on an ordinary tool error, and a later confirm succeeds', async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'ai-p4-retry@korva.test', password: 'password123' })
        .expect(201);
      const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;
      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'AI P4 Retry Org',
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
        .send({ enabledModules: ['crm', 'catalog', 'booking', 'ai'] })
        .expect(200);

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Retry Room',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      const resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Retry Session',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;
      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'Retry' })
        .expect(201);
      const contactId = asSuccess<ContactPayload>(contactRes.body).id;

      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 7);
      while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
      const day = date.toISOString().slice(0, 10);

      const bookingRes = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${day}T10:00:00.000Z`,
          endAt: `${day}T11:00:00.000Z`,
        })
        .expect(201);
      const bookingId = asSuccess<BookingPayload>(bookingRes.body).id;

      const chatRes = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          agent: 'booking_agent',
          message: `CANCEL_BOOKING:${bookingId}`,
        })
        .expect(201);
      const actionId = asSuccess<AiChatResponsePayload>(chatRes.body)
        .pendingActions[0]!.id;

      shouldFailOnce = true;
      executeCallCount = 0;

      const firstAttempt = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      expect(firstAttempt.status).toBe(400);
      expect(asError(firstAttempt.body).code).toBe(
        'SIMULATED_TRANSIENT_FAILURE',
      );

      const claimModel = app.get<Model<AiPendingActionDocument>>(
        getModelToken(AiPendingAction.name),
      );
      const afterFailure = await claimModel.findById(actionId);
      expect(afterFailure?.status).toBe('pending');

      const secondAttempt = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      expect(secondAttempt.status).toBe(201);
      expect(executeCallCount).toBe(2);

      const bookingRes2 = await request(server)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<BookingPayload>(bookingRes2.body).status).toBe(
        'cancelled',
      );
    });
  });

  /**
   * LOT P4-FIX2: a failure in a *post-effect* step (here, the audit write that happens after
   * tool.execute() has already returned) must never be converted into a confirming -> pending
   * rollback — that rollback exists only for the case where the business effect itself never
   * happened. To prove this is genuinely a post-effect failure and not just "some error occurred
   * before the tool ran", this test instruments the tool to count real invocations and boots its
   * own app overriding AuditService.record to fail deterministically, while CancelBookingTool is
   * left as the real implementation wired to the real BookingsService.
   */
  describe('post-effect failure does not trigger a rollback (LOT P4-FIX2)', () => {
    let app: INestApplication<App>;
    let server: App;
    let executeCallCount = 0;

    @Injectable()
    class CountingCancelBookingTool implements AiTool<{ bookingId: string }> {
      readonly definition = {
        name: 'cancel_booking',
        description:
          'Annule une réservation existante. Nécessite une confirmation humaine.',
        inputSchema: {
          type: 'object',
          properties: { bookingId: { type: 'string' } },
          required: ['bookingId'],
        },
      };
      readonly requiredPermission = 'bookings.cancel' as const;
      readonly sensitive = true;
      readonly auditEntity = 'booking';

      constructor(private readonly bookingsService: BookingsService) {}

      parseInput(raw: unknown): { bookingId: string } {
        return raw as { bookingId: string };
      }

      async execute(
        organizationId: string,
        userId: string,
        input: { bookingId: string },
      ) {
        executeCallCount++;
        const booking = await this.bookingsService.cancel(
          organizationId,
          userId,
          input.bookingId,
        );
        return { id: booking.id as string, status: booking.status };
      }
    }

    // Only the AI_ACTION audit write (the one ai-orchestrator.service.ts makes after
    // tool.execute() returns) fails — org/resource/offer/booking setup in this test also goes
    // through AuditService, and those must keep working so the failure this test is proving is
    // unambiguously the post-effect one, not an incidental setup failure.
    class FailingAuditService {
      record(input: { action: string }): Promise<void> {
        if (input.action === 'AI_ACTION') {
          throw new Error('SIMULATED_POST_EFFECT_FAILURE');
        }
        return Promise.resolve();
      }
      listRecent(): Promise<never[]> {
        return Promise.resolve([]);
      }
    }

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(AI_PROVIDER)
        .useValue(new ScriptedAIProvider())
        .overrideProvider(CancelBookingTool)
        .useClass(CountingCancelBookingTool)
        .overrideProvider(AuditService)
        .useClass(FailingAuditService)
        .compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.init();
      server = app.getHttpServer();
    });

    afterAll(async () => {
      await app.close();
    });

    it('does not roll back confirming -> pending when the post-effect audit write fails, and does not re-run the tool', async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'ai-p4fix2-posteffect@korva.test',
          password: 'password123',
        })
        .expect(201);
      const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;
      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'AI P4-FIX2 Post-Effect Org',
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
        .send({ enabledModules: ['crm', 'catalog', 'booking', 'ai'] })
        .expect(200);

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Post-Effect Room',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      const resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Post-Effect Session',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;
      const contactRes = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName: 'PostEffect' })
        .expect(201);
      const contactId = asSuccess<ContactPayload>(contactRes.body).id;

      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 7);
      while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
      const day = date.toISOString().slice(0, 10);

      const bookingRes = await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: `${day}T10:00:00.000Z`,
          endAt: `${day}T11:00:00.000Z`,
        })
        .expect(201);
      const bookingId = asSuccess<BookingPayload>(bookingRes.body).id;

      const chatRes = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          agent: 'booking_agent',
          message: `CANCEL_BOOKING:${bookingId}`,
        })
        .expect(201);
      const actionId = asSuccess<AiChatResponsePayload>(chatRes.body)
        .pendingActions[0]!.id;

      executeCallCount = 0;

      // tool.execute() itself succeeds (the real BookingsService.cancel runs and returns), but
      // the post-effect audit write throws — this must surface as a raw, unhandled error (Nest's
      // default exception filter), never as the AI_ACTION_ALREADY_RESOLVED / tool-error shape the
      // rollback path produces.
      const confirmRes = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      expect(confirmRes.status).toBe(500);
      expect(asError(confirmRes.body).code).toBe('INTERNAL_SERVER_ERROR');

      expect(executeCallCount).toBe(1);

      // The real effect genuinely happened exactly once.
      const bookingAfter = await request(server)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<BookingPayload>(bookingAfter.body).status).toBe(
        'cancelled',
      );

      // Not rolled back to 'pending' — still sitting in 'confirming', exactly where the claim
      // left it, since the failure happened after the effect was already real.
      const claimModel = app.get<Model<AiPendingActionDocument>>(
        getModelToken(AiPendingAction.name),
      );
      const doc = await claimModel.findById(actionId);
      expect(doc?.status).toBe('confirming');

      // And because it's not back in 'pending', a later confirm attempt cannot re-claim it and
      // re-run the tool a second time.
      const secondAttempt = await request(server)
        .post(`/api/v1/ai/actions/${actionId}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);
      expect(secondAttempt.status).toBe(400);
      expect(asError(secondAttempt.body).code).toBe(
        'AI_ACTION_ALREADY_RESOLVED',
      );
      expect(executeCallCount).toBe(1);
    });
  });
});

describe('AI module (e2e) — default NullAIProvider (no AI_API_KEY)', () => {
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

  it('replies with a fixed "not configured" message and never calls a tool', async () => {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'ai-null@korva.test', password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'AI Null Org',
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
      .send({ enabledModules: ['ai'] })
      .expect(200);

    const res = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ message: 'Bonjour' })
      .expect(201);
    const chat = asSuccess<AiChatResponsePayload>(res.body);
    expect(chat.reply).toContain("n'est pas configuré");
    expect(chat.pendingActions).toHaveLength(0);
  });
});
