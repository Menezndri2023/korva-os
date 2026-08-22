import { Types } from 'mongoose';
import { WorkflowActionsService } from './workflow-actions.service';
import type { TasksService } from '../crm/tasks/tasks.service';
import type { NotificationsService } from '../communication/notifications/notifications.service';
import type { EmailProvider } from '../communication/providers/email-provider.interface';
import type {
  ClaimActionResult,
  WorkflowsRepository,
} from './workflows.repository';

describe('WorkflowActionsService — sendEmail HTML escaping', () => {
  it('HTML-escapes dynamic payload values injected into the outgoing email', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ providerReference: 'ref', status: 'sent' });
    const emailProvider = { name: 'stub', send } as unknown as EmailProvider;
    const service = new WorkflowActionsService(
      {} as TasksService,
      {} as NotificationsService,
      emailProvider,
      {} as WorkflowsRepository,
    );

    const result = await service.execute(
      'org-1',
      {
        type: 'send_email',
        config: {
          to: 'staff@example.com',
          subject: 'New lead: {{lead.name}}',
          body: '<p>Message: {{lead.message}}</p>',
        },
      },
      { lead: { name: 'Ada', message: '<script>alert(1)</script>' } },
    );

    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledWith({
      to: 'staff@example.com',
      subject: 'New lead: Ada',
      body: '<p>Message: &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    });
  });
});

describe('WorkflowActionsService — callWebhook SSRF protection', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  function buildService() {
    return new WorkflowActionsService(
      {} as TasksService,
      {} as NotificationsService,
      { name: 'stub', send: jest.fn() },
      {} as WorkflowsRepository,
    );
  }

  it('blocks a webhook action targeting the cloud metadata address, and never reaches the network', async () => {
    const service = buildService();

    const result = await service.execute(
      'org-1',
      {
        type: 'webhook',
        config: { url: 'https://169.254.169.254/latest/meta-data/' },
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks a webhook action targeting a private IP, and never reaches the network', async () => {
    const service = buildService();

    const result = await service.execute(
      'org-1',
      { type: 'webhook', config: { url: 'https://10.0.0.5/hook' } },
      {},
    );

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still allows a legitimate public HTTPS webhook through', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => null },
    });

    // A literal public IP avoids any real DNS lookup, keeping this test hermetic.
    const service = buildService();
    const result = await service.execute(
      'org-1',
      { type: 'webhook', config: { url: 'https://93.184.216.34/hook' } },
      { event: 'booking.created' },
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * In-memory stand-in for WorkflowsRepository's claim methods, mirroring the real
 * claim-first/no-terminal-failure semantics (see workflows.repository.ts#claimAction): a claim
 * that never reaches 'succeeded' stays re-claimable by a *sequential* caller. It deliberately
 * does NOT model the genuine-concurrent-insert-race outcome ('already-claimed') — that's a
 * MongoDB-level guarantee exercised against a real database in workflow.e2e-spec.ts, not
 * something a single-threaded fake can reproduce.
 */
class FakeClaimsRepository {
  private readonly claims = new Map<string, 'claimed' | 'succeeded'>();

  private key(workflowId: Types.ObjectId, actionIndex: number, eventKey: string) {
    return `${workflowId.toString()}:${actionIndex}:${eventKey}`;
  }

  async claimAction(
    _organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
  ): Promise<ClaimActionResult> {
    const key = this.key(workflowId, actionIndex, eventKey);
    if (this.claims.get(key) === 'succeeded') return 'already-succeeded';
    this.claims.set(key, 'claimed');
    return 'claimed';
  }

  async markActionSucceeded(
    _organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
  ): Promise<void> {
    this.claims.set(this.key(workflowId, actionIndex, eventKey), 'succeeded');
  }
}

describe('WorkflowActionsService — claim-first idempotence', () => {
  const workflowId = new Types.ObjectId();
  const claim = { workflowId, actionIndex: 0, eventKey: 'lead.created:lead-1' };

  it('create_task: runs once on the first call, and a second call with the same claim key never creates a second Task', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'task-1' });
    const tasksService = { create } as unknown as TasksService;
    const repository = new FakeClaimsRepository();
    const service = new WorkflowActionsService(
      tasksService,
      {} as NotificationsService,
      { name: 'stub', send: jest.fn() },
      repository as unknown as WorkflowsRepository,
    );
    const action = { type: 'create_task' as const, config: { title: 'Qualified lead' } };

    const first = await service.execute('org-1', action, {}, claim);
    const second = await service.execute('org-1', action, {}, claim);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('internal_notification: a retry with the same claim key never notifies the organization twice', async () => {
    const notifyOrganization = jest.fn().mockResolvedValue(undefined);
    const notificationsService = { notifyOrganization } as unknown as NotificationsService;
    const repository = new FakeClaimsRepository();
    const service = new WorkflowActionsService(
      {} as TasksService,
      notificationsService,
      { name: 'stub', send: jest.fn() },
      repository as unknown as WorkflowsRepository,
    );
    const action = {
      type: 'internal_notification' as const,
      config: { title: 'Lead qualified' },
    };

    await service.execute('org-1', action, {}, claim);
    await service.execute('org-1', action, {}, claim);

    expect(notifyOrganization).toHaveBeenCalledTimes(1);
  });

  it('two concurrent claim attempts on the same key: only the winner runs the effect, both report success', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'task-1' });
    const tasksService = { create } as unknown as TasksService;
    // Simulates the real repository's outcome under a genuine concurrent insert race: one
    // caller wins ('claimed'), the other loses the unique-index race ('already-claimed').
    const claimAction = jest
      .fn<Promise<ClaimActionResult>, unknown[]>()
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce('already-claimed');
    const repository = {
      claimAction,
      markActionSucceeded: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkflowsRepository;
    const service = new WorkflowActionsService(
      tasksService,
      {} as NotificationsService,
      { name: 'stub', send: jest.fn() },
      repository,
    );
    const action = { type: 'create_task' as const, config: { title: 'Qualified lead' } };

    const [a, b] = await Promise.all([
      service.execute('org-1', action, {}, claim),
      service.execute('org-1', action, {}, claim),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('create_task failure is marked retryable only when a claim context is present', async () => {
    const create = jest.fn().mockRejectedValue(new Error('Mongo unreachable'));
    const tasksService = { create } as unknown as TasksService;
    const repository = new FakeClaimsRepository();
    const service = new WorkflowActionsService(
      tasksService,
      {} as NotificationsService,
      { name: 'stub', send: jest.fn() },
      repository as unknown as WorkflowsRepository,
    );
    const action = { type: 'create_task' as const, config: { title: 'Qualified lead' } };

    const withClaim = await service.execute('org-1', action, {}, claim);
    const withoutClaim = await service.execute('org-1', action, {});

    expect(withClaim.success).toBe(false);
    expect(withClaim.retryable).toBe(true);
    expect(withoutClaim.success).toBe(false);
    expect(withoutClaim.retryable).toBeFalsy();
  });

  it('send_email/webhook failures are never marked retryable, even with a claim context', async () => {
    const send = jest.fn().mockResolvedValue({ status: 'failed', providerReference: '' });
    const repository = new FakeClaimsRepository();
    const service = new WorkflowActionsService(
      {} as TasksService,
      {} as NotificationsService,
      { name: 'stub', send },
      repository as unknown as WorkflowsRepository,
    );
    const action = {
      type: 'send_email' as const,
      config: { to: 'a@b.com', subject: 's', body: 'b' },
    };

    const result = await service.execute('org-1', action, {}, claim);

    expect(result.success).toBe(false);
    expect(result.retryable).toBeFalsy();
  });

  it('send_email is not re-sent by a later call sharing the same claim key once it has already succeeded', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ status: 'sent', providerReference: 'ref' });
    const repository = new FakeClaimsRepository();
    const service = new WorkflowActionsService(
      {} as TasksService,
      {} as NotificationsService,
      { name: 'stub', send },
      repository as unknown as WorkflowsRepository,
    );
    const action = {
      type: 'send_email' as const,
      config: { to: 'a@b.com', subject: 's', body: 'b' },
    };

    await service.execute('org-1', action, {}, claim);
    await service.execute('org-1', action, {}, claim);

    // Protects against a retry triggered by a *sibling* action's failure re-sending this email
    // — not a guarantee against the provider having already delivered it before a crash (see
    // docs/lot-q audit §13, Scenario 2 — that gap is real and not solved here).
    expect(send).toHaveBeenCalledTimes(1);
  });
});
