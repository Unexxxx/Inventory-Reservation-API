import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanDatabase, closeIntegrationDatabase, integrationSql, testDatabaseUrl } from './helpers/database.js';

async function pendingReservation(minutes = 15): Promise<{ itemId: string; reservationId: string }> {
  const { item } = (await integrationSql!<{ item: { id: string } }[]>`select public.create_item_atomic('Lifecycle test', 5) item`)[0]!;
  const { result } = (await integrationSql!<{ result: { reservation: { id: string } } }[]>`
    select public.create_reservation_atomic(${item.id}, 'customer', 2, clock_timestamp() + (${minutes} * interval '1 minute'), ${randomUUID()}, ${randomBytes(32).toString('hex')}) result`)[0]!;
  return { itemId: item.id, reservationId: result.reservation.id };
}

describe.skipIf(!testDatabaseUrl)('reservation lifecycle', () => {
  beforeEach(cleanDatabase);
  afterAll(closeIntegrationDatabase);

  it('confirms exactly once under simultaneous calls', async () => {
    const { itemId, reservationId } = await pendingReservation();
    await Promise.all(Array.from({ length: 20 }, () => integrationSql!`select public.confirm_reservation_atomic(${reservationId})`));
    const { inventory } = (await integrationSql!<{ inventory: Record<string, unknown> }[]>`select public.get_item_inventory(${itemId}) inventory`)[0]!;
    expect(inventory).toMatchObject({ availableQuantity: 3, heldQuantity: 0, confirmedQuantity: 2 });
  });

  it('cancels exactly once and never restores confirmed inventory', async () => {
    const first = await pendingReservation();
    await Promise.all(Array.from({ length: 20 }, () => integrationSql!`select public.cancel_reservation_atomic(${first.reservationId})`));
    expect((await integrationSql!<{ result: { outcome: string } }[]>`select public.cancel_reservation_atomic(${first.reservationId}) result`)[0]?.result.outcome).toBe('cancelled');
    const second = await pendingReservation();
    await integrationSql!`select public.confirm_reservation_atomic(${second.reservationId})`;
    expect((await integrationSql!<{ result: { outcome: string } }[]>`select public.cancel_reservation_atomic(${second.reservationId}) result`)[0]?.result.outcome).toBe('state_conflict');
  });

  it('drains expired reservations in bounded batches', async () => {
    await Promise.all([pendingReservation(0.002), pendingReservation(0.002), pendingReservation(0.002)]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const first = (await integrationSql!<{ result: { expiredCount: number; hasMore: boolean } }[]>`select public.expire_reservations_atomic(2) result`)[0]!.result;
    const second = (await integrationSql!<{ result: { expiredCount: number; hasMore: boolean } }[]>`select public.expire_reservations_atomic(2) result`)[0]!.result;
    expect(first).toEqual({ expiredCount: 2, hasMore: true });
    expect(second).toEqual({ expiredCount: 1, hasMore: false });
  });

  it('makes retries safe after an ambiguous confirmation result', async () => {
    const { itemId, reservationId } = await pendingReservation();
    const first = (await integrationSql!<{ result: { outcome: string } }[]>`select public.confirm_reservation_atomic(${reservationId}) result`)[0]!.result;
    const retry = (await integrationSql!<{ result: { outcome: string } }[]>`select public.confirm_reservation_atomic(${reservationId}) result`)[0]!.result;
    expect(first.outcome).toBe('confirmed');
    expect(retry.outcome).toBe('confirmed');
    const inventory = (await integrationSql!<{ result: Record<string, unknown> }[]>`select public.get_item_inventory(${itemId}) result`)[0]!.result;
    expect(inventory).toMatchObject({ heldQuantity: 0, confirmedQuantity: 2 });
  });

  it('resolves confirmation-versus-cancellation to one legal terminal state', async () => {
    const { itemId, reservationId } = await pendingReservation();
    await Promise.all([
      integrationSql!`select public.confirm_reservation_atomic(${reservationId})`,
      integrationSql!`select public.cancel_reservation_atomic(${reservationId})`
    ]);
    const [row] = await integrationSql!<{ status: string }[]>`select status from public.reservations where id = ${reservationId}`;
    expect(['confirmed', 'cancelled']).toContain(row?.status);
    const inventory = (await integrationSql!<{ result: Record<string, unknown> }[]>`select public.get_item_inventory(${itemId}) result`)[0]!.result;
    expect(Number(inventory.availableQuantity) + Number(inventory.heldQuantity) + Number(inventory.confirmedQuantity)).toBe(5);
  });
});
