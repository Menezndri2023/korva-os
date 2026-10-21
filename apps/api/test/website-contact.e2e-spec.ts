import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
  slug: string;
}
interface PublicOrganizationPayload {
  name: string;
  contactPhone?: string;
  whatsappNumber?: string;
  contactAddress?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * The shop's public contact details — phone, WhatsApp, address — on every plan, so a free shop
 * can be reached and take orders over WhatsApp. Own file for the register-throttle budget.
 */
describe('Website contact details (e2e)', () => {
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

  async function setupOrg(email: string, name: string, modules: string[]) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name,
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const { id: organizationId, slug } = asSuccess<OrganizationPayload>(
      orgRes.body,
    );

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: modules })
      .expect(200);

    return { accessToken, organizationId, slug };
  }

  it('a free shop publishes its phone, WhatsApp and address on its public page', async () => {
    const { accessToken, organizationId, slug } = await setupOrg(
      'contact-owner@korva.test',
      'Contact Org',
      ['website'],
    );

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactPhone: '27 22 00 00 00',
        whatsappNumber: '+225 07 07 07 07 07',
        contactAddress: 'Rue des Jardins, Cocody, Abidjan',
      })
      .expect(200);

    const page = asSuccess<PublicOrganizationPayload>(
      (await request(server).get(`/api/v1/public/${slug}`).expect(200)).body,
    );
    expect(page.contactPhone).toBe('27 22 00 00 00');
    expect(page.whatsappNumber).toBe('+225 07 07 07 07 07');
    expect(page.contactAddress).toBe('Rue des Jardins, Cocody, Abidjan');

    // An emptied field clears the value, and the public page then omits it.
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ whatsappNumber: '', contactPhone: '' })
      .expect(200);
    const cleared = asSuccess<PublicOrganizationPayload>(
      (await request(server).get(`/api/v1/public/${slug}`).expect(200)).body,
    );
    expect(cleared.whatsappNumber).toBeUndefined();
    expect(cleared.contactPhone).toBeUndefined();
    expect(cleared.contactAddress).toBe('Rue des Jardins, Cocody, Abidjan');
  });

  it('refuses a WhatsApp number without its country code', async () => {
    const { accessToken, organizationId } = await setupOrg(
      'contact-local@korva.test',
      'Local Number Org',
      ['website'],
    );

    // "07 07…" alone cannot become a wa.me link: WhatsApp needs the country code.
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ whatsappNumber: '07 07 07 07 07' })
      .expect(400);
  });
});
