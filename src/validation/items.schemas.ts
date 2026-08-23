import { z } from 'zod';

const safePositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const createItemSchema = z.object({
  initialQuantity: safePositiveInteger
}).strict();

export const itemIdParamsSchema = z.object({
  itemId: z.string().uuid()
}).strict();

export type CreateItemInput = z.infer<typeof createItemSchema>;
