const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const concurrency = Number(process.env.CONCURRENCY ?? 100);

async function jsonRequest(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

const createdItem = await jsonRequest('/items', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initialQuantity: 10 })
});
if (createdItem.status !== 201) throw new Error(`Could not create item: ${JSON.stringify(createdItem.body)}`);

const attempts = await Promise.all(Array.from({ length: concurrency }, (_, index) => jsonRequest('/reservations', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': `contention-${Date.now()}-${index}` },
  body: JSON.stringify({ itemId: createdItem.body.id, customerId: `customer-${index}`, quantity: 1 })
})));

const successes = attempts.filter((result) => result.status === 201);
const conflicts = attempts.filter((result) => result.status === 409);
const inventory = await jsonRequest(`/items/${createdItem.body.id}`);
console.log(JSON.stringify({ requests: concurrency, successes: successes.length, conflicts: conflicts.length, inventory: inventory.body }, null, 2));

if (successes.length > 10 || inventory.body.availableQuantity < 0 ||
    inventory.body.totalQuantity !== inventory.body.availableQuantity + inventory.body.heldQuantity + inventory.body.confirmedQuantity ||
    conflicts.some((result) => result.body?.error?.code !== 'INSUFFICIENT_INVENTORY')) {
  throw new Error('Inventory contention invariant failed.');
}
