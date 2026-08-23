# Phase 0 Research: Inventory Reservation API

## PostgreSQL as the Atomicity Boundary

**Decision**: Implement reservation creation, confirmation, cancellation, and expiration
as named PostgreSQL functions installed by the migration. Use `SELECT ... FOR UPDATE` on
the item during creation, guarded status updates for lifecycle transitions, and derived
inventory totals rather than mutable aggregate counters.

**Rationale**: A database function executes within one transaction and cannot be split
across Vercel invocations. PostgreSQL row locks block competing lockers/writers until the
transaction ends, allowing all creation requests for one item to observe a serialized
availability decision. Derived totals eliminate double-decrement and double-release
counter bugs. Source: [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html).

**Alternatives considered**:

- Application-managed multi-query transactions: valid with a dedicated connection, but
  spreads correctness logic across TypeScript and is easier to misuse in serverless code.
- Optimistic item counters: fewer aggregate queries, but requires more mutable state and
  careful compensation for every transition.
- Serializable isolation for every request: correct with retries, but broader and less
  explicit than serializing only same-item creation.

## Supabase Connectivity from Vercel

**Decision**: Use Postgres.js with `DATABASE_URL` set to a least-privileged custom LOGIN
role through the Supabase Supavisor transaction-mode connection string and
`prepare: false`. The LOGIN role inherits only the migration-defined `inventory_api`
privileges. Keep one module-level client so warm invocations can reuse it and cap the
client pool conservatively.

**Rationale**: Supabase identifies transaction mode as the connection mode for
serverless and edge functions and notes that it does not support prepared statements.
Postgres.js is documented as a supported client. Restricting the connection role makes
the approved SQL functions the enforceable write boundary rather than an application
convention. Sources:
[Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase Postgres.js guide](https://supabase.com/docs/guides/database/postgres-js).

Mutation functions use hardened `SECURITY DEFINER` declarations with an empty fixed
`search_path`, schema-qualified objects, migration-owner ownership, revoked `PUBLIC`
execution, and explicit `inventory_api` execution grants. This permits controlled writes
without granting the runtime login direct table DML.

**Alternatives considered**:

- Supabase Data API/RPC client: convenient, but direct SQL gives clearer typed access to
  function results and one database configuration for local and deployed execution.
- Direct database endpoint: suitable for migrations and persistent clients, but the
  transaction pooler is designed for transient serverless connections.
- ORM: unnecessary for two tables and hides the correctness-critical SQL.

## Vercel Runtime Shape

**Decision**: Target Node.js 24.x, export the Express application from `api/index.ts`,
and use `src/server.ts` only for local listening.

**Rationale**: Vercel supports TypeScript Node.js functions under `api/`, explicitly
supports Express, and currently offers Node.js 24.x as its default runtime. Separating
the listener prevents port binding in the serverless handler. Sources:
[Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js),
[supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

**Alternatives considered**:

- Multiple functions per route: duplicates composition and database setup for a small
  assignment API.
- Edge runtime: incompatible with the selected Node/PostgreSQL client assumptions and
  unnecessary for the required scope.
- Container hosting: outside the required Vercel deployment target.

## Input Validation and HTTP Errors

**Decision**: Use Zod schemas at the HTTP boundary and a small `AppError` hierarchy.
Map database result/error codes to one `{ error: { code, message, details? } }` envelope.

**Rationale**: One validation library covers bodies, parameters, and headers with
readable TypeScript inference. Central middleware prevents controller-specific response
formats. Database functions return stable domain outcome codes for expected conflicts;
unexpected database details remain internal.

**Alternatives considered**:

- Hand-written validation: fewer dependencies but more repetitive and error-prone.
- Decorator/controller frameworks: add abstractions beyond the timebox.
- Returning raw PostgreSQL errors: leaks internals and creates unstable contracts.

## Idempotent Creation and Lifecycle Retries

**Decision**: Store a unique `idempotency_key` and deterministic request fingerprint on
each reservation. The create function takes a transaction-scoped advisory lock derived
from the key before checking for an existing request, then locks the item. Identical
retries return the existing row; mismatched payloads return an idempotency conflict.
Confirmation and cancellation lock the reservation and return the existing record for
same-terminal-state retries.

**Rationale**: The advisory lock serializes concurrent first use of one key without a
third table. A uniqueness constraint remains the durable safety net. State-based retry
handling prevents duplicate effects and fits the two-table scope.

**Alternatives considered**:

- Separate idempotency table: explicit and extensible, but adds a table and cleanup
  policy not needed when every key belongs permanently to one reservation.
- Optional idempotency: contradicts the approved clarification.
- Client-only retry control: cannot protect against ambiguous network outcomes.

## Expiration and Inventory Computation

**Decision**: Define held quantity as pending reservations with `expires_at > now()`.
Status reads therefore never let overdue rows block availability. The create function
marks overdue rows for its item expired before calculating availability; confirmation
atomically expires an overdue target; a global expiration function updates overdue rows
in bounded batches until none remain.

**Rationale**: Time-aware reads satisfy availability immediately even without a worker,
while persisted cleanup keeps state understandable. Guarded updates make expiration safe
to repeat and race with confirmation/cancellation.

**Alternatives considered**:

- Scheduled worker: explicitly out of scope.
- Treat all pending rows as held until cleanup: violates the requirement that expired
  reservations no longer block inventory.
- Delete expired rows: loses lifecycle history and complicates retry behavior.

## OpenAPI Source and Testing Strategy

**Decision**: Keep the authoritative runtime OpenAPI document as a typed object in
`src/docs/openapi.ts`, serve that same object as JSON and through Swagger UI, and verify
the planning contract snapshot in `contracts/openapi.yaml` against it in contract tests.
Use real PostgreSQL integration tests for concurrency and state transitions; reserve
mocks for controller/error unit tests.

**Rationale**: One editable runtime contract minimizes documentation drift and bundles
reliably on Vercel; the YAML artifact remains a generated or verified planning snapshot.
Overselling, locking, and transactions cannot be proven with mocks. Standalone
concurrency scripts provide reproducible assignment evidence outside the test runner.

**Alternatives considered**:

- Annotation-generated OpenAPI: couples documentation to decorators and adds tooling.
- Unit-only tests: cannot verify database concurrency guarantees.
- Full load-testing platform: unnecessary for the defined 100-request scenario.
