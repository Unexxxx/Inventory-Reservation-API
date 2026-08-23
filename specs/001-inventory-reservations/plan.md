# Implementation Plan: Inventory Reservation API

**Branch**: `001-inventory-reservations` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-inventory-reservations/spec.md`

## Summary

Build one Express 5 TypeScript API deployed as a Vercel Node.js Function and connected
to Supabase PostgreSQL through its serverless transaction pooler. Keep HTTP routing,
controllers, Zod validation, business services, and database access separate. Store the
authoritative item quantity and reservation lifecycle in PostgreSQL; expose narrow SQL
functions that perform creation, confirmation, cancellation, and expiration atomically.
Serialize competing reservation creation on the item row, derive inventory totals from
reservation state, and enforce retry safety with a unique idempotency key and legal
state transitions. Deliver a checked-in OpenAPI contract, Swagger UI, direct SQL Editor
migration, focused tests, concurrency script, Vercel configuration, and complete README.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24.x  
**Primary Dependencies**: Express 5, Zod, Postgres.js, swagger-ui-express; Vitest and
Supertest for verification  
**Storage**: Supabase PostgreSQL; runtime uses Supavisor transaction-mode `DATABASE_URL`
with prepared statements disabled  
**Testing**: Vitest unit and HTTP contract tests, Supertest, database integration tests,
and a Node.js concurrent-request script against a migrated test database  
**Target Platform**: Vercel Node.js Function plus local Node.js process  
**Project Type**: Single REST web service  
**Performance Goals**: Preserve correctness across the specified 100-request contention
and retry scenarios; record observed operation timings for review without adding a
non-required latency guarantee  
**Constraints**: Four-hour implementation timebox; no frontend, authentication, payment,
user registration, worker, or admin system; UTC timestamps; one item per reservation;
SQL migrations must paste and run in Supabase SQL Editor  
**Scale/Scope**: Assignment-scale API with six business operations, two tables, one
serverless entry point, and contention serialized per item rather than globally

## Constitution Check

*GATE: Passed before Phase 0 research; passed again after Phase 1 design.*

- **Database correctness — PASS**: `items.total_quantity`, reservation quantities,
  statuses, timestamps, uniqueness, and relationships use database constraints. A
  least-privileged runtime role cannot perform direct table DML and can execute only
  hardened `SECURITY DEFINER` mutation functions with fixed search paths and explicit
  grants. Reservation creation locks the item row before checking availability, while
  item status derives held and confirmed totals.
- **Atomic lifecycle — PASS**: Each mutation is one PostgreSQL function call and one
  transaction. Creation locks by idempotency key and item; confirmation and cancellation
  lock the reservation; expiration performs a guarded set update. Legal transitions and
  same-state retry outcomes are explicit.
- **Application boundaries — PASS**: Routes register paths, controllers map HTTP,
  validators parse inputs, services express use cases, repositories invoke SQL, and
  middleware maps errors. No business rules live in route handlers.
- **HTTP contract — PASS**: Zod schemas validate all inputs; one error envelope and
  explicit status mapping are defined by authoritative `src/docs/openapi.ts`, with
  `contracts/openapi.yaml` retained as a verified planning snapshot.
- **Simplicity — PASS**: One service, one database client, two tables, one migration,
  and focused dependencies fit the timebox. No repository framework, ORM, queue, cache,
  or background worker is introduced.
- **Verification and delivery — PASS**: Plan includes unit, contract, integration,
  contention, retry, and expiration checks plus README coverage for setup, migrations,
  deployment, assumptions, limitations, trade-offs, deployed URL, and demo link.

### Post-Design Re-check

The data model, SQL-function boundaries, OpenAPI contract, and quickstart preserve all
six gates. No complexity exception or constitution violation remains.

## Project Structure

### Documentation (this feature)

```text
specs/001-inventory-reservations/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
└── tasks.md
```

### Source Code (repository root)

```text
api/
└── index.ts
src/
├── app.ts
├── server.ts
├── config/
│   └── env.ts
├── controllers/
│   ├── items.controller.ts
│   └── reservations.controller.ts
├── db/
│   ├── client.ts
│   └── repositories/
│       ├── items.repository.ts
│       └── reservations.repository.ts
├── docs/
│   └── openapi.ts              # Authoritative runtime OpenAPI document
├── errors/
│   └── app-error.ts
├── middleware/
│   ├── error-handler.ts
│   ├── not-found.ts
│   └── validate.ts
├── routes/
│   ├── index.ts
│   ├── items.routes.ts
│   └── reservations.routes.ts
├── services/
│   ├── items.service.ts
│   └── reservations.service.ts
├── types/
│   └── domain.ts
└── validation/
    ├── items.schemas.ts
    └── reservations.schemas.ts
supabase/
└── migrations/
    └── 001_inventory_reservations.sql
tests/
├── contract/
│   └── api.contract.test.ts
├── integration/
│   ├── inventory.integration.test.ts
│   └── reservation-lifecycle.integration.test.ts
├── unit/
│   ├── validation.test.ts
│   └── error-handler.test.ts
└── concurrency/
    └── reserve-last-units.ts
.env.example
package.json
tsconfig.json
vercel.json
README.md
```

**Structure Decision**: Use a single-project layout because there is one API and no
frontend. The controller layer is retained because it is explicitly required;
repositories stay thin and call named SQL functions rather than recreating transaction
logic in TypeScript. `app.ts` is runtime-neutral, `server.ts` owns local listening, and
`api/index.ts` adapts the same app to Vercel.

## Phase 0: Research Outcomes

All technical unknowns are resolved in [research.md](./research.md). The implementation
will use PostgreSQL functions plus row locks, a restricted runtime database role through
Supabase transaction pooling, a single Vercel Node.js function, Zod boundary validation,
and one authoritative TypeScript OpenAPI document.

## Phase 1: Design Outcomes

- [data-model.md](./data-model.md) defines fields, constraints, indexes, derived
  inventory, lock ordering, transitions, and SQL-function contracts.
- [contracts/openapi.yaml](./contracts/openapi.yaml) is the planning snapshot for all six
  business operations; contract tests verify it against authoritative runtime OpenAPI.
- [quickstart.md](./quickstart.md) gives the implementation sequence, local and Supabase
  setup, verification commands, concurrency expectations, and Vercel preparation.

## Four-Hour Delivery Sequence

1. **0:00–0:35 — Scaffold and schema**: package/config files, environment validation,
   migration tables, constraints, indexes, and SQL functions.
2. **0:35–1:45 — Core API**: database client/repositories, services, validation,
   controllers, routes, error middleware, local and Vercel entry points.
3. **1:45–2:20 — Contract**: authoritative OpenAPI object, verified YAML snapshot, JSON
   route, Swagger UI, and contract checks.
4. **2:20–3:20 — Verification**: lifecycle integration tests, idempotency cases,
   insufficient inventory, expiration races, and 100-request contention script.
5. **3:20–4:00 — Delivery**: README, `.env.example`, migration rehearsal on clean
   Supabase, Vercel deploy, deployed URL, demo recording/link, and final smoke test.

Cut scope in this order if deployment latency consumes the buffer: extra unit tests,
decorative logging, then optional response examples. Never cut database constraints,
atomic functions, concurrency verification, OpenAPI accuracy, or required README steps.

## Complexity Tracking

No constitution violations require justification.
