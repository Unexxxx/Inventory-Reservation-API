const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';

async function call(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function createItem(): Promise<any> {
  return call('/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"initialQuantity":10}' });
}

async function reserve(itemId: string, suffix: string, expiresAt?: string): Promise<any> {
  return call('/reservations', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `retry-${Date.now()}-${suffix}` },
    body: JSON.stringify({ itemId, customerId: suffix, quantity: 2, ...(expiresAt ? { expiresAt } : {}) })
  });
}

const confirmedItem = await createItem();
const confirmed = await reserve(confirmedItem.id, 'confirm');
await Promise.all(Array.from({ length: 100 }, () => call(`/reservations/${confirmed.id}/confirm`, { method: 'POST' })));
const confirmedInventory = await call(`/items/${confirmedItem.id}`);
if (confirmedInventory.confirmedQuantity !== 2 || confirmedInventory.heldQuantity !== 0) throw new Error('Confirmation was not exactly once.');

const cancelledItem = await createItem();
const cancelled = await reserve(cancelledItem.id, 'cancel');
await Promise.all(Array.from({ length: 100 }, () => call(`/reservations/${cancelled.id}/cancel`, { method: 'POST' })));
const cancelledInventory = await call(`/items/${cancelledItem.id}`);
if (cancelledInventory.availableQuantity !== 10 || cancelledInventory.heldQuantity !== 0) throw new Error('Cancellation was not exactly once.');

await Promise.all(Array.from({ length: 100 }, () => call('/reservations/expire', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"limit":500}'
})));
console.log(JSON.stringify({ confirmationRetries: 100, cancellationRetries: 100, expirationRetries: 100, result: 'PASS' }, null, 2));
