import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { spawnSync } from 'node:child_process';
import mongoose, { Connection } from 'mongoose';
import { AppModule } from './../src/app.module';

/**
 * Proves the per-process MongoDB test-database isolation fix in `env.setup.ts`
 * (LOT E2E-INFRA-4). Two independent agents hit
 * `MongoServerError: The database is currently being dropped. Database:
 * korva_test` while running unrelated e2e suites concurrently — every e2e
 * process shared the single hardcoded `korva_test` database and raced each
 * other's `connection.dropDatabase()`. This is a DIFFERENT failure mode from
 * ADR-003 (single-process NestApplication boot/teardown sequencing, producing
 * intermittent HTTP 400/404 — see docs/architecture-decisions.md); this file
 * does not touch that concern.
 *
 * This is deliberately NOT testing `env.setup.ts`'s constants directly — it
 * boots a real NestApplication against the real Mongo deployment (same as
 * every other e2e file) and asserts on real database names/documents, the
 * same "real HTTP, real MongoDB" standard the rest of this suite holds
 * itself to (see auth.e2e-spec.ts's file header).
 */
describe('MongoDB per-process test-database isolation (e2e)', () => {
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

  it('derives a per-process database name, not the shared "korva_test" constant', () => {
    const dbName = connection.db?.databaseName;
    expect(dbName).toBeDefined();
    expect(dbName).not.toBe('korva_test');
    // korva_test_<pid>_<jestWorkerId>_<12-hex-char random suffix>
    expect(dbName).toMatch(/^korva_test_\d+_\S+_[0-9a-f]{12}$/);
  });

  it('two independent OS processes loading env.setup.ts get two different database names', () => {
    // Faithful proxy for "two concurrent agents/terminals each running their own
    // `npx jest --config test/jest-e2e.json`" without paying for two full e2e
    // runs in this test itself: each child is a fresh OS process (fresh `pid`,
    // fresh module load of env.setup.ts), exactly what JEST_WORKER_ID alone
    // cannot distinguish (two independent Jest processes can both be "worker 1").
    const runOnce = () => {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          "import('./test/env.setup.ts').then(() => console.log(process.env.MONGODB_URI))",
          '--input-type=module',
        ],
        { cwd: `${__dirname}/..`, encoding: 'utf-8' },
      );
      const uri = result.stdout
        .split('\n')
        .find((line) => line.startsWith('mongodb://'));
      if (!uri) {
        throw new Error(
          `child process produced no MONGODB_URI — stdout: ${result.stdout}\nstderr: ${result.stderr}`,
        );
      }
      return uri;
    };

    const uriA = runOnce();
    const uriB = runOnce();

    expect(uriA).not.toBe(uriB);
  });

  it("this run's cleanup (connection.dropDatabase()) never touches a sibling run's database, and this run cannot read the sibling's data", async () => {
    const ownDbName = connection.db?.databaseName;
    expect(ownDbName).toBeDefined();

    // Simulates a second concurrent e2e process/run on the same MongoDB
    // deployment — same connection string, different logical database, exactly
    // what the fixed naming scheme produces for two real concurrent processes.
    const siblingDbName = `${ownDbName}_sibling_run`;
    const siblingUri = (process.env.MONGODB_URI as string).replace(
      `/${ownDbName}?`,
      `/${siblingDbName}?`,
    );
    const siblingConnection = await mongoose
      .createConnection(siblingUri)
      .asPromise();

    try {
      await siblingConnection
        .collection('isolation_marker')
        .insertOne({ owner: 'sibling-run', createdAt: new Date() });

      // The standard cleanup every other e2e file in this suite already
      // performs in its own afterAll — must only ever drop THIS run's database.
      await connection.dropDatabase();

      const survivingDoc = await siblingConnection
        .collection('isolation_marker')
        .findOne({ owner: 'sibling-run' });
      expect(survivingDoc).not.toBeNull();

      const dbs = await connection.db!.admin().listDatabases();
      const siblingStillExists = dbs.databases.some(
        (d) => d.name === siblingDbName,
      );
      expect(siblingStillExists).toBe(true);

      // This run's own connection is bound to its own database — it has no
      // visibility into the sibling run's collection/document at all.
      const ownDb = connection.db!;
      const crossReadAttempt = await ownDb
        .collection('isolation_marker')
        .findOne({
          owner: 'sibling-run',
        });
      expect(crossReadAttempt).toBeNull();
    } finally {
      await siblingConnection.dropDatabase();
      await siblingConnection.close();
    }
  });
});
