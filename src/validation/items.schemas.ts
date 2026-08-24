import { z } from 'zod';

const safePositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const itemName = z.string().trim().min(1).max(255);

export const createItemSchema = z.object({
  name: itemName,
  initial_quantity: safePositiveInteger
}).strict().transform(({ name, initial_quantity }) => ({ name, initialQuantity: initial_quantity }));

export const itemIdParamsSchema = z.object({
  itemId: z.string().uuid()
}).strict();

export type CreateItemInput = z.infer<typeof createItemSchema>;
