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

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/** Minimal scripted provider recognizing exactly the one Phase F2 tool name — own file, own
 *  throttle budget, same pattern as the Phase C4 inventory AI tools e2e file. */
class BusinessOverviewScriptedProvider implements AIProvider {
  readonly name = 'scripted-business-overview';

  chat(input: { messages: AiChatMessage[] }): Promise<AiChatResult> {
    const last = input.messages[input.messages.length - 1];
    if (last?.role === 'tool') {
      return Promise.resolve({
        type: 'text',
        text: `Résultat: ${last.content}`,
      });
    }
    if (last?.role === 'user' && last.content === 'GET_BUSINESS_OVERVIEW') {
      return Promise.resolve({
        type: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'get_business_overview', input: {} }],
      });
    }
    return Promise.resolve({ type: 'text', text: 'Bonjour' });
  }
}

describe('Global business overview AI tool (Phase F2, e2e)', () => {
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
      .useValue(new BusinessOverviewScriptedProvider())
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
      .send({ email: 'overview-ai-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Overview AI Org',
        type: 'services',
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
      .send({
        enabledModules: ['crm', 'finance', 'catalog', 'analytics', 'ai'],
      })
      .expect(200);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('the analytics_agent can call get_business_overview and gets real (empty) cross-product data back', async () => {
    const res = await request(server)
      .post('/api/v1/ai/chat')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ agent: 'analytics_agent', message: 'GET_BUSINESS_OVERVIEW' })
      .expect(201);
    const chat = asSuccess<AiChatResponsePayload>(res.body);

    // A fresh org has zero of everything and no Action Center items — the tool still executes
    // successfully end-to-end (permission + registry + module resolution + the new
    // BusinessGraphModule/ActionCenterModule exports it depends on), proving it's genuinely
    // wired, not just accepted and silently dropped.
    const resultText = chat.reply.replace('Résultat: ', '');
    const result = JSON.parse(resultText) as {
      summary: { crm: { openLeadsCount: number } };
      topPriorityItems: unknown[];
    };
    expect(result.summary.crm.openLeadsCount).toBe(0);
    expect(result.topPriorityItems).toEqual([]);
  });
});
