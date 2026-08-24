# Quickstart and Delivery Guide: Inventory Reservation API

This guide defines the reproducible path the implementation and final README must
support. Commands assume the repository root and Node.js 24.x.

## 1. Supabase Setup

1. Create a Supabase project and wait for its PostgreSQL database to become ready.
2. In **Connect**, copy the transaction pooler host, port `6543`, project reference, and
   database name. Do not reuse the displayed migration-owner username at runtime.
3. Open **SQL Editor**, paste the complete contents of
   `supabase/migrations/001_inventory_reservations.sql`, and run it once.
4. Provision a separate LOGIN role with a generated password, grant it membership in the
   migration-defined `inventory_api` NOLOGIN privilege role, and use that login in
   `DATABASE_URL`. Never place the password in the migration or connect the deployed API
   as the migration owner.
5. Re-run the migration in a disposable clean project during verification to prove it
   has no hidden prerequisites. Do not rerun it on an already-migrated project unless
   the migration explicitly documents idempotency.

## 2. Environment

Copy `.env.example` to `.env` and set:

```dotenv
DATABASE_URL=postgresql://inventory_api_login.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:6543/postgres
PORT=3000
RESERVATION_TTL_MINUTES=15
```

`DATABASE_URL` is required and secret. Startup validation must reject Supabase
`postgres`/migration-owner usernames and accept only the provisioned runtime login.
`PORT` is local-only. The TTL must be a positive whole number and controls the expiration
used when callers omit `expires_at`.

## 3. Install and Run

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Verify:

```bash
curl http://localhost:3000/openapi.json
```

Open `http://localhost:3000/docs` for Swagger UI.

## 4. Smoke Scenario

Create an item:

```bash
curl -X POST http://localhost:3000/v1/items \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo item","initial_quantity":10}'
```

Use the returned item ID to create a reservation:

```bash
curl -X POST http://localhost:3000/v1/reservations \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-customer-1-reservation-1' \
  -d '{"item_id":"ITEM_UUID","customer_id":"customer-1","quantity":4}'
```

Repeat the exact request and verify HTTP 200 returns the same reservation. Change the
quantity while reusing the key and verify HTTP 409. Retrieve item status:

```bash
curl http://localhost:3000/v1/items/ITEM_UUID
```

Expected quantities are total 10, available 6, held 4, confirmed 0.

Confirm twice and verify the second response is unchanged:

```bash
curl -X POST http://localhost:3000/v1/reservations/RESERVATION_UUID/confirm
curl -X POST http://localhost:3000/v1/reservations/RESERVATION_UUID/confirm
```

Expected final quantities are total 10, available 6, held 0, confirmed 4.

For expiration, call `POST /v1/maintenance/expire-reservations` repeatedly until the response returns
`hasMore: false`; each call processes at most the requested batch limit.

## 5. Required Automated Verification

```bash
npm run test:unit
npm run test:contract
npm run test:integration
```

Integration verification must use an isolated migrated database and cover:

- initial and derived inventory quantities;
- insufficient-inventory rejection without side effects;
- identical and conflicting idempotency-key retries;
- repeated confirmation and cancellation;
- 100 repeated calls each for confirmation, cancellation, and expiration with exactly
  one inventory effect;
- cancellation after confirmation;
- confirmation at/after expiration;
- expiration excluding overdue holds before and after persisted cleanup;
- races among confirmation, cancellation, and expiration.

## 6. Concurrency Reproduction

With the API running and an item containing only the configured final units:

```bash
API_BASE_URL=http://localhost:3000 \
CONCURRENCY=100 \
npm run test:concurrency
npm run test:retries
```

The script must create 100 simultaneous reservation requests with unique idempotency
keys, print status counts, fetch final inventory, and exit nonzero unless all are true:

- successful reserved quantity does not exceed the item's total;
- held plus confirmed equals successful reserved quantity;
- available is never negative;
- total equals available plus held plus confirmed;
- excess requests return HTTP 409 with `INSUFFICIENT_INVENTORY`.

Run the same scenario multiple times. The README must include commands, sample output,
and an explanation of the per-item database lock that prevents overselling.

`test:retries` must perform 100 confirmation retries, 100 cancellation retries, and 100
expiration retries and exit nonzero if any reservation quantity affects inventory more
than once.

## 7. Vercel Deployment

1. Import the repository into Vercel.
2. Set `DATABASE_URL` to the Supabase transaction pooler URI and set
   `RESERVATION_TTL_MINUTES=15` in project environment variables.
3. Select Node.js 24.x if project settings do not honor `package.json` engines.
4. Confirm the deployment uses the least-privileged `inventory_api` database role rather
   than migration-owner credentials.
5. Deploy, then smoke-test `/openapi.json`, `/docs`, item creation, reservation creation,
   confirmation, cancellation, and expiration against the deployment.
6. Put the final deployment URL and demo video URL into the README; do not claim these
   are complete while placeholders remain.

## 8. README Completion Checklist

The final README must include:

- architecture summary and database consistency strategy;
- Supabase creation, transaction pooler, and SQL Editor migration steps;
- prerequisites, install, environment, local run, typecheck, and test commands;
- endpoint overview plus `/docs` and `/openapi.json` links;
- Vercel configuration and deployment steps;
- reproducible concurrency and retry scenarios with expected results;
- assumptions, limitations, and trade-offs from the specification;
- deployed URL and demo video link.
