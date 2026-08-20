import { z } from "zod";

export const changePlanSchema = z.object({
  planKey: z.string().min(1),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;
