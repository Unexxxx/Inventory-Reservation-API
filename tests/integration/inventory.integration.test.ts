import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanDatabase, closeIntegrationDatabase, integrationSql, testDatabaseUrl } from './helpers/database.js';

describe.skipIf(!testDatabaseUrl)('inventory database functions', () => {
  beforeEach(cleanDatabase);
  afterAll(closeIntegrationDatabase);

  it('creates an item and derives held inventory', async () => {
    const key = randomUUID();
    const { item } = (await integrationSql!<{ item: Record<string, unknown> }[]>`select public.create_item_atomic(10) item`)[0]!;
    const result = await integrationSql!<{ result: Record<string, unknown> }[]>`
      select public.create_reservation_atomic(${item.id as string}, 'customer', 4, clock_timestamp() + interval '15 minutes', ${key}, ${'a'.repeat(64)}) result`;
    expect(result[0]?.result.outcome).toBe('created');
    const { inventory } = (await integrationSql!<{ inventory: Record<string, unknown> }[]>`select public.get_item_inventory(${item.id as string}) inventory`)[0]!;
    expect(inventory).toMatchObject({ totalQuantity: 10, availableQuantity: 6, heldQuantity: 4, confirmedQuantity: 0 });
  });

  it('serializes 100 contenders without overselling', async () => {
    const prefix = randomUUID();
    const { item } = (await integrationSql!<{ item: Record<string, unknown> }[]>`select public.create_item_atomic(10) item`)[0]!;
    const outcomes = await Promise.all(Array.from({ length: 100 }, (_, index) => integrationSql!<{ result: { outcome: string } }[]>`
      select public.create_reservation_atomic(${item.id as string}, ${`customer-${index}`}, 1, clock_timestamp() + interval '15 minutes', ${`${prefix}-${index}`}, ${index.toString(16).padStart(64, '0')}) result`
    ));
    expect(outcomes.flat().filter((row) => row.result.outcome === 'created')).toHaveLength(10);
    const { inventory } = (await integrationSql!<{ inventory: Record<string, unknown> }[]>`select public.get_item_inventory(${item.id as string}) inventory`)[0]!;
    expect(inventory).toMatchObject({ availableQuantity: 0, heldQuantity: 10, confirmedQuantity: 0 });
  });

  it('makes concurrent identical first use resolve to one reservation', async () => {
    const key = randomUUID();
    const { item } = (await integrationSql!<{ item: Record<string, unknown> }[]>`select public.create_item_atomic(2) item`)[0]!;
    const call = () => integrationSql!<{ result: { outcome: string; reservation: { id: string } } }[]>`
      select public.create_reservation_atomic(${item.id as string}, 'customer', 1, clock_timestamp() + interval '15 minutes', ${key}, ${'b'.repeat(64)}) result`;
    const rows = (await Promise.all([call(), call()])).flat();
    expect(new Set(rows.map((row) => row.result.reservation.id)).size).toBe(1);
    expect(rows.map((row) => row.result.outcome).sort()).toEqual(['created', 'replayed']);
  });

  it('rejects insufficient inventory and conflicting idempotency reuse without state change', async () => {
    const { item } = (await integrationSql!<{ item: { id: string } }[]>`select public.create_item_atomic(2) item`)[0]!;
    const firstKey = randomUUID();
    await integrationSql!`select public.create_reservation_atomic(${item.id}, 'customer', 2, clock_timestamp() + interval '15 minutes', ${firstKey}, ${'c'.repeat(64)})`;
    const insufficient = (await integrationSql!<{ result: { outcome: string } }[]>`
      select public.create_reservation_atomic(${item.id}, 'other', 1, clock_timestamp() + interval '15 minutes', ${randomUUID()}, ${'d'.repeat(64)}) result`)[0]!.result;
    const conflicting = (await integrationSql!<{ result: { outcome: string } }[]>`
      select public.create_reservation_atomic(${item.id}, 'customer', 2, clock_timestamp() + interval '15 minutes', ${firstKey}, ${'e'.repeat(64)}) result`)[0]!.result;
    expect(insufficient.outcome).toBe('insufficient_inventory');
    expect(conflicting.outcome).toBe('idempotency_conflict');
    const inventory = (await integrationSql!<{ result: Record<string, unknown> }[]>`select public.get_item_inventory(${item.id}) result`)[0]!.result;
    expect(inventory).toMatchObject({ availableQuantity: 0, heldQuantity: 2 });
  });

  it('rejects an expiration at database time and rolls back a surrounding failed transaction', async () => {
    const { item } = (await integrationSql!<{ item: { id: string } }[]>`select public.create_item_atomic(2) item`)[0]!;
    const invalid = (await integrationSql!<{ result: { outcome: string } }[]>`
      select public.create_reservation_atomic(${item.id}, 'customer', 1, clock_timestamp(), ${randomUUID()}, ${'f'.repeat(64)}) result`)[0]!.result;
    expect(invalid.outcome).toBe('invalid_expiration');
    const key = randomUUID();
    await expect(integrationSql!.begin(async (transaction) => {
      await transaction`select public.create_reservation_atomic(${item.id}, 'customer', 1, clock_timestamp() + interval '15 minutes', ${key}, ${'1'.repeat(64)})`;
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');
    const { count } = (await integrationSql!<{ count: number }[]>`select count(*)::integer count from public.reservations where idempotency_key = ${key}`)[0]!;
    expect(count).toBe(0);
  });
});
import { randomUUID } from 'node:crypto';
