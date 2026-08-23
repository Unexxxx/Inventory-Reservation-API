export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface ItemInventory {
  id: string;
  totalQuantity: number;
  availableQuantity: number;
  heldQuantity: number;
  confirmedQuantity: number;
  createdAt: string;
}

export interface Reservation {
  id: string;
  itemId: string;
  customerId: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: string;
  expiresAt: string;
}

export interface ExpirationResult {
  expiredCount: number;
  hasMore: boolean;
}

export type DatabaseOutcome =
  | 'created'
  | 'replayed'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'not_found'
  | 'invalid_expiration'
  | 'insufficient_inventory'
  | 'idempotency_conflict'
  | 'state_conflict';

export interface ReservationDatabaseResult {
  outcome: DatabaseOutcome;
  reservation?: Reservation;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
