import { SendWhatsappTool } from './send-whatsapp.tool';
import type { ConversationsService } from '../../communication/conversations/conversations.service';

/**
 * Stage 2.4 — TEST J. `SendWhatsappTool` itself never talks to a `MessagingProvider` or resolver
 * directly — it only ever calls `ConversationsService.list`/`create`/`sendMessage`, passing the
 * `organizationId` it was invoked with straight through. The actual tenant-scoped provider
 * resolution (which credential gets used) is `ConversationsService`'s job, already proven in
 * conversations.service.spec.ts's own Stage 2.4 tests ("resolves the messaging provider through
 * resolveTenantProvider, scoped to the sending organization"). What THIS file proves is the other
 * half of the chain: that the AI tool faithfully forwards whichever organizationId it was called
 * with, for two different tenants, without ever mixing them up — the two halves together are the
 * full "AI tenant A → provider A, never provider B" guarantee the mandate asks for.
 *
 * This is a deliberate exception to this codebase's usual convention of not unit-testing
 * individual AI tools (see cancel-booking.tool.ts, which has no spec file either) — Stage 2.4
 * explicitly requires this exact proof (TEST J) at the tool level, not just at ConversationsService's.
 */

const ORG_A = '507f1f77bcf86cd799439011';
const ORG_B = '507f1f77bcf86cd799439021';
const USER_ID = '507f1f77bcf86cd799439099';
const CONTACT_ID = '507f1f77bcf86cd799439014';

function buildTool() {
  const list = jest.fn().mockResolvedValue({ data: [] }); // no existing open conversation -> create() path
  const create = jest.fn().mockResolvedValue({ id: 'conv-1' });
  const sendMessage = jest
    .fn()
    .mockResolvedValue({ id: 'msg-1', status: 'sent' });

  const conversationsService = {
    list,
    create,
    sendMessage,
  } as unknown as ConversationsService;

  const tool = new SendWhatsappTool(conversationsService);

  return { tool, list, create, sendMessage };
}

describe('SendWhatsappTool (Stage 2.4 — TEST J: tenant isolation at the AI tool boundary)', () => {
  it('remains a sensitive action requiring human confirmation — Stage 2 Phase 9 protection unchanged', () => {
    const { tool } = buildTool();
    expect(tool.sensitive).toBe(true);
  });

  it("TEST J (tenant A): forwards organization A's own id to every ConversationsService call, never a different one", async () => {
    const { tool, list, create, sendMessage } = buildTool();

    await tool.execute(ORG_A, USER_ID, {
      contactId: CONTACT_ID,
      body: 'hello A',
    });

    expect(list).toHaveBeenCalledWith(
      ORG_A,
      expect.objectContaining({ contactId: CONTACT_ID }),
    );
    expect(create).toHaveBeenCalledWith(
      ORG_A,
      USER_ID,
      expect.objectContaining({ contactId: CONTACT_ID, channel: 'whatsapp' }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      ORG_A,
      USER_ID,
      'conv-1',
      expect.objectContaining({ body: 'hello A' }),
    );
    // Never called with organization B's id anywhere in this invocation.
    expect(list).not.toHaveBeenCalledWith(ORG_B, expect.anything());
    expect(create).not.toHaveBeenCalledWith(
      ORG_B,
      expect.anything(),
      expect.anything(),
    );
    expect(sendMessage).not.toHaveBeenCalledWith(
      ORG_B,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("TEST J (tenant B): a separate invocation for organization B forwards ONLY organization B's id — proves the tool holds no cross-call tenant state", async () => {
    const { tool, list, create, sendMessage } = buildTool();

    await tool.execute(ORG_B, USER_ID, {
      contactId: CONTACT_ID,
      body: 'hello B',
    });

    expect(list).toHaveBeenCalledWith(ORG_B, expect.anything());
    expect(create).toHaveBeenCalledWith(ORG_B, USER_ID, expect.anything());
    expect(sendMessage).toHaveBeenCalledWith(
      ORG_B,
      USER_ID,
      'conv-1',
      expect.anything(),
    );
    expect(list).not.toHaveBeenCalledWith(ORG_A, expect.anything());
  });

  it('does not swallow a WhatsApp consent rejection — the tool propagates whatever ConversationsService.create() throws, never catching it to retry or fall back', async () => {
    const { tool, create } = buildTool();
    const consentError = Object.assign(new Error('no consent'), {
      response: { code: 'WHATSAPP_CONSENT_MISSING' },
    });
    create.mockRejectedValue(consentError);

    await expect(
      tool.execute(ORG_A, USER_ID, { contactId: CONTACT_ID, body: 'hello' }),
    ).rejects.toBe(consentError);
  });

  it('reuses an existing open conversation (found via list) instead of creating a new one — the consent gate only applies to opening a NEW conversation, unchanged by this stage', async () => {
    const { tool, list, create, sendMessage } = buildTool();
    list.mockResolvedValue({ data: [{ id: 'existing-conv' }] });

    await tool.execute(ORG_A, USER_ID, {
      contactId: CONTACT_ID,
      body: 'reply',
    });

    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      ORG_A,
      USER_ID,
      'existing-conv',
      expect.objectContaining({ body: 'reply' }),
    );
  });
});
