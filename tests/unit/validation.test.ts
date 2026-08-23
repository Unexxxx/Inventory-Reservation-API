import { describe, expect, it } from 'vitest';
import { getEnvironment } from '../../src/config/env.js';
import { createItemSchema } from '../../src/validation/items.schemas.js';
import {
  createReservationSchema,
  expireReservationsSchema,
  idempotencyHeadersSchema,
  reservationIdParamsSchema
} from '../../src/validation/reservations.schemas.js';

describe('request validation', () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid item quantity %s', (value) => {
    expect(createItemSchema.safeParse({ initialQuantity: value }).success).toBe(false);
  });

  it('rejects unknown fields and malformed reservation input', () => {
    expect(createReservationSchema.safeParse({ itemId: 'bad', customerId: ' ', quantity: 0, extra: true }).success).toBe(false);
  });

  it('accepts an offset timestamp and trims customer IDs', () => {
    const result = createReservationSchema.parse({
      itemId: '123e4567-e89b-42d3-a456-426614174000', customerId: ' customer ', quantity: 1,
      expiresAt: '2030-01-01T00:00:00+08:00'
    });
    expect(result.customerId).toBe('customer');
  });

  it('enforces idempotency key, UUID, and expiration limit boundaries', () => {
    expect(idempotencyHeadersSchema.safeParse({ 'idempotency-key': ' ' }).success).toBe(false);
    expect(idempotencyHeadersSchema.safeParse({ 'idempotency-key': 'x'.repeat(256) }).success).toBe(false);
    expect(reservationIdParamsSchema.safeParse({ reservationId: 'nope' }).success).toBe(false);
    expect(expireReservationsSchema.parse({})).toEqual({ limit: 500 });
    expect(expireReservationsSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(expireReservationsSchema.safeParse({ limit: 1001 }).success).toBe(false);
  });
});

describe('environment validation', () => {
  it('rejects owner credentials', () => {
    expect(() => getEnvironment({ DATABASE_URL: 'postgresql://postgres:secret@example.com/db' })).toThrow(/least-privileged/);
  });

  it('accepts a dedicated login and validates numeric settings', () => {
    expect(getEnvironment({
      DATABASE_URL: 'postgresql://inventory_api_login:secret@example.com/db',
      PORT: '3000', RESERVATION_TTL_MINUTES: '15'
    }).PORT).toBe(3000);
  });
});
