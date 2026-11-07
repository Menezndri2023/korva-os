import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ success: true, data: { status: 'ok' } });
  });

  it('GET /api/v1/health/database', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/database')
      .expect(200)
      .expect({ success: true, data: { status: 'ok' } });
  });

  it('POST /api/v1/client-errors takes a browser error, and refuses anything else', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/client-errors')
      .send({
        app: 'storefront',
        message: "Cannot read properties of undefined (reading 'map')",
        stack: 'TypeError: …\n    at CheckoutPanel',
        path: '/boutique-awa/track?kind=order&email=fatou@example.com',
      })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/client-errors')
      .send({ app: 'other', message: 'x', path: '/' })
      .expect(400);
  });
});
