import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { PlatformAdminAuthService } from './../src/platform-admin/platform-admin-auth.service';
import { putOrganizationOnPlan } from './support/plan-tier';
import { AiOrchestratorService } from './../src/ai/ai-orchestrator.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

interface StubRequest {
  authorization?: string;
  body: {
    model: string;
    messages: { role: string; content: string | null }[];
    tools?: { function: { name: string } }[];
  };
}

/**
 * A stand-in for any "OpenAI chat completions" provider (Groq, Mistral, OpenRouter, Gemini,
 * Ollama): records what KORVA sends and answers from a script.
 */
function startStubProvider() {
  const requests: StubRequest[] = [];
  const script: { status: number; body: unknown }[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      requests.push({
        authorization: req.headers.authorization,
        body: JSON.parse(raw) as StubRequest['body'],
      });
      const next = script.shift() ?? {
        status: 500,
        body: { error: 'no script' },
      };
      res.writeHead(next.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(next.body));
    });
  });
  return { server, requests, script };
}

const textReply = (text: string, tokens = [1000, 200]) => ({
  status: 200,
  body: {
    choices: [
      { finish_reason: 'stop', message: { role: 'assistant', content: text } },
    ],
    usage: { prompt_tokens: tokens[0], completion_tokens: tokens[1] },
  },
});

/**
 * KORVA IA on an OpenAI-compatible provider: the trade assistant (instructions and tools),
 * usage priced from the .env, the platform budget that pauses it, a saturated provider, and the
 * administration's view. Own file: it sets the AI_* environment before the app is built.
 */
describe('KORVA IA (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  const stub = startStubProvider();

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      stub.server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = stub.server.address() as AddressInfo;
    Object.assign(process.env, {
      AI_PROVIDER: 'openai_compatible',
      AI_BASE_URL: `http://127.0.0.1:${port}/v1/`,
      AI_API_KEY: 'stub-key',
      AI_MODEL: 'korva-test-model',
      AI_PRICE_INPUT_PER_MILLION_USD: '1',
      AI_PRICE_OUTPUT_PER_MILLION_USD: '5',
      AI_MONTHLY_BUDGET_USD: '0.01',
      PLATFORM_ADMIN_EMAILS: 'ai-ops@korva.test',
    });
    // Imported only now: ConfigModule.forRoot() reads the environment when app.module loads.
    const { AppModule } = await import('./../src/app.module');
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
    for (const key of [
      'AI_PROVIDER',
      'AI_BASE_URL',
      'AI_API_KEY',
      'AI_MODEL',
      'AI_PRICE_INPUT_PER_MILLION_USD',
      'AI_PRICE_OUTPUT_PER_MILLION_USD',
      'AI_MONTHLY_BUDGET_USD',
      'PLATFORM_ADMIN_EMAILS',
    ]) {
      delete process.env[key];
    }
    await connection.dropDatabase();
    await app.close();
    await new Promise((resolve) => stub.server.close(resolve));
  });

  let staff: (req: request.Test) => request.Test;
  let organizationId: string;

  it('sets up a restaurant on the Pro plan', async () => {
    const auth = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'maquis@korva.test', password: 'password123' })
      .expect(201);
    const token = asSuccess<{ accessToken: string }>(auth.body).accessToken;
    const org = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Maquis Tanti',
        type: 'restauration',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<{ id: string }>(org.body).id;
    await putOrganizationOnPlan(connection, organizationId, 'pro');
    staff = (req) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', organizationId);
    await staff(request(server).patch('/api/v1/organizations/me'))
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'ai'] })
      .expect(200);
  });

  it('introduces the restaurant assistant', async () => {
    const res = await staff(request(server).get('/api/v1/ai/status')).expect(
      200,
    );
    expect(asSuccess(res.body)).toMatchObject({
      available: true,
      paused: false,
      assistant: { name: 'Assistant KORVA Restauration' },
    });
  });

  it("answers through the provider, as the restaurant's assistant with the restaurant's tools", async () => {
    stub.script.push(
      {
        status: 200,
        body: {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'get_business_overview',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2000, completion_tokens: 20 },
        },
      },
      textReply('Hier : 12 commandes, 84 000 FCFA.'),
    );
    const res = await staff(request(server).post('/api/v1/ai/chat'))
      .send({ message: 'Combien de commandes hier ?' })
      .expect(201);
    expect(asSuccess<{ reply: string }>(res.body).reply).toBe(
      'Hier : 12 commandes, 84 000 FCFA.',
    );

    const [first, second] = stub.requests;
    expect(first!.authorization).toBe('Bearer stub-key');
    expect(first!.body.model).toBe('korva-test-model');
    const system = first!.body.messages[0]!;
    expect(system.role).toBe('system');
    expect(system.content).toContain('Assistant KORVA Restauration');
    expect(system.content).toContain('Maquis Tanti');
    const tools = first!.body.tools!.map((tool) => tool.function.name);
    expect(tools).toEqual(
      expect.arrayContaining(['get_order', 'detect_dead_stock']),
    );
    // A restaurant's assistant does not carry the quote pipeline or the booking agenda.
    expect(tools).not.toContain('create_quote');
    expect(tools).not.toContain('create_booking');
    // The tool's result went back to the provider in the standard format.
    expect(second!.body.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('prices each call from the .env, so KORVA knows what it spends', async () => {
    const logs = await connection
      .collection('ai_usage_logs')
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .toArray();
    expect(logs).toHaveLength(2);
    // (2000×1 + 20×5) / 1e6 + (1000×1 + 200×5) / 1e6
    const total = logs.reduce((sum, log) => sum + (log.costUsd as number), 0);
    expect(total).toBeCloseTo(0.0041, 6);
  });

  it('answers calmly when the provider is saturated', async () => {
    stub.script.push({ status: 429, body: { error: 'rate limited' } });
    const res = await staff(request(server).post('/api/v1/ai/chat'))
      .send({ message: 'Et aujourd’hui ?' })
      .expect(201);
    expect(asSuccess<{ reply: string }>(res.body).reply).toContain(
      'très sollicitée',
    );
  });

  it("pauses once KORVA's monthly budget is spent, without charging the business", async () => {
    // Push the platform's spend past the 0.01 USD budget.
    await connection.collection('ai_usage_logs').insertOne({
      organizationId: new Types.ObjectId(organizationId),
      conversationId: new Types.ObjectId(),
      agent: 'general_assistant',
      model: 'korva-test-model',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.02,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const before = await connection
      .collection('usage')
      .findOne({ organizationId: new Types.ObjectId(organizationId) });
    const requestsBefore = stub.requests.length;
    // The platform spend is cached for a minute (one aggregate per minute, not per message):
    // drop the cache instead of waiting it out.
    app.get(AiOrchestratorService)['spendCache'] = null;

    const res = await staff(request(server).post('/api/v1/ai/chat'))
      .send({ message: 'Encore une question' })
      .expect(201);
    expect(asSuccess<{ reply: string }>(res.body).reply).toContain(
      'fait une pause',
    );
    expect(stub.requests.length).toBe(requestsBefore);
    const after = await connection
      .collection('usage')
      .findOne({ organizationId: new Types.ObjectId(organizationId) });
    expect(after?.count).toBe(before?.count);

    const status = await staff(request(server).get('/api/v1/ai/status')).expect(
      200,
    );
    expect(asSuccess<{ paused: boolean }>(status.body).paused).toBe(true);
  });

  it('shows the administration which brain answers and what it costs — never the key', async () => {
    const { password } = await app
      .get(PlatformAdminAuthService)
      .provision('ai-ops@korva.test');
    const login = await request(server)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'ai-ops@korva.test', password })
      .expect(200);
    const res = await request(server)
      .get('/api/v1/platform/system')
      .set(
        'Authorization',
        `Bearer ${asSuccess<{ accessToken: string }>(login.body).accessToken}`,
      )
      .expect(200);
    const body = asSuccess<{ ai: Record<string, unknown> }>(res.body);
    expect(body.ai).toMatchObject({
      configured: true,
      provider: 'API compatible OpenAI',
      model: 'korva-test-model',
      monthlyBudgetUsd: 0.01,
      callsThisMonth: 3,
      unpricedCalls: 0,
      topOrganizations: [
        expect.objectContaining({ name: 'Maquis Tanti', calls: 3 }),
      ],
    });
    expect(body.ai.spentThisMonthUsd as number).toBeCloseTo(0.0241, 6);
    // Its evolution: questions asked (the quota counter, 1 answered), businesses, 30 days.
    expect(body.ai).toMatchObject({
      messagesThisMonth: 1,
      activeOrganizationsThisMonth: 1,
    });
    const daily = body.ai.daily as { day: string; calls: number }[];
    expect(daily).toHaveLength(30);
    expect(daily[29]!.day).toBe(new Date().toISOString().slice(0, 10));
    expect(daily[29]!.calls).toBe(3);
    expect(JSON.stringify(res.body)).not.toContain('stub-key');
  });

  it('is open on the Free plan, within its 30 messages a month', async () => {
    const auth = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'gratuit@korva.test', password: 'password123' })
      .expect(201);
    const token = asSuccess<{ accessToken: string }>(auth.body).accessToken;
    const org = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Boutique Gratuite',
        type: 'commerce',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const id = asSuccess<{ id: string; enabledModules: string[] }>(org.body);
    // A new business on Free starts with KORVA IA switched on.
    expect(id.enabledModules).toContain('ai');
    const plan = await connection
      .collection('plans')
      .findOne({ key: 'free', priceCurrency: 'XOF' });
    expect(plan?.limits).toMatchObject({ ai_messages_per_month: 30 });
  });

  it('migration 0010 opens KORVA IA to every existing business and plan', async () => {
    const { migration } =
      await import('./../src/migrations/0010-korva-ai-all-plans');
    const legacy = await connection.collection('organizations').insertOne({
      name: 'Ancienne boutique',
      slug: 'ancienne-boutique',
      enabledModules: ['crm', 'catalog'],
    });
    await connection
      .collection('plans')
      .updateOne(
        { key: 'starter', priceCurrency: 'XOF' },
        { $set: { modules: ['crm'], 'limits.ai_messages_per_month': 0 } },
      );
    await migration.up(connection);
    await migration.up(connection);
    const org = await connection
      .collection('organizations')
      .findOne({ _id: legacy.insertedId });
    expect(org?.enabledModules).toEqual(['crm', 'catalog', 'ai']);
    const starter = await connection
      .collection('plans')
      .findOne({ key: 'starter', priceCurrency: 'XOF' });
    expect(starter?.modules).toContain('ai');
    expect(starter?.limits).toMatchObject({ ai_messages_per_month: 150 });
  });
});
