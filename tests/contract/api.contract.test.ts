import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const itemId = '123e4567-e89b-42d3-a456-426614174000';
const reservationId = '123e4567-e89b-42d3-a456-426614174001';
const item = { id: itemId, totalQuantity: 10, availableQuantity: 10, heldQuantity: 0, confirmedQuantity: 0, createdAt: '2026-08-19T00:00:00.000Z' };
const reservation = { id: reservationId, itemId, customerId: 'customer-1', quantity: 2, status: 'pending' as const, createdAt: '2026-08-19T00:00:00.000Z', expiresAt: '2099-08-19T00:15:00.000Z' };

vi.mock('../../src/db/repositories/items.repository.js', () => ({
  createItem: vi.fn(async () => item), getItemInventory: vi.fn(async () => item)
}));
vi.mock('../../src/db/repositories/reservations.repository.js', () => ({
  createReservationAtomic: vi.fn(async () => ({ outcome: 'created', reservation })),
  confirmReservationAtomic: vi.fn(async () => ({ outcome: 'confirmed', reservation: { ...reservation, status: 'confirmed' } })),
  cancelReservationAtomic: vi.fn(async () => ({ outcome: 'cancelled', reservation: { ...reservation, status: 'cancelled' } })),
  expireReservationsAtomic: vi.fn(async () => ({ expiredCount: 0, hasMore: false }))
}));

process.env.DATABASE_URL = 'postgresql://inventory_api_login:secret@example.com/db';
const { default: app } = await import('../../src/app.js');
const { openApiDocument } = await import('../../src/docs/openapi.js');
const reservationRepository = await import('../../src/db/repositories/reservations.repository.js');

describe('API contract', () => {
  it('creates items and validates bodies', async () => {
    expect((await request(app).post('/items').send({ initialQuantity: 10 })).status).toBe(201);
    const invalid = await request(app).post('/items').send({ initialQuantity: 0 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('retrieves inventory and validates identifiers', async () => {
    expect((await request(app).get(`/items/${itemId}`)).body).toEqual(item);
    expect((await request(app).get('/items/not-a-uuid')).status).toBe(400);
  });

  it('requires an idempotency key and creates reservations', async () => {
    const body = { itemId, customerId: 'customer-1', quantity: 2, expiresAt: '2099-01-01T00:00:00Z' };
    expect((await request(app).post('/reservations').send(body)).status).toBe(400);
    const created = await request(app).post('/reservations').set('Idempotency-Key', 'request-1').send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: reservationId, status: 'pending' });
  });

  it('returns 200 for creation replay and maps expected creation failures', async () => {
    const body = { itemId, customerId: 'customer-1', quantity: 2, expiresAt: '2099-01-01T00:00:00Z' };
    vi.mocked(reservationRepository.createReservationAtomic)
      .mockResolvedValueOnce({ outcome: 'replayed', reservation })
      .mockResolvedValueOnce({ outcome: 'not_found' })
      .mockResolvedValueOnce({ outcome: 'insufficient_inventory' })
      .mockResolvedValueOnce({ outcome: 'idempotency_conflict' });
    expect((await request(app).post('/reservations').set('Idempotency-Key', 'replay').send(body)).status).toBe(200);
    expect((await request(app).post('/reservations').set('Idempotency-Key', 'missing').send(body)).status).toBe(404);
    expect((await request(app).post('/reservations').set('Idempotency-Key', 'insufficient').send(body)).body.error.code).toBe('INSUFFICIENT_INVENTORY');
    expect((await request(app).post('/reservations').set('Idempotency-Key', 'conflict').send(body)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('confirms, cancels, and expires reservations', async () => {
    expect((await request(app).post(`/reservations/${reservationId}/confirm`)).body.status).toBe('confirmed');
    expect((await request(app).post(`/reservations/${reservationId}/cancel`)).body.status).toBe('cancelled');
    expect((await request(app).post('/reservations/expire').send({ limit: 10 })).body).toEqual({ expiredCount: 0, hasMore: false });
    expect((await request(app).post('/reservations/expire').send({ limit: 1001 })).status).toBe(400);
  });

  it('maps lifecycle not-found, expired, and state conflicts', async () => {
    vi.mocked(reservationRepository.confirmReservationAtomic)
      .mockResolvedValueOnce({ outcome: 'not_found' })
      .mockResolvedValueOnce({ outcome: 'expired' })
      .mockResolvedValueOnce({ outcome: 'state_conflict' });
    expect((await request(app).post(`/reservations/${reservationId}/confirm`)).status).toBe(404);
    expect((await request(app).post(`/reservations/${reservationId}/confirm`)).body.error.code).toBe('RESERVATION_EXPIRED');
    expect((await request(app).post(`/reservations/${reservationId}/confirm`)).body.error.code).toBe('RESERVATION_STATE_CONFLICT');
  });

  it('serves the authoritative OpenAPI document and Swagger UI', async () => {
    const document = await request(app).get('/openapi.json');
    expect(document.status).toBe(200);
    expect(document.body).toEqual(openApiDocument);
    expect(Object.keys(document.body.paths)).toHaveLength(8);
    expect((await request(app).get('/docs/')).type).toMatch(/html/);
  });

  it('documents every applicable response status', () => {
    const paths = openApiDocument.paths;
    expect(Object.keys(paths['/reservations'].post.responses)).toEqual(expect.arrayContaining(['200', '201', '400', '404', '409', '500']));
    expect(Object.keys(paths['/reservations/{reservationId}/confirm'].post.responses)).toEqual(expect.arrayContaining(['200', '400', '404', '409', '500']));
  });

  it('keeps the generated YAML snapshot equal to the runtime document', async () => {
    const snapshotUrl = new URL('../../specs/001-inventory-reservations/contracts/openapi.yaml', import.meta.url);
    expect(parse(await readFile(snapshotUrl, 'utf8'))).toEqual(openApiDocument);
  });

  it('returns a consistent unknown-route error', async () => {
    const response = await request(app).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Requested resource was not found.' } });
  });
});
