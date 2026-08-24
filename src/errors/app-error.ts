import type { DatabaseOutcome } from '../types/domain.js';

export const errorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INSUFFICIENT_INVENTORY: 'INSUFFICIENT_INVENTORY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  RESERVATION_STATE_CONFLICT: 'RESERVATION_STATE_CONFLICT',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorForOutcome(outcome: DatabaseOutcome): AppError {
  switch (outcome) {
    case 'not_found':
      return new AppError(404, errorCodes.NOT_FOUND, 'Requested resource was not found.');
    case 'insufficient_inventory':
      return new AppError(409, errorCodes.INSUFFICIENT_INVENTORY, 'Requested quantity is not available.');
    case 'invalid_expiration':
      return new AppError(400, errorCodes.VALIDATION_ERROR, 'Request validation failed.', {
        fields: { expires_at: 'Expiration must be later than server time.' }
      });
    case 'idempotency_conflict':
      return new AppError(409, errorCodes.IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with different input.');
    case 'expired':
      return new AppError(409, errorCodes.RESERVATION_EXPIRED, 'Expired reservations cannot be confirmed.');
    case 'state_conflict':
      return new AppError(409, errorCodes.RESERVATION_STATE_CONFLICT, 'Reservation cannot transition from its current state.');
    default:
      return new AppError(500, errorCodes.INTERNAL_ERROR, 'An unexpected error occurred.');
  }
}
