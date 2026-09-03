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
interface UploadPayload {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

// Only the PNG magic-number header (8 bytes) — LocalDiskStorageEngine/S3StorageEngine's
// signature check only ever inspects the first bytes, never decodes a full image (see
// file-signature-checks.ts), so nothing here needs to be a real, renderable PNG.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

describe('Uploads (e2e) — local storage provider', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let ownerAccessToken: string;
  let organizationId: string;
  let otherOrgAccessToken: string;
  let otherOrganizationId: string;

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

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'uploads-owner@korva.test', password: 'password123' })
      .expect(201);
    ownerAccessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: 'Uploads Org',
        type: 'commerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    const otherAuthRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'uploads-other@korva.test', password: 'password123' })
      .expect(201);
    otherOrgAccessToken = asSuccess<AuthPayload>(otherAuthRes.body).accessToken;

    const otherOrgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${otherOrgAccessToken}`)
      .send({
        name: 'Other Org',
        type: 'commerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    otherOrganizationId = asSuccess<OrganizationPayload>(otherOrgRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('uploads, serves, and deletes a file scoped to the caller organization', async () => {
    const uploadRes = await request(server)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .attach('file', PNG_SIGNATURE, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    const upload = asSuccess<UploadPayload>(uploadRes.body);
    expect(upload.mimeType).toBe('image/png');
    expect(upload.size).toBe(PNG_SIGNATURE.length);
    expect(upload.url).toContain(`/api/v1/uploads/${organizationId}/${upload.filename}`);

    // GET is public — no Authorization header, matching how a storefront <img src> would fetch it.
    const getRes = await request(server)
      .get(`/api/v1/uploads/${organizationId}/${upload.filename}`)
      .expect(200);
    expect(getRes.headers['content-type']).toBe('image/png');
    expect(getRes.headers['content-length']).toBe(String(PNG_SIGNATURE.length));

    const deleteRes = await request(server)
      .delete(`/api/v1/uploads/${organizationId}/${upload.filename}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<{ deleted: boolean }>(deleteRes.body).deleted).toBe(true);

    await request(server)
      .get(`/api/v1/uploads/${organizationId}/${upload.filename}`)
      .expect(404);
  });

  it('rejects a disallowed declared mimetype before it ever reaches storage', async () => {
    const res = await request(server)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
    expect(asError(res.body).code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a spoofed file whose real bytes do not match its declared image mimetype', async () => {
    const res = await request(server)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .attach('file', Buffer.from('<script>not really a png</script>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(415);
    expect(asError(res.body).code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('never lets one organization delete a file uploaded under another organization', async () => {
    const uploadRes = await request(server)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .attach('file', PNG_SIGNATURE, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    const upload = asSuccess<UploadPayload>(uploadRes.body);

    const res = await request(server)
      .delete(`/api/v1/uploads/${organizationId}/${upload.filename}`)
      .set('Authorization', `Bearer ${otherOrgAccessToken}`)
      .set('X-Organization-Id', otherOrganizationId)
      .expect(404);
    expect(asError(res.body).code).toBe('FILE_NOT_FOUND');

    // Still reachable via GET (public) and deletable by its real owner — proves the file itself
    // was untouched by the rejected cross-tenant delete attempt above, not merely that it 404'd.
    await request(server)
      .get(`/api/v1/uploads/${organizationId}/${upload.filename}`)
      .expect(200);
    await request(server)
      .delete(`/api/v1/uploads/${organizationId}/${upload.filename}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
  });
});
