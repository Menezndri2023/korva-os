import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureProxyTrust } from './../src/core/http/proxy-trust';

/**
 * The per-IP rate limit must count each visitor separately behind the relays (Caddy, the
 * storefront server). Until 2026-10-21 Express saw only Caddy's address, so the whole platform
 * shared one bucket of 120 requests a minute. Own file: it spends a whole rate-limit window.
 */
describe('Client address behind the private relays (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureProxyTrust(app);
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives each visitor its own rate-limit bucket', async () => {
    const hit = (ip: string) =>
      request(server).get('/api/v1/health').set('X-Forwarded-For', ip);

    // One visitor exhausts its own allowance…
    let lastStatus = 0;
    for (let index = 0; index < 125; index += 1) {
      lastStatus = (await hit('203.0.113.10')).status;
    }
    expect(lastStatus).toBe(429);

    // …and another visitor behind the same relay is not affected.
    expect((await hit('203.0.113.20')).status).toBe(200);
  });
});
