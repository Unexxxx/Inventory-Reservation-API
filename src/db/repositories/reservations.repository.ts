import { getDatabase } from '../client.js';
import type { ExpirationResult, ReservationDatabaseResult } from '../../types/domain.js';

async function oneResult<T>(query: Promise<readonly { result: T }[]>): Promise<T> {
  const [row] = await query;
  if (!row) throw new Error('Database function returned no result');
  return row.result;
}

export function createReservationAtomic(input: {
  itemId: string;
  customerId: string;
  quantity: number;
  expiresAt: string;
  idempotencyKey: string;
  fingerprint: string;
}): Promise<ReservationDatabaseResult> {
  const sql = getDatabase();
  return oneResult(sql<{ result: ReservationDatabaseResult }[]>`
    select public.create_reservation_atomic(
      ${input.itemId}::uuid,
      ${input.customerId}::text,
      ${input.quantity}::bigint,
      ${input.expiresAt}::timestamptz,
      ${input.idempotencyKey}::text,
      ${input.fingerprint}::text
    ) as result
  `);
}

export function confirmReservationAtomic(reservationId: string): Promise<ReservationDatabaseResult> {
  const sql = getDatabase();
  return oneResult(sql<{ result: ReservationDatabaseResult }[]>`
    select public.confirm_reservation_atomic(${reservationId}::uuid) as result
  `);
}

export function cancelReservationAtomic(reservationId: string): Promise<ReservationDatabaseResult> {
  const sql = getDatabase();
  return oneResult(sql<{ result: ReservationDatabaseResult }[]>`
    select public.cancel_reservation_atomic(${reservationId}::uuid) as result
  `);
}

export function expireReservationsAtomic(limit: number): Promise<ExpirationResult> {
  const sql = getDatabase();
  return oneResult(sql<{ result: ExpirationResult }[]>`
    select public.expire_reservations_atomic(${limit}::integer) as result
  `);
}
