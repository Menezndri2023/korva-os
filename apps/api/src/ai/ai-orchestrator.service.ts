import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { AiAgent } from '@korva/types';
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
import { estimateCostUsd } from './ai-pricing.util';

const MAX_TOOL_ITERATIONS = 5;

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
    return { role: 'assistant', toolCalls: message.toolCalls };
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
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
  ) {}

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
    await this.entitlementsService.checkAndRecordUsage(
      organizationId,
      'ai_messages_per_month',
    );

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

    const history = await this.messagesRepository.findAllForConversation(
      organizationId,
      conversation.id as string,
    );
    const systemPrompt = await this.contextBuilder.build(
      organizationId,
      conversation.agent,
    );
    const availableTools = this.toolsRegistry
      .listForAgent(conversation.agent)
      .filter((tool) => user.permissions.includes(tool.requiredPermission));

    const chatMessages: AiChatMessage[] = history.map(toChatMessage);
    const pendingActions: AiPendingActionDocument[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const result = await this.aiProvider.chat({
        systemPrompt,
        messages: chatMessages,
        tools: availableTools.map((tool) => tool.definition),
      });
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

    const fallback =
      "Je n'ai pas pu terminer cette demande (trop d'étapes nécessaires). Peux-tu la reformuler plus simplement ?";
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

    if (tool.sensitive) {
      if (!user.permissions.includes('ai.execute_sensitive_actions')) {
        return `L'outil "${call.name}" est une action sensible et nécessite une permission supplémentaire (ai.execute_sensitive_actions).`;
      }
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
        metadata: { tool: call.name, input: call.input },
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
