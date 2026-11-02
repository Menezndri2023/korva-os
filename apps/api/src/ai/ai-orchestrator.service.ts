import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  korvaAiAssistantFor,
  type AiAgent,
  type KorvaAiStatus,
} from '@korva/types';
import { AiConversationsRepository } from './ai-conversations.repository';
import { AiMessagesRepository } from './ai-messages.repository';
import { AiPendingActionsRepository } from './ai-pending-actions.repository';
import { AiUsageLogRepository } from './ai-usage-log.repository';
import { AiConversationDocument } from './schemas/ai-conversation.schema';
import { AiMessageDocument } from './schemas/ai-message.schema';
import { AiPendingActionDocument } from './schemas/ai-pending-action.schema';
import { AiContextBuilderService } from './ai-context-builder.service';
import { AiToolsRegistryService } from './ai-tools-registry.service';
import {
  AI_PROVIDER,
  type AIProvider,
  type AiChatMessage,
  type AiChatToolCall,
  type AiChatUsage,
} from './providers/ai-provider.interface';
import type { AiTool } from './tools/tool.interface';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { estimateCostUsd } from './ai-pricing.util';
import { KORVA_AI_CONFIG } from './korva-ai.tokens';
import type { KorvaAiConfig } from './korva-ai.config';
import { KORVA_AI_UNAVAILABLE_MESSAGE } from './providers/null-ai.provider';
import { AiProviderBusyError } from './providers/openai-compatible-ai.provider';
import { orgLocale, translator } from '../shared/i18n';

// What KORVA IA says when it cannot answer, in the business's language (shared/i18n.ts).
const UNAVAILABLE_MESSAGE_EN =
  'KORVA AI is not switched on yet. It is coming very soon: this message does not count against your quota.';
const PAUSED_MESSAGE = {
  fr: "KORVA IA fait une pause jusqu'au début du mois prochain : la plateforme a atteint son budget IA du mois. Ce message ne compte pas dans votre quota.",
  en: 'KORVA AI is paused until the start of next month: the platform has used its AI budget for the month. This message does not count against your quota.',
};
const BUSY_MESSAGE = {
  fr: 'KORVA IA est très sollicitée en ce moment. Réessayez dans une minute.',
  en: 'KORVA AI is very busy right now. Try again in a minute.',
};
const FAILED_MESSAGE = {
  fr: "KORVA IA n'a pas pu répondre pour le moment. Réessayez dans quelques instants.",
  en: 'KORVA AI could not answer right now. Try again in a moment.',
};
/** The platform spend is re-read at most this often: one aggregate per minute, not per message. */
const SPEND_CACHE_MS = 60_000;

/** Model calls per question. A booking chains five lookups (client, service, resource,
 *  availability, booking) before its answer: 5 cut it off mid-way with a real model. */
const MAX_TOOL_ITERATIONS = 8;

interface CallingUser {
  userId: string;
  permissions: readonly string[];
}

export interface ChatTurnResult {
  conversationId: string;
  reply: string;
  pendingActions: AiPendingActionDocument[];
}

function toChatMessage(message: AiMessageDocument): AiChatMessage {
  if (message.role === 'user') {
    return { role: 'user', content: message.content ?? '' };
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      toolCallId: message.toolCallId ?? '',
      toolName: message.toolName ?? '',
      content: message.content ?? '',
    };
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    // Mongoose drops empty objects when saving (minimize), so a call made with no argument comes
    // back without `input` — and the next turn then replayed an invalid call to the provider.
    return {
      role: 'assistant',
      toolCalls: message.toolCalls.map((call) => ({
        ...call,
        input: call.input ?? {},
      })),
    };
  }
  return { role: 'assistant', content: message.content ?? '' };
}

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly conversationsRepository: AiConversationsRepository,
    private readonly messagesRepository: AiMessagesRepository,
    private readonly pendingActionsRepository: AiPendingActionsRepository,
    private readonly usageLogRepository: AiUsageLogRepository,
    private readonly contextBuilder: AiContextBuilderService,
    private readonly toolsRegistry: AiToolsRegistryService,
    private readonly auditService: AuditService,
    private readonly entitlementsService: EntitlementsService,
    private readonly organizationsService: OrganizationsService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    @Inject(KORVA_AI_CONFIG) private readonly aiConfig: KorvaAiConfig,
  ) {}

  private spendCache: { period: string; costUsd: number; at: number } | null =
    null;

  /** Whether KORVA's own monthly AI budget (AI_MONTHLY_BUDGET_USD) is used up. */
  private async budgetExhausted(): Promise<boolean> {
    const budget = this.aiConfig.monthlyBudgetUsd;
    if (budget === null) return false;
    const period = new Date().toISOString().slice(0, 7);
    const now = Date.now();
    if (
      !this.spendCache ||
      this.spendCache.period !== period ||
      now - this.spendCache.at > SPEND_CACHE_MS
    ) {
      const { costUsd } =
        await this.usageLogRepository.getPlatformMonthlyTotals(period);
      this.spendCache = { period, costUsd, at: now };
    }
    return this.spendCache.costUsd >= budget;
  }

  async status(organizationId: string): Promise<KorvaAiStatus> {
    const organization =
      await this.organizationsService.getById(organizationId);
    const available = this.aiProvider.name !== 'null';
    const usage =
      await this.entitlementsService.getUsageSummary(organizationId);
    const messages = usage.find(
      (item) => item.metric === 'ai_messages_per_month',
    );
    return {
      available,
      paused: available && (await this.budgetExhausted()),
      assistant: korvaAiAssistantFor(
        organization.businessModel,
        orgLocale(organization.language),
      ),
      quota: { used: messages?.used ?? 0, limit: messages?.limit ?? 0 },
    };
  }

  /** A reply that is not the model's: written to the conversation like any other, and never
   *  counted against the business's quota. */
  private async platformReply(
    organizationId: string,
    conversation: AiConversationDocument,
    text: string,
    pendingActions: AiPendingActionDocument[] = [],
  ): Promise<ChatTurnResult> {
    await this.messagesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      conversationId: conversation._id,
      role: 'assistant',
      content: text,
    });
    await this.conversationsRepository.touch(
      organizationId,
      conversation.id as string,
    );
    return {
      conversationId: conversation.id as string,
      reply: text,
      pendingActions,
    };
  }

  /**
   * Best-effort: a model call already happened and billed real money whether or not this write
   * succeeds, so a logging failure must never surface as a chat-turn error (same "never throw"
   * rule WebhookDispatchService.dispatchEvent follows for its own side-channel writes). `usage` is
   * absent for providers that never call a real paid API (NullAIProvider, test doubles) — those
   * calls are skipped entirely rather than logged as zero-cost rows.
   */
  private async recordUsage(
    organizationId: string,
    conversation: AiConversationDocument,
    usage: AiChatUsage | undefined,
  ): Promise<void> {
    if (!usage) {
      return;
    }
    const model = this.aiProvider.model;
    if (!model) {
      return;
    }
    try {
      const costUsd = estimateCostUsd(
        model,
        usage.inputTokens,
        usage.outputTokens,
        this.aiConfig.priceOverride,
      );
      await this.usageLogRepository.record({
        organizationId,
        conversationId: conversation.id as string,
        agent: conversation.agent,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur inconnue';
      this.logger.error(`Failed to record AI usage log: ${message}`);
    }
  }

  private async getOrCreateConversation(
    organizationId: string,
    userId: string,
    conversationId: string | undefined,
    agent: AiAgent,
  ): Promise<AiConversationDocument> {
    if (conversationId) {
      const existing = await this.conversationsRepository.findById(
        organizationId,
        userId,
        conversationId,
      );
      if (!existing) {
        throw new NotFoundException({
          code: 'AI_CONVERSATION_NOT_FOUND',
          message: 'Conversation not found',
        });
      }
      return existing;
    }
    return this.conversationsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      userId: new Types.ObjectId(userId),
      agent,
    });
  }

  async chat(
    organizationId: string,
    user: CallingUser,
    input: { conversationId?: string; agent?: AiAgent; message: string },
  ): Promise<ChatTurnResult> {
    // Checked before the quota: a business is never charged a message KORVA could not answer.
    const unavailable = this.aiProvider.name === 'null';
    const paused = !unavailable && (await this.budgetExhausted());
    if (!unavailable && !paused) {
      await this.entitlementsService.checkAndRecordUsage(
        organizationId,
        'ai_messages_per_month',
      );
    }

    const conversation = await this.getOrCreateConversation(
      organizationId,
      user.userId,
      input.conversationId,
      input.agent ?? 'general_assistant',
    );

    await this.messagesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      conversationId: conversation._id,
      role: 'user',
      content: input.message,
    });

    if (unavailable || paused) {
      const locale = orgLocale(
        (await this.organizationsService.getById(organizationId)).language,
      );
      return this.platformReply(
        organizationId,
        conversation,
        unavailable
          ? locale === 'en'
            ? UNAVAILABLE_MESSAGE_EN
            : KORVA_AI_UNAVAILABLE_MESSAGE
          : PAUSED_MESSAGE[locale],
      );
    }

    const history = await this.messagesRepository.findAllForConversation(
      organizationId,
      conversation.id as string,
    );
    const systemPrompt = await this.contextBuilder.build(
      organizationId,
      conversation.agent,
    );
    const organization =
      await this.organizationsService.getById(organizationId);
    const availableTools = this.toolsRegistry
      .listForConversation(conversation.agent, organization.businessModel)
      .filter((tool) => user.permissions.includes(tool.requiredPermission));

    const chatMessages: AiChatMessage[] = history.map(toChatMessage);
    const pendingActions: AiPendingActionDocument[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let result: Awaited<ReturnType<AIProvider['chat']>>;
      try {
        result = await this.aiProvider.chat({
          systemPrompt,
          messages: chatMessages,
          tools: availableTools.map((tool) => tool.definition),
        });
      } catch (error) {
        this.logger.error(
          `AI provider call failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Nobody answered: the message counted on the way in is given back.
        await this.entitlementsService
          .refundUsage(organizationId, 'ai_messages_per_month')
          .catch(() => undefined);
        return this.platformReply(
          organizationId,
          conversation,
          (error instanceof AiProviderBusyError
            ? BUSY_MESSAGE
            : FAILED_MESSAGE)[orgLocale(organization.language)],
          pendingActions,
        );
      }
      await this.recordUsage(organizationId, conversation, result.usage);

      if (result.type === 'text') {
        await this.messagesRepository.create({
          organizationId: new Types.ObjectId(organizationId),
          conversationId: conversation._id,
          role: 'assistant',
          content: result.text,
        });
        await this.conversationsRepository.touch(
          organizationId,
          conversation.id as string,
        );
        return {
          conversationId: conversation.id as string,
          reply: result.text,
          pendingActions,
        };
      }

      await this.messagesRepository.create({
        organizationId: new Types.ObjectId(organizationId),
        conversationId: conversation._id,
        role: 'assistant',
        toolCalls: result.toolCalls,
      });
      chatMessages.push({ role: 'assistant', toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const toolResultContent = await this.executeToolCall(
          organizationId,
          user,
          conversation,
          call,
          availableTools,
          pendingActions,
        );
        await this.messagesRepository.create({
          organizationId: new Types.ObjectId(organizationId),
          conversationId: conversation._id,
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent,
        });
        chatMessages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: toolResultContent,
        });
      }
    }

    const fallback = translator(organization.language)(
      "Je n'ai pas pu terminer cette demande (trop d'étapes nécessaires). Peux-tu la reformuler plus simplement ?",
      'I could not finish this request (too many steps needed). Could you put it more simply?',
    );
    await this.messagesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      conversationId: conversation._id,
      role: 'assistant',
      content: fallback,
    });
    return {
      conversationId: conversation.id as string,
      reply: fallback,
      pendingActions,
    };
  }

  private async executeToolCall(
    organizationId: string,
    user: CallingUser,
    conversation: AiConversationDocument,
    call: AiChatToolCall,
    availableTools: AiTool[],
    pendingActions: AiPendingActionDocument[],
  ): Promise<string> {
    const tool = availableTools.find((t) => t.definition.name === call.name);
    if (!tool) {
      return `Outil "${call.name}" inconnu ou non autorisé pour cet agent.`;
    }
    if (!user.permissions.includes(tool.requiredPermission)) {
      return `Permission refusée pour l'outil "${call.name}".`;
    }

    let autoApproved = false;
    if (tool.sensitive) {
      if (!user.permissions.includes('ai.execute_sensitive_actions')) {
        return `L'outil "${call.name}" est une action sensible et nécessite une permission supplémentaire (ai.execute_sensitive_actions).`;
      }

      // AI autonomy level 4 (docs/KORVA_OS_V2_AUDIT.md §2.3): an org can explicitly opt a
      // specific sensitive tool into running inline, skipping the pending-confirmation step
      // below — but the permission check above still applies unconditionally, so this never
      // lets a user without ai.execute_sensitive_actions trigger a sensitive effect.
      const organization =
        await this.organizationsService.getById(organizationId);
      autoApproved =
        organization.aiAutoApprovedTools?.includes(call.name) ?? false;

      if (!autoApproved) {
        const pending = await this.pendingActionsRepository.create({
          organizationId: new Types.ObjectId(organizationId),
          conversationId: conversation._id,
          toolName: call.name,
          input: call.input,
          status: 'pending',
        });
        pendingActions.push(pending);
        return `Action "${call.name}" en attente de confirmation humaine (id: ${pending.id as string}).`;
      }
    }

    try {
      const parsedInput = tool.parseInput(call.input);
      const output = await tool.execute(
        organizationId,
        user.userId,
        parsedInput,
      );
      await this.auditService.record({
        organizationId,
        userId: user.userId,
        action: 'AI_ACTION',
        entity: tool.auditEntity,
        metadata: { tool: call.name, input: call.input, autoApproved },
      });
      return JSON.stringify(output);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur inconnue';
      return `Erreur lors de l'exécution de "${call.name}" : ${message}`;
    }
  }

  listConversations(
    organizationId: string,
    userId: string,
    options: { page: number; limit: number },
  ): Promise<AiConversationDocument[]> {
    return this.conversationsRepository.findAllForUser(
      organizationId,
      userId,
      options,
    );
  }

  /** Current calendar-month totals — same "YYYY-MM" period convention as EntitlementsService. */
  getUsageSummary(organizationId: string) {
    const period = new Date().toISOString().slice(0, 7);
    return this.usageLogRepository.getMonthlySummary(organizationId, period);
  }

  /** Every tool eligible for the org to auto-approve (level 4) — backs the Settings UI's picker. */
  listSensitiveTools() {
    return this.toolsRegistry.listSensitiveTools().map((tool) => ({
      name: tool.definition.name,
      description: tool.definition.description,
    }));
  }

  /**
   * Replaces the org's whole auto-approved-tools list (PUT semantics, not a merge) — every name
   * must be a real, currently-sensitive tool, so a stale/misspelled entry can never silently do
   * nothing. Gated the same as manually confirming a sensitive action (ai.execute_sensitive_actions)
   * — granting blanket auto-approval requires the same authority as approving one by hand.
   */
  async updateAutoApprovedTools(
    organizationId: string,
    toolNames: string[],
  ): Promise<string[]> {
    const sensitiveNames = new Set(
      this.toolsRegistry
        .listSensitiveTools()
        .map((tool) => tool.definition.name),
    );
    const unknown = toolNames.filter((name) => !sensitiveNames.has(name));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'AI_UNKNOWN_SENSITIVE_TOOL',
        message: `Not a currently sensitive tool: ${unknown.join(', ')}`,
      });
    }
    await this.organizationsService.updateAiAutoApprovedTools(
      organizationId,
      toolNames,
    );
    return toolNames;
  }

  async listMessages(
    organizationId: string,
    userId: string,
    conversationId: string,
  ): Promise<AiMessageDocument[]> {
    const conversation = await this.conversationsRepository.findById(
      organizationId,
      userId,
      conversationId,
    );
    if (!conversation) {
      throw new NotFoundException({
        code: 'AI_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return this.messagesRepository.findAllForConversation(
      organizationId,
      conversationId,
    );
  }

  async listPendingActions(
    organizationId: string,
    userId: string,
    conversationId: string,
  ): Promise<AiPendingActionDocument[]> {
    const conversation = await this.conversationsRepository.findById(
      organizationId,
      userId,
      conversationId,
    );
    if (!conversation) {
      throw new NotFoundException({
        code: 'AI_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return this.pendingActionsRepository.findAllForConversation(
      organizationId,
      conversationId,
    );
  }

  /**
   * LOT P4: `pending` → atomic claim → `confirming` → `confirmed`/`pending` (on an ordinary
   * error). The claim (claimForConfirmation) is the only step that actually arbitrates
   * concurrency — everything before it is a deterministic, side-effect-free check (existence,
   * permissions, tool lookup, input parsing) that's safe to evaluate against a possibly-stale
   * read, because a loser of the real race below never reaches `tool.execute()` regardless of
   * what this pre-check observed. See docs/ai.md and the LOT P4 design report for why this
   * deliberately does NOT use a lease/reclaim: a process crash between `tool.execute()` and the
   * `confirmed` write below leaves the action stuck in `confirming` rather than risk silently
   * re-running a possibly non-idempotent external effect.
   */
  async confirmAction(
    organizationId: string,
    user: CallingUser,
    actionId: string,
  ): Promise<unknown> {
    const pending = await this.getResolvablePendingAction(
      organizationId,
      actionId,
    );
    if (!user.permissions.includes('ai.execute_sensitive_actions')) {
      throw new BadRequestException({
        code: 'AI_ACTION_REQUIRES_CONFIRMATION_PERMISSION',
        message: 'Missing permission to confirm sensitive AI actions',
      });
    }
    const tool = this.toolsRegistry.getByName(pending.toolName);
    if (!tool || !user.permissions.includes(tool.requiredPermission)) {
      throw new BadRequestException({
        code: 'AI_ACTION_PERMISSION_DENIED',
        message: `Missing permission for tool "${pending.toolName}"`,
      });
    }
    const parsedInput = tool.parseInput(pending.input);

    const claimed = await this.pendingActionsRepository.claimForConfirmation(
      organizationId,
      actionId,
      user.userId,
    );
    if (!claimed) {
      // Someone else's confirm won the race since the read above (or resolved it outright) —
      // this caller never touches tool.execute() below.
      throw new BadRequestException({
        code: 'AI_ACTION_ALREADY_RESOLVED',
        message:
          'This action has already been resolved or is currently being confirmed',
      });
    }

    // LOT P4-FIX2: only a failure of tool.execute() itself means the business effect didn't
    // happen — that's the only case the rollback below is for. Once tool.execute() has returned,
    // the effect is real and irreversible from here; a failure in the audit write or the final
    // status write past this point must never be treated as if the effect hadn't occurred, or a
    // legitimate-looking retry could re-run it a second time. That's why those two calls are
    // deliberately outside this try/catch — their errors propagate as-is (Nest's global
    // exception filter handles them the same way it already does for every other service in
    // this codebase), without any rollback.
    let output: unknown;
    try {
      output = await tool.execute(organizationId, user.userId, parsedInput);
    } catch (error) {
      // An ordinary tool failure (validation, business-rule rejection, transient error) — not a
      // process crash. Release the claim so a legitimate retry can attempt it again, the same
      // role WorkflowsRepository.markActionFailed plays for a workflow action's lease.
      await this.pendingActionsRepository.updateStatus(
        organizationId,
        actionId,
        'confirming',
        'pending',
      );
      throw error;
    }

    await this.auditService.record({
      organizationId,
      userId: user.userId,
      action: 'AI_ACTION',
      entity: tool.auditEntity,
      metadata: {
        tool: pending.toolName,
        input: pending.input,
        confirmed: true,
      },
    });
    await this.pendingActionsRepository.updateStatus(
      organizationId,
      actionId,
      'confirming',
      'confirmed',
    );
    return output;
  }

  async rejectAction(organizationId: string, actionId: string): Promise<void> {
    await this.getResolvablePendingAction(organizationId, actionId);
    const rejected = await this.pendingActionsRepository.updateStatus(
      organizationId,
      actionId,
      'pending',
      'rejected',
    );
    if (!rejected) {
      // Lost a race against a concurrent confirm's claim (or otherwise no longer pending) between
      // the check above and this write — must never silently overwrite whatever that claim did.
      throw new BadRequestException({
        code: 'AI_ACTION_ALREADY_RESOLVED',
        message:
          'This action has already been resolved or is currently being confirmed',
      });
    }
  }

  private async getResolvablePendingAction(
    organizationId: string,
    actionId: string,
  ): Promise<AiPendingActionDocument> {
    const pending = await this.pendingActionsRepository.findById(
      organizationId,
      actionId,
    );
    if (!pending) {
      throw new NotFoundException({
        code: 'AI_PENDING_ACTION_NOT_FOUND',
        message: 'Pending action not found',
      });
    }
    if (pending.status !== 'pending') {
      const message =
        pending.status === 'confirming'
          ? 'This action is currently being confirmed'
          : `This action has already been ${pending.status}`;
      throw new BadRequestException({
        code: 'AI_ACTION_ALREADY_RESOLVED',
        message,
      });
    }
    return pending;
  }
}
