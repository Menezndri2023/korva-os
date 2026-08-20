import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  AI_PROVIDER,
  type AIProvider,
  type AiChatMessage,
  type AiChatResult,
} from '../src/ai/providers/ai-provider.interface';

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
