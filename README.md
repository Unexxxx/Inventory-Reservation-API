# Inventory Reservation API

An Express 5 and TypeScript API for atomic, retry-safe inventory reservations backed by
Supabase PostgreSQL and packaged as one Vercel Node.js Function.

## Submission Links

- GitHub repository: [https://github.com/Unexxxx/Inventory-Reservation-API](https://github.com/Unexxxx/Inventory-Reservation-API)
- Deployed API: [https://inventory-reservation-api-phi.vercel.app](https://inventory-reservation-api-phi.vercel.app)
- Swagger UI: [https://inventory-reservation-api-phi.vercel.app/docs/](https://inventory-reservation-api-phi.vercel.app/docs/)
- OpenAPI JSON: [https://inventory-reservation-api-phi.vercel.app/openapi.json](https://inventory-reservation-api-phi.vercel.app/openapi.json)
- Demo video: **Pending recording**

Replace the demo-video placeholder with its public URL before final submission.

## Architecture and Consistency

Routes, controllers, services, Zod validation, and Postgres.js repositories are kept
separate. PostgreSQL is the transaction boundary: runtime writes occur only through
hardened `SECURITY DEFINER` functions. Creation serializes on an idempotency-key advisory
lock and then the item row; lifecycle operations lock the reservation row. Constraints,
foreign keys, partial indexes, state guards, and a least-privileged runtime role protect
consistency even if application code is bypassed.

```text
held = pending reservations whose expires_at is in the future
confirmed = confirmed reservation quantities
available = total - held - confirmed
```

Overdue rows stop blocking availability immediately. Confirmation at or after expiration
expires the hold atomically. Repeated creation, confirmation, cancellation, and
expiration cannot apply the same inventory effect twice.

## API

| Method | Path | Success | Purpose |
|---|---|---:|---|
| `POST` | `/v1/items` | 201 | Create a named item |
| `GET` | `/v1/items/{itemId}` | 200 | Retrieve inventory status |
| `POST` | `/v1/reservations` | 201/200 | Create or replay a reservation |
| `POST` | `/v1/reservations/{reservationId}/confirm` | 200 | Confirm a reservation |
| `POST` | `/v1/reservations/{reservationId}/cancel` | 200 | Cancel a reservation |
| `POST` | `/v1/maintenance/expire-reservations` | 200 | Expire one bounded batch |

Production [Swagger UI](https://inventory-reservation-api-phi.vercel.app/docs/) is at
`/docs`; authoritative [OpenAPI JSON](https://inventory-reservation-api-phi.vercel.app/openapi.json)
is at `/openapi.json`. Errors use
`{ "error": { "code": "...", "message": "...", "details": {} } }`.

## Supabase Setup and Migration

Prerequisites are Node.js 24.x, npm, and a Supabase project.

1. In Supabase **Connect**, copy the transaction-mode pooler details (normally port
   `6543`). The client already disables prepared statements as transaction mode requires.
2. For a new/clean database, in **SQL Editor**, paste and run
   `supabase/migrations/001_inventory_reservations.sql` once. It
   creates the schema, `inventory_api` NOLOGIN role, indexes, functions, revocations,
   and grants in one transaction.
3. If you already ran migration `001` before item names were added, instead paste and
   run `supabase/migrations/002_add_item_name.sql`. It preserves existing data, assigns
   readable placeholder names to existing items, adds the constraint, and updates the
   database functions. Do not run `001` again on an existing database.
4. As an owner, provision the separate runtime login without committing its password
   (skip this if you already created it):

   ```sql
   create role inventory_api_login login password 'GENERATE_A_STRONG_SECRET';
   grant inventory_api to inventory_api_login;
   ```

5. Build the pooler URL with that login. Never use `postgres`, `supabase_admin`, or a
   migration-owner credential at runtime.

The migration targets a clean database and is not advertised as rerunnable. Rehearse it
in a disposable project/database before production use.

## Environment and Local Development

```bash
npm install
cp .env.example .env
```

```dotenv
DATABASE_URL=postgresql://inventory_api_login.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:6543/postgres
PORT=3000
RESERVATION_TTL_MINUTES=15
```

`DATABASE_URL` is required and secret. `PORT` defaults to 3000. The TTL must be a
positive whole number and applies when `expires_at` is omitted.

```bash
npm run typecheck
npm test
npm run dev
```

## Smoke Scenario

```bash
curl -X POST http://localhost:3000/v1/items \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo item","initial_quantity":10}'

curl -X POST http://localhost:3000/v1/reservations \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-customer-1-reservation-1' \
  -d '{"item_id":"ITEM_UUID","customer_id":"customer-1","quantity":4}'

curl http://localhost:3000/v1/items/ITEM_UUID
curl -X POST http://localhost:3000/v1/reservations/RESERVATION_UUID/confirm
curl -X POST http://localhost:3000/v1/reservations/RESERVATION_UUID/confirm
curl -X POST http://localhost:3000/v1/maintenance/expire-reservations \
  -H 'Content-Type: application/json' -d '{"limit":500}'
```

`Idempotency-Key` is optional for assignment-compatible clients. Supplying it is
recommended when a client may retry an ambiguous creation request. The first reservation
returns 201. Repeating the same key and body returns 200 with the
original reservation; changed input with that key returns 409. A 4-unit hold reports
`10/6/4/0`; after confirmation it reports `10/6/0/4`.

## Verification and Concurrency

```bash
npm run typecheck
npm run test:unit
npm run test:contract
TEST_DATABASE_URL='postgresql://inventory_api_login...' npm run test:integration
```

Database tests require an isolated migrated database and the dedicated runtime login.
Set optional `TEST_DATABASE_ADMIN_URL` to a disposable owner connection when automatic
table cleanup is desired; runtime tests themselves continue to use `TEST_DATABASE_URL`.
They skip explicitly when `TEST_DATABASE_URL` is absent; a skipped suite is not proof of
database correctness. Coverage includes derived inventory, contention, idempotency,
exactly-once lifecycle operations, expiration draining, and privilege boundaries.

With the API running against that database:

```bash
API_BASE_URL=http://localhost:3000 CONCURRENCY=100 npm run test:concurrency
API_BASE_URL=http://localhost:3000 npm run test:retries
```

Representative expected output is 100 requests, 10 successes, 90
`INSUFFICIENT_INVENTORY` conflicts, and inventory totals of `10/0/10/0`. Scripts exit
nonzero if quantity exceeds total, availability is negative, the inventory equation
fails, or retries apply more than one effect. Generate the contract snapshot with
`npm run openapi:generate`; contract tests fail when it is stale.

## Vercel Deployment

1. Import this repository into Vercel.
2. Add `DATABASE_URL` and `RESERVATION_TTL_MINUTES` as environment variables.
3. Select Node.js 24.x. `vercel.json` routes all paths to `api/index.ts`.
4. Deploy and smoke-test `/openapi.json`, `/docs`, and every `/v1` lifecycle operation.
5. Confirm the database URL uses the dedicated runtime login.
6. Record a 5–10 minute demo showing local startup, Swagger, an item with quantity 5,
   reservation creation, cancellation or expiration restoring availability, and the
   corresponding Supabase rows. Upload it with public/link access and replace the
   pending demo value above.

## Assumptions, Limitations, and Trade-offs

- Authentication, frontend, payments, registration, workers, and an admin portal are
  intentionally excluded.
- Customer IDs are opaque references. Each reservation covers one item; catalog fields,
  replenishment, returns, and multi-item transactions are out of scope.
- Item totals are immutable after creation through this API.
- Expiration is caller-triggered or observed during database operations. Reads still
  exclude overdue holds immediately without a worker.
- Same-item creation is serialized for correctness, trading peak same-item throughput
  for reviewable overselling protection. Different items proceed independently.
- Quantities are restricted to JavaScript's safe integer range although PostgreSQL uses
  `bigint`.
- An omitted-expiration retry preserves its originally stored expiration; its request
  fingerprint uses the stable `DEFAULT_TTL` sentinel.
