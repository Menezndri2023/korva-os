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

/** Recognizes exactly the 3 new Phase C4 tool names — a minimal scripted provider, same pattern
 *  as ai.e2e-spec.ts's own ScriptedAIProvider, kept in its own file (own throttle budget, own
 *  small fixture) rather than extended into that already-large file. */
class InventoryToolScriptedProvider implements AIProvider {
  readonly name = 'scripted-inventory';

  chat(input: { messages: AiChatMessage[] }): Promise<AiChatResult> {
    const last = input.messages[input.messages.length - 1];
    if (last?.role === 'tool') {
      return Promise.resolve({
        type: 'text',
        text: `Résultat: ${last.content}`,
      });
    }
    if (last?.role === 'user') {
      for (const name of [
        'suggest_reorder',
        'detect_dead_stock',
        'analyze_suppliers',
      ]) {
        if (last.content === name.toUpperCase()) {
          return Promise.resolve({
            type: 'tool_calls',
            toolCalls: [{ id: 'call_1', name, input: {} }],
          });
        }
      }
    }
    return Promise.resolve({ type: 'text', text: 'Bonjour' });
  }
}

describe('Inventory AI tools (Phase C4, e2e)', () => {
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
      .useValue(new InventoryToolScriptedProvider())
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
      .send({ email: 'inventory-ai-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Inventory AI Org',
        type: 'ecommerce',
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
      .send({ enabledModules: ['catalog', 'ai'] })
      .expect(200);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it.each(['suggest_reorder', 'detect_dead_stock', 'analyze_suppliers'])(
    'the analytics_agent can call %s and gets a real (empty) result back, not a permission/registration error',
    async (toolName) => {
      const res = await request(server)
        .post('/api/v1/ai/chat')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ agent: 'analytics_agent', message: toolName.toUpperCase() })
        .expect(201);
      const chat = asSuccess<AiChatResponsePayload>(res.body);
      // An empty org has no offers/suppliers yet — the tool still executes successfully and
      // returns an empty array, proving it's genuinely wired (permission + registry + module
      // resolution), not just accepted and silently dropped.
      expect(chat.reply).toBe('Résultat: []');
    },
  );
});
