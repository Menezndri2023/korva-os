import { z } from "zod";
import { AI_AGENTS } from "@korva/types";

export const aiChatSchema = z.object({
  conversationId: z.string().optional(),
  agent: z.enum(AI_AGENTS).optional(),
  message: z.string().min(1).max(4000),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;
