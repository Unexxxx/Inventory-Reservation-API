import { z } from 'zod';

const safePositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const createReservationSchema = z.object({
  itemId: z.string().uuid(),
  customerId: z.string().trim().min(1).max(255),
  quantity: safePositiveInteger,
  expiresAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(1).max(255)
}).passthrough();

export const reservationIdParamsSchema = z.object({
  reservationId: z.string().uuid()
}).strict();

export const expireReservationsSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(500)
}).strict().default({ limit: 500 });

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type ExpireReservationsInput = z.infer<typeof expireReservationsSchema>;
