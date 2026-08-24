import { createHash, randomUUID } from 'node:crypto';
import { getEnvironment } from '../config/env.js';
import * as reservationsRepository from '../db/repositories/reservations.repository.js';
import { AppError, errorCodes, errorForOutcome } from '../errors/app-error.js';
import type { ExpirationResult, Reservation, ReservationDatabaseResult } from '../types/domain.js';
import type { CreateReservationInput } from '../validation/reservations.schemas.js';

function canonicalFingerprint(input: CreateReservationInput): string {
  const canonical = JSON.stringify({
    itemId: input.itemId,
    customerId: input.customerId.trim(),
    quantity: input.quantity,
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : 'DEFAULT_TTL'
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function requireReservation(result: ReservationDatabaseResult): Reservation {
  if (!result.reservation) throw errorForOutcome(result.outcome);
  return result.reservation;
}

export async function createReservation(
  input: CreateReservationInput,
  idempotencyKey?: string
): Promise<{ reservation: Reservation; replayed: boolean }> {
  const now = Date.now();
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(now + getEnvironment().RESERVATION_TTL_MINUTES * 60_000);
  if (expiresAt.getTime() <= now) {
    throw new AppError(400, errorCodes.VALIDATION_ERROR, 'Request validation failed.', {
      fields: { expires_at: 'Expiration must be later than server time.' }
    });
  }
  const result = await reservationsRepository.createReservationAtomic({
    itemId: input.itemId,
    customerId: input.customerId.trim(),
    quantity: input.quantity,
    expiresAt: expiresAt.toISOString(),
    idempotencyKey: idempotencyKey?.trim() || randomUUID(),
    fingerprint: canonicalFingerprint(input)
  });
  if (result.outcome !== 'created' && result.outcome !== 'replayed') throw errorForOutcome(result.outcome);
  return { reservation: requireReservation(result), replayed: result.outcome === 'replayed' };
}

export async function confirmReservation(reservationId: string): Promise<Reservation> {
  const result = await reservationsRepository.confirmReservationAtomic(reservationId);
  if (result.outcome !== 'confirmed') throw errorForOutcome(result.outcome);
  return requireReservation(result);
}

export async function cancelReservation(reservationId: string): Promise<Reservation> {
  const result = await reservationsRepository.cancelReservationAtomic(reservationId);
  if (result.outcome !== 'cancelled') throw errorForOutcome(result.outcome);
  return requireReservation(result);
}

export function expireReservations(limit: number): Promise<ExpirationResult> {
  return reservationsRepository.expireReservationsAtomic(limit);
}
