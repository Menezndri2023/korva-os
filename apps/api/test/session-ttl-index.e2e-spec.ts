import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AppModule } from './../src/app.module';

/**
 * Confirms the real MongoDB index behind Session.expiresAt's `expires: 0` schema option (see
 * session.schema.ts) — the decorator option alone proves nothing about what's actually in
 * Mongo; this reads the collection's real index list, the same way `syncIndexes()` is already
 * relied on elsewhere in this suite (see payment-reconciliation-scheduler.e2e-spec.ts) to turn
 * schema-declared indexes into real ones after a dropDatabase().
 */
describe('Session.expiresAt — TTL index (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
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

  it('creates a real MongoDB TTL index on expiresAt (expireAfterSeconds: 0)', async () => {
    const indexes = await connection.collection('sessions').indexes();
    const ttlIndex = indexes.find((index) => index.key?.expiresAt === 1);

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.expireAfterSeconds).toBe(0);
  });
});
