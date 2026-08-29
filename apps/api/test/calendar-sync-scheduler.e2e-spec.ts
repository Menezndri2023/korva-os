import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CalendarSyncSchedulerService } from '../src/booking/resources/calendar-sync-scheduler.service';

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
interface BlockedSlotPayload {
  id: string;
  startAt: string;
  endAt: string;
  source?: string;
  reason?: string;
}
interface ResourcePayload {
  id: string;
  blockedSlots: BlockedSlotPayload[];
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

// A literal public IP (not a hostname) so the real DNS lookup inside assertSafeWebhookUrl never
// has to run — same technique already used by workflow-actions.service.spec.ts's own SSRF tests.
const PUBLIC_FEED_URL = 'https://93.184.216.34/feed-a.ics';

function buildIcs(events: { startAt: string; endAt: string }[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `DTSTART:${event.startAt}`,
      `DTEND:${event.endAt}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

describe('Calendar sync (ICS import) (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let syncedResourceId: string;
  let unsyncedResourceId: string;
  let originalFetch: typeof global.fetch;
  let fetchMock: jest.Mock;

  beforeAll(async () => {
    originalFetch = global.fetch;

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
      .send({
        email: 'calendar-sync-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Calendar Sync Org',
        type: 'service',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['booking'] })
      .expect(200);

    const syncedRes = await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Staff member with a personal calendar',
        type: 'person',
        externalCalendarUrl: PUBLIC_FEED_URL,
      })
      .expect(201);
    syncedResourceId = asSuccess<ResourcePayload>(syncedRes.body).id;

    const unsyncedRes = await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name: 'Room with no external calendar', type: 'room' })
      .expect(201);
    unsyncedResourceId = asSuccess<ResourcePayload>(unsyncedRes.body).id;

    // A manually-added blocked slot on the synced resource — must survive every sync tick
    // untouched, since only slots this sync itself wrote (source: 'external_calendar') are ever
    // replaced (see ResourcesRepository.replaceExternalCalendarBlockedSlots).
    await request(server)
      .post(`/api/v1/resources/${syncedResourceId}/blocked-slots`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        startAt: '2026-01-01T08:00:00.000Z',
        endAt: '2026-01-01T09:00:00.000Z',
        reason: 'Manual block',
      })
      .expect(201);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  async function getResource(id: string): Promise<ResourcePayload> {
    const res = await request(server)
      .get(`/api/v1/resources/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    return asSuccess<ResourcePayload>(res.body);
  }

  it('rejects an unsafe (private-network) externalCalendarUrl at write time', async () => {
    const res = await request(server)
      .post('/api/v1/resources')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        name: 'Bad resource',
        type: 'room',
        externalCalendarUrl: 'https://127.0.0.1/feed.ics',
      })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('UNSAFE_CALENDAR_URL');
  });

  it('imports ICS events as blocked slots, leaves resources with no feed untouched, and preserves manual slots', async () => {
    fetchMock.mockImplementation((url: URL) => {
      expect(url.toString()).toBe(PUBLIC_FEED_URL);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            buildIcs([
              { startAt: '20260829T140000Z', endAt: '20260829T150000Z' },
            ]),
          ),
      } as Response);
    });

    await app.get(CalendarSyncSchedulerService).runSweep();

    const synced = await getResource(syncedResourceId);
    const imported = synced.blockedSlots.filter(
      (slot) => slot.source === 'external_calendar',
    );
    expect(imported).toHaveLength(1);
    expect(imported[0]!.startAt).toBe('2026-08-29T14:00:00.000Z');
    expect(imported[0]!.endAt).toBe('2026-08-29T15:00:00.000Z');

    const manual = synced.blockedSlots.find(
      (slot) => slot.reason === 'Manual block',
    );
    expect(manual).toBeDefined();
    expect(manual?.source).toBeUndefined();

    const unsynced = await getResource(unsyncedResourceId);
    expect(unsynced.blockedSlots).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replaces previously-imported slots with the feed's current contents on the next sync", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            buildIcs([
              { startAt: '20260901T100000Z', endAt: '20260901T110000Z' },
            ]),
          ),
      } as Response),
    );

    await app.get(CalendarSyncSchedulerService).runSweep();

    const synced = await getResource(syncedResourceId);
    const imported = synced.blockedSlots.filter(
      (slot) => slot.source === 'external_calendar',
    );
    expect(imported).toHaveLength(1);
    expect(imported[0]!.startAt).toBe('2026-09-01T10:00:00.000Z');

    // The old 2026-08-29 slot from the previous test must be gone now.
    expect(
      synced.blockedSlots.some(
        (slot) => slot.startAt === '2026-08-29T14:00:00.000Z',
      ),
    ).toBe(false);
    // The manual slot is still untouched.
    expect(
      synced.blockedSlots.some((slot) => slot.reason === 'Manual block'),
    ).toBe(true);
  });

  it('skips a resource whose feed fetch fails without aborting the rest of the sweep', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve(''),
      } as Response),
    );

    await expect(
      app.get(CalendarSyncSchedulerService).runSweep(),
    ).resolves.not.toThrow();

    // Previous sync's slots are left exactly as they were — a failed fetch must not clear them.
    const synced = await getResource(syncedResourceId);
    expect(
      synced.blockedSlots.some((slot) => slot.source === 'external_calendar'),
    ).toBe(true);
  });
});
