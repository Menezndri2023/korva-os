import { z } from "zod";
import { AI_AGENTS } from "@korva/types";

export const aiChatSchema = z.object({
  conversationId: z.string().optional(),
  agent: z.enum(AI_AGENTS).optional(),
  message: z.string().min(1).max(4000),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;

export const listAiConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAiConversationsQuery = z.infer<
  typeof listAiConversationsQuerySchema
>;

export const updateAiAutoApprovedToolsSchema = z.object({
  toolNames: z.array(z.string().min(1)).max(50),
});
export type UpdateAiAutoApprovedToolsInput = z.infer<
  typeof updateAiAutoApprovedToolsSchema
>;
