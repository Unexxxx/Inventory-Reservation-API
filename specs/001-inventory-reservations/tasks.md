---

description: "Dependency-ordered implementation tasks for the Inventory Reservation API"

---

# Tasks: Inventory Reservation API

**Input**: Design documents from `/specs/001-inventory-reservations/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/openapi.yaml`, `quickstart.md`

**Tests**: Tests are required by the specification and constitution. Write the listed
tests before the corresponding implementation and confirm they fail for the expected
reason before making them pass.

**Organization**: Tasks are grouped by user story. Phase 2 supplies only shared
prerequisites; business behavior remains in the earliest story that needs it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes different files and has no incomplete
  dependency.
- **[Story]**: Maps the task to US1, US2, US3, or US4 from `spec.md`.
- Every task names the exact file or files it changes.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the minimal TypeScript, test, and deployment skeleton.

- [x] T001 Create Node.js 24.x package metadata, runtime dependencies, scripts, and engine constraints in `package.json`
- [x] T002 [P] Configure strict TypeScript compilation and source/test path handling in `tsconfig.json`
- [x] T003 [P] Configure Vitest database-test separation, timeouts, and coverage exclusions in `vitest.config.ts`
- [x] T004 [P] Add local secret exclusions and documented environment placeholders in `.gitignore` and `.env.example`
- [x] T005 [P] Configure the single Express Vercel function and route rewrites in `vercel.json` and `api/index.ts`

**Checkpoint**: Dependencies install, TypeScript resolves project files, and test and
deployment commands are defined.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared database, validation, error, and application infrastructure.

**Critical**: No user-story implementation begins until this phase is complete.

- [x] T006 Create the tables, constraints, indexes, `inventory_api` privilege role, direct-DML revocations, and default `PUBLIC` function-execution revocation in `supabase/migrations/001_inventory_reservations.sql`
- [x] T007 [P] Define item, inventory, reservation, database-outcome, and error-envelope TypeScript types in `src/types/domain.ts`
- [x] T008 [P] Validate `DATABASE_URL`, reject Supabase `postgres`/migration-owner runtime usernames, and validate `PORT` and `RESERVATION_TTL_MINUTES` at startup in `src/config/env.ts`
- [x] T009 Implement the module-level Postgres.js client with parameterization, `prepare: false`, and a conservative serverless connection cap in `src/db/client.ts`
- [x] T010 [P] Define stable domain error codes, `AppError`, and database-outcome mapping helpers in `src/errors/app-error.ts`
- [x] T011 [P] Implement reusable Zod parsing middleware for body, path, query, and headers in `src/middleware/validate.ts`
- [x] T012 Implement centralized `{ error: { code, message, details? } }` handling and unknown-route handling in `src/middleware/error-handler.ts` and `src/middleware/not-found.ts`
- [x] T013 Compose JSON parsing, root routing, not-found handling, and error middleware without opening a port in `src/app.ts` and `src/routes/index.ts`
- [x] T014 Add the local-only listener with validated port and graceful database shutdown in `src/server.ts`

**Checkpoint**: The app starts locally, connects through the configured Supabase pooler,
and formats validation, not-found, and unexpected failures consistently.

---

## Phase 3: User Story 1 — Reserve Available Inventory Safely (Priority: P1) — MVP

**Goal**: Create items, retrieve derived inventory, and create retry-safe temporary
reservations without overselling under concurrent requests.

**Independent Test**: Create an item with 10 units, reserve 4, verify totals of
10/6/4/0, reject an excessive request without changes, replay one idempotency key, and
send 100 competing requests whose successful quantity never exceeds the item total.

### Tests for User Story 1

- [x] T015 [P] [US1] Write failing HTTP contract tests for `POST /items`, `GET /items/{itemId}`, and `POST /reservations` status codes and schemas in `tests/contract/api.contract.test.ts`
- [x] T016 [P] [US1] Write failing database integration tests for item totals, successful holds, insufficient inventory, stable omitted-expiration retries after time advances, exact-expiration rejection, concurrent first use of one idempotency key, explicit-versus-default expiration conflicts, conflicting idempotency-key reuse, and transaction rollback without partial state in `tests/integration/inventory.integration.test.ts`
- [x] T017 [P] [US1] Write the 100-request overselling reproduction and invariant assertions in `tests/concurrency/reserve-last-units.ts`

### Implementation for User Story 1

- [x] T018 [US1] Add hardened schema-qualified `SECURITY DEFINER` `create_item_atomic` and advisory-key/item-locking `create_reservation_atomic` functions, `get_item_inventory`, fixed search paths, revoked `PUBLIC EXECUTE`, and explicit runtime-role grants to `supabase/migrations/001_inventory_reservations.sql`
- [x] T019 [P] [US1] Define strict create-item, item-ID, create-reservation, and `Idempotency-Key` schemas in `src/validation/items.schemas.ts` and `src/validation/reservations.schemas.ts`
- [x] T020 [P] [US1] Implement item creation exclusively through `create_item_atomic` and inventory retrieval through `get_item_inventory` in `src/db/repositories/items.repository.ts`
- [x] T021 [P] [US1] Implement atomic reservation-creation function calls and database row mapping in `src/db/repositories/reservations.repository.ts`
- [x] T022 [US1] Implement item creation and inventory retrieval orchestration in `src/services/items.service.ts`
- [x] T023 [US1] Implement canonical fingerprinting with `DEFAULT_TTL` for omitted expiration, compute effective expiration only on first creation, and map replay/conflict outcomes in `src/services/reservations.service.ts`
- [x] T024 [P] [US1] Implement thin item HTTP handlers and response serialization in `src/controllers/items.controller.ts`
- [x] T025 [P] [US1] Implement the reservation-creation HTTP handler with 201 versus replayed 200 behavior in `src/controllers/reservations.controller.ts`
- [x] T026 [US1] Register item and reservation-creation routes with validation middleware in `src/routes/items.routes.ts`, `src/routes/reservations.routes.ts`, and `src/routes/index.ts`
- [ ] T027 [US1] Run the US1 contract, integration, and 100-request contention checks and record any required fixes in `tests/contract/api.contract.test.ts`, `tests/integration/inventory.integration.test.ts`, and `tests/concurrency/reserve-last-units.ts`

**Checkpoint**: User Story 1 is a deployable MVP that proves the database inventory
invariant and reservation-creation idempotency.

---

## Phase 4: User Story 2 — Confirm a Reservation Exactly Once (Priority: P2)

**Goal**: Confirm pending reservations permanently and make confirmation safe across
retries, expiration boundaries, and competing lifecycle requests.

**Independent Test**: Confirm a pending reservation twice and verify one permanent
allocation; attempt to confirm an overdue reservation and verify it expires without
increasing confirmed inventory.

### Tests for User Story 2

- [x] T028 [P] [US2] Add failing contract cases for confirmed, replayed, expired, missing, invalid-ID, and state-conflict responses in `tests/contract/api.contract.test.ts`
- [x] T029 [P] [US2] Write failing integration tests for exactly-once confirmation, confirmation exactly at expiration, simultaneous confirmation calls, lock-timeout or transaction-failure rollback, and safe retry after an ambiguous failure in `tests/integration/reservation-lifecycle.integration.test.ts`

### Implementation for User Story 2

- [x] T030 [US2] Add hardened schema-qualified `SECURITY DEFINER` `confirm_reservation_atomic`, terminal-state outcomes, fixed search path, revoked `PUBLIC EXECUTE`, and explicit runtime-role grant to `supabase/migrations/001_inventory_reservations.sql`
- [x] T031 [US2] Add confirmation repository mapping and service-level expired/state-conflict behavior in `src/db/repositories/reservations.repository.ts` and `src/services/reservations.service.ts`
- [x] T032 [US2] Add the validated confirmation handler and `POST /reservations/{reservationId}/confirm` route in `src/controllers/reservations.controller.ts` and `src/routes/reservations.routes.ts`
- [ ] T033 [US2] Run and fix the US2 contract and lifecycle integration suite in `tests/contract/api.contract.test.ts` and `tests/integration/reservation-lifecycle.integration.test.ts`

**Checkpoint**: Confirmation is atomic, permanent, expiration-aware, and returns the
same confirmed reservation on every retry.

---

## Phase 5: User Story 3 — Cancel or Expire a Temporary Hold (Priority: P3)

**Goal**: Release pending holds exactly once through cancellation or explicit bounded
expiration batches without restoring confirmed inventory.

**Independent Test**: Cancel a pending reservation twice, reject cancellation after
confirmation, drain overdue rows in bounded batches until `hasMore` is false, perform 100
retries per lifecycle action, and race confirmation, cancellation, and expiration until
every run produces one legal terminal state.

### Tests for User Story 3

- [x] T034 [P] [US3] Add failing contract cases for cancellation, cancellation replay/conflict, expiration `expiredCount`/`hasMore`, batch limits, and validation errors in `tests/contract/api.contract.test.ts`
- [x] T035 [P] [US3] Add failing integration tests for exactly-once cancellation, no restoration after confirmation, multi-batch expiration draining, and terminal-state races in `tests/integration/reservation-lifecycle.integration.test.ts`

### Implementation for User Story 3

- [x] T036 [US3] Add hardened schema-qualified `SECURITY DEFINER` cancellation and expiration functions with fixed search paths, revoked `PUBLIC EXECUTE`, explicit runtime-role grants, guarded updates, `FOR UPDATE SKIP LOCKED`, `expired_count`, and `has_more` in `supabase/migrations/001_inventory_reservations.sql`
- [x] T037 [US3] Add cancellation and expiration repository calls and service outcome mapping in `src/db/repositories/reservations.repository.ts` and `src/services/reservations.service.ts`
- [x] T038 [P] [US3] Add strict expiration-batch request validation with default 500 and range 1–1000 in `src/validation/reservations.schemas.ts`
- [x] T039 [US3] Add cancellation and expiration handlers plus `POST /reservations/{reservationId}/cancel` and `POST /reservations/expire` routes in `src/controllers/reservations.controller.ts` and `src/routes/reservations.routes.ts`
- [ ] T040 [US3] Run and fix the US3 contract and lifecycle race suite in `tests/contract/api.contract.test.ts` and `tests/integration/reservation-lifecycle.integration.test.ts`
- [ ] T041 [US3] Create and run 100-retry confirmation, cancellation, and expiration scenarios that assert exactly one inventory effect in `tests/concurrency/retry-lifecycle.ts` and add the `test:retries` script to `package.json`

**Checkpoint**: Pending inventory is released exactly once, overdue holds never block
availability, and incompatible terminal transitions cannot alter inventory.

---

## Phase 6: User Story 4 — Integrate Through a Reliable API Contract (Priority: P4)

**Goal**: Serve accurate interactive and machine-readable documentation and make setup,
testing, deployment, assumptions, and limitations reproducible.

**Independent Test**: Validate all implemented requests and responses against the
contract, load `/docs` and `/openapi.json`, then follow README instructions from a clean
database through concurrency verification and deployment smoke testing.

### Tests for User Story 4

- [x] T042 [P] [US4] Add failing tests that validate the authoritative OpenAPI document, every operation/status mapping, representative response bodies, and the YAML planning snapshot in `tests/contract/api.contract.test.ts`
- [x] T043 [P] [US4] Add failing unit tests for all Zod boundaries and sanitized standard errors in `tests/unit/validation.test.ts` and `tests/unit/error-handler.test.ts`

### Implementation for User Story 4

- [x] T044 [US4] Implement the authoritative runtime OpenAPI document and expiration `hasMore` response in `src/docs/openapi.ts`
- [x] T045 [US4] Mount Swagger UI at `/docs` and the same authoritative document at `/openapi.json` in `src/app.ts` and `src/routes/index.ts`
- [ ] T046 [US4] Complete architecture, endpoints, Supabase role/SQL Editor setup, environment, local commands, Vercel deployment, concurrency and retry reproduction, expected results, assumptions, limitations, and trade-offs in `README.md`
- [x] T047 [US4] Deterministically generate `specs/001-inventory-reservations/contracts/openapi.yaml` from `src/docs/openapi.ts`, fail tests when the committed snapshot is stale, and reconcile validation or response mismatches in `src/validation/items.schemas.ts` and `src/validation/reservations.schemas.ts`

**Checkpoint**: API behavior, validation, errors, OpenAPI, and operating instructions
agree and are reproducible by a new operator.

---

## Phase 7: Polish & Cross-Cutting Delivery

**Purpose**: Prove the clean-install path and finish the submission without adding scope.

- [x] T048 [P] Add database-test cleanup helpers that preserve test isolation in `tests/integration/helpers/database.ts`
- [ ] T049 Apply `supabase/migrations/001_inventory_reservations.sql` to a clean Supabase database and record verified migration steps in `README.md`
- [ ] T050 Run typecheck plus all unit, contract, integration, and concurrency commands and record representative concurrency output in `README.md`
- [x] T051 Verify direct table DML and `PUBLIC EXECUTE` are revoked, approved function execution is granted, functions use hardened definer settings, queries are parameterized, secrets and errors are sanitized, and dependencies are necessary in `supabase/migrations/001_inventory_reservations.sql`, `src/db/client.ts`, `.env.example`, and `package.json`
- [ ] T052 Add and run integration tests proving owner credentials are rejected, the runtime role rejects direct item/reservation DML, `PUBLIC` cannot execute mutation functions, and approved lifecycle functions succeed in `tests/integration/database-privileges.integration.test.ts`
- [ ] T053 Deploy `api/index.ts` with `vercel.json`, execute the documented production smoke scenario, and replace the deployed URL placeholder in `README.md`
- [ ] T054 Time a clean execution of `specs/001-inventory-reservations/quickstart.md`, record whether it completes within 30 minutes, record the required demo, and add the demo link to `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: starts immediately; T002–T005 can proceed in parallel after the
  package shape in T001 is understood.
- **Phase 2 — Foundational**: depends on Phase 1 and blocks all user stories.
- **Phase 3 — US1**: depends on Phase 2 and establishes the tables, repositories, and
  create/read paths reused by later stories.
- **Phase 4 — US2**: depends on US1 because confirmation requires an existing
  reservation and extends its repository, service, controller, route, and migration.
- **Phase 5 — US3**: depends on US1; implementation is safest after US2 because all
  lifecycle functions share the migration and reservation modules.
- **Phase 6 — US4**: depends on US1–US3 so the final contract documents real behavior.
  README task T046 may begin once Phase 2 fixes setup details.
- **Phase 7 — Polish**: depends on all selected user stories.

### User Story Dependency Graph

```text
Setup → Foundation → US1 (MVP) → US2 → US3 → US4 → Polish
                         └───────────────┘
                         US2 and US3 are behaviorally independent after US1,
                         but both edit shared lifecycle files.
```

### Within Each User Story

1. Write contract/integration tests and verify expected failures.
2. Add the database function or constraint that owns the invariant.
3. Add repository and service behavior.
4. Add validation, controller, and route behavior.
5. Run the story checkpoint before starting the next story.

## Parallel Opportunities

### User Story 1

```text
T015 contract tests || T016 integration tests || T017 concurrency script
T019 validation     || T020 item repository   || T021 reservation repository
T024 item controller || T025 reservation controller
```

### User Story 2

```text
T028 confirmation contract tests || T029 confirmation integration tests
```

### User Story 3

```text
T034 cancellation/expiration contract tests || T035 lifecycle race tests
T038 expiration validation can proceed while T036 implements database functions
```

### User Story 4

```text
T042 OpenAPI contract tests || T043 validation/error unit tests
```

Parallel markers assume separate workers coordinate before editing any shared file.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundation.
2. Complete US1 through T027.
3. Stop and demonstrate item creation, status, safe reservation, idempotent creation,
   insufficient-inventory rejection, and 100-request no-oversell behavior.

### Incremental Delivery

1. Add US2 and prove exactly-once confirmation.
2. Add US3 and prove exactly-once release plus expiration races.
3. Add US4 and prove contract/documentation reproducibility.
4. Complete deployment and demo tasks only after all correctness gates pass.

### Four-Hour Guardrail

- Follow the plan timeboxes and keep all optional improvements out of the critical path.
- Do not introduce an ORM, queue, cache, authentication, frontend, worker, or generalized
  repository abstraction.
- If time compresses, reduce non-critical unit-test breadth before reducing database,
  concurrency, OpenAPI, migration, or README verification.

## Notes

- `[P]` means different files or non-overlapping work after prerequisites are satisfied.
- Story tasks always carry `[USn]`; setup, foundation, and polish tasks do not.
- Each task is small enough for a focused commit or a tightly related commit group.
- The migration is intentionally extended story by story during implementation but must
  finish as one ordered SQL file that runs directly in Supabase SQL Editor.
