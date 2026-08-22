import { WorkflowActionsService } from './workflow-actions.service';
import type { TasksService } from '../crm/tasks/tasks.service';
import type { NotificationsService } from '../communication/notifications/notifications.service';
import type { EmailProvider } from '../communication/providers/email-provider.interface';

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
