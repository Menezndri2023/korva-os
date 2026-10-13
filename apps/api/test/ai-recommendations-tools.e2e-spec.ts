import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  AI_PROVIDER,
  type AIProvider,
  type AiChatMessage,
  type AiChatResult,
} from '../src/ai/providers/ai-provider.interface';
import { EventBusService } from '../src/core/events/event-bus.service';
import { putOrganizationOnPlan } from './support/plan-tier';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface AiChatResponsePayload {
  conversationId: string;
  reply: string;
}
interface RecommendationPayload {
  id: string;
  status: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15000,
  intervalMs = 300,
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

/**
 * Mirrors ai.e2e-spec.ts's own ScriptedAIProvider — a deterministic double that decides what to
 * do purely from the conversation history, exercising the real orchestrator loop (tool
 * selection, permission filtering, execution) without a live LLM. Scoped to this file's own
 * three tools rather than extending the shared file, consistent with this session's small
 * per-file duplication over shared-file coupling (see e.g. the scheduler e2e files' own waitFor).
 */
@Injectable()
class ScriptedAIProvider implements AIProvider {
  readonly name = 'scripted';

  chat(input: { messages: AiChatMessage[] }): Promise<AiChatResult> {
    const last = input.messages[input.messages.length - 1];

    if (last?.role === 'tool') {
      return Promise.resolve({
        type: 'text',
        text: `Résultat: ${last.content}`,
      });
    }

    if (last?.role === 'user') {
      if (last.content === 'LIST_RECOMMENDATIONS') {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [
            { id: 'call_1', name: 'list_recommendations', input: {} },
          ],
        });
      }
      const dismissMatch = /DISMISS:(\S+)/.exec(last.content);
      if (dismissMatch) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_1',
              name: 'dismiss_recommendation',
              input: { recommendationId: dismissMatch[1] },
            },
          ],
        });
      }
      const resolveMatch = /RESOLVE:(\S+)/.exec(last.content);
      if (resolveMatch) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_1',
              name: 'resolve_recommendation',
              input: { recommendationId: resolveMatch[1] },
            },
          ],
        });
      }
      const proposeMatch = /PROPOSE:(contact|invoice|offer):(\S+)/.exec(
        last.content,
      );
      if (proposeMatch) {
        return Promise.resolve({
          type: 'tool_calls',
          toolCalls: [
            {
              id: 'call_1',
              name: 'propose_recommendation',
              input: {
                title: 'Relancer ce contact',
                description: "Ce contact n'a pas été recontacté récemment.",
                entityType: proposeMatch[1],
                entityId: proposeMatch[2],
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

describe('AI ↔ Decision Engine tools (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;

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

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'ai-recommendations-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'AI Recommendations Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await putOrganizationOnPlan(connection, organizationId);
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'finance', 'ai'] })
      .expect(200);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('list_recommendations lets the assistant read a real Decision Engine recommendation instead of hallucinating one', async () => {
    const eventBus = app.get(EventBusService);
    await eventBus.publish(organizationId, 'invoice.overdue', {
      invoiceId: new Types.ObjectId().toString(),
      contactId: new Types.ObjectId().toString(),
      total: 300,
      amountPaid: 100,
    });

    // Wait for the Decision Engine to have actually created the Recommendation before asking
    // the assistant about it — otherwise this test would only prove the tool call didn't
    // error, not that it returned the real one.
    await waitFor(async () => {
      const res = await request(server)
        .get('/api/v1/recommendations')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const data = asSuccess<RecommendationPayload[]>(res.body);
      return data.length > 0 ? data : undefined;
    });

    const res = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ agent: 'sales_agent', message: 'LIST_RECOMMENDATIONS' })
      .expect(201);
    const chat = asSuccess<AiChatResponsePayload>(res.body);

    expect(chat.reply).toContain('invoice_overdue_followup');
  });

  it('dismiss_recommendation and resolve_recommendation let the assistant act on a recommendation when asked', async () => {
    const recommendationsRes = await request(server)
      .get('/api/v1/recommendations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const invoiceRecommendationId = asSuccess<RecommendationPayload[]>(
      recommendationsRes.body,
    )[0]!.id;

    const dismissRes = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        agent: 'sales_agent',
        message: `DISMISS:${invoiceRecommendationId}`,
      })
      .expect(201);
    expect(asSuccess<AiChatResponsePayload>(dismissRes.body).reply).toContain(
      'dismissed',
    );

    const afterDismissRes = await request(server)
      .get(`/api/v1/recommendations/${invoiceRecommendationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<RecommendationPayload>(afterDismissRes.body).status).toBe(
      'dismissed',
    );

    // A second, independent recommendation (a different rule) to actually exercise
    // resolve_recommendation's happy path, rather than reusing the now-dismissed one above.
    const eventBus = app.get(EventBusService);
    await eventBus.publish(organizationId, 'customer.inactive', {
      contactId: new Types.ObjectId().toString(),
      inactiveDays: 61,
    });
    const reactivationRecommendationId = await waitFor(async () => {
      const res = await request(server)
        .get('/api/v1/recommendations?status=open')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const open = asSuccess<RecommendationPayload[]>(res.body);
      return open.length > 0 ? open[0]!.id : undefined;
    });

    const resolveRes = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        agent: 'sales_agent',
        message: `RESOLVE:${reactivationRecommendationId}`,
      })
      .expect(201);
    expect(asSuccess<AiChatResponsePayload>(resolveRes.body).reply).toContain(
      'resolved',
    );

    const afterResolveRes = await request(server)
      .get(`/api/v1/recommendations/${reactivationRecommendationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<RecommendationPayload>(afterResolveRes.body).status).toBe(
      'resolved',
    );
  });

  it('propose_recommendation lets the assistant draft a suggestion from real data, once per entity', async () => {
    const contactId = new Types.ObjectId().toString();

    const res = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ agent: 'sales_agent', message: `PROPOSE:contact:${contactId}` })
      .expect(201);
    const reply = asSuccess<AiChatResponsePayload>(res.body).reply;
    expect(reply).toContain('"status":"open"');

    const recommendationId = /"id":"([0-9a-f]{24})"/.exec(reply)?.[1];
    expect(recommendationId).toBeDefined();

    const getRes = await request(server)
      .get(`/api/v1/recommendations/${recommendationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const recommendation = asSuccess<
      RecommendationPayload & { ruleKey: string; entityId: string }
    >(getRes.body);
    expect(recommendation.ruleKey).toBe('ai_suggestion');
    expect(recommendation.entityId).toBe(contactId);

    // Same entity again — the AI cannot spam duplicate suggestions about the same contact.
    const dupRes = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ agent: 'sales_agent', message: `PROPOSE:contact:${contactId}` })
      .expect(201);
    expect(asSuccess<AiChatResponsePayload>(dupRes.body).reply).toContain(
      'A recommendation already exists',
    );
  });
});
