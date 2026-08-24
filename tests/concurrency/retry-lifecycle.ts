const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';

async function call(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function createItem(): Promise<any> {
  return call('/v1/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Retry test item","initial_quantity":10}' });
}

async function reserve(itemId: string, suffix: string, expiresAt?: string): Promise<any> {
  return call('/v1/reservations', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `retry-${Date.now()}-${suffix}` },
    body: JSON.stringify({ item_id: itemId, customer_id: suffix, quantity: 2, ...(expiresAt ? { expires_at: expiresAt } : {}) })
  });
}

const confirmedItem = await createItem();
const confirmed = await reserve(confirmedItem.id, 'confirm');
await Promise.all(Array.from({ length: 100 }, () => call(`/v1/reservations/${confirmed.id}/confirm`, { method: 'POST' })));
const confirmedInventory = await call(`/v1/items/${confirmedItem.id}`);
if (confirmedInventory.confirmedQuantity !== 2 || confirmedInventory.heldQuantity !== 0) throw new Error('Confirmation was not exactly once.');

const cancelledItem = await createItem();
const cancelled = await reserve(cancelledItem.id, 'cancel');
await Promise.all(Array.from({ length: 100 }, () => call(`/v1/reservations/${cancelled.id}/cancel`, { method: 'POST' })));
const cancelledInventory = await call(`/v1/items/${cancelledItem.id}`);
if (cancelledInventory.availableQuantity !== 10 || cancelledInventory.heldQuantity !== 0) throw new Error('Cancellation was not exactly once.');

const expiredItem = await createItem();
await reserve(expiredItem.id, 'expire', new Date(Date.now() + 1_000).toISOString());
await new Promise((resolve) => setTimeout(resolve, 1_100));
await Promise.all(Array.from({ length: 100 }, () => call('/v1/maintenance/expire-reservations', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"limit":500}'
})));
const expiredInventory = await call(`/v1/items/${expiredItem.id}`);
if (expiredInventory.availableQuantity !== 10 || expiredInventory.heldQuantity !== 0) throw new Error('Expiration did not release inventory exactly once.');
console.log(JSON.stringify({ confirmationRetries: 100, cancellationRetries: 100, expirationRetries: 100, result: 'PASS' }, null, 2));
