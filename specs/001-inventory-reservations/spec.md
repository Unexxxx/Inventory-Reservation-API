# Feature Specification: Inventory Reservation API

**Feature Branch**: `001-inventory-reservations`  
**Created**: 2026-08-19  
**Status**: Draft  
**Input**: User description: "Create an Inventory Reservation API that safely manages
item stock and temporary customer reservations, including confirmation, cancellation,
expiration, documentation, deployment, and concurrency verification."

## Clarifications

### Session 2026-08-19

- Q: How must reservation creation handle client retries after an ambiguous response? → A: Require an `Idempotency-Key`; identical retries return the original reservation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reserve Available Inventory Safely (Priority: P1)

An API consumer creates an item with an initial quantity, inspects its inventory, and
places a temporary reservation for a customer without risking overselling when other
customers reserve the same item concurrently.

**Why this priority**: Safely holding available inventory is the core business value;
all later lifecycle actions depend on a valid reservation.

**Independent Test**: Create an item, request one or more reservations, and verify the
reported total, available, held, and confirmed quantities. Send competing reservation
requests whose combined quantity exceeds availability and verify only a valid subset
succeeds and the inventory invariant remains true.

**Acceptance Scenarios**:

1. **Given** valid item data with an initial quantity of 10, **When** the item is
   created, **Then** its inventory shows total 10, available 10, held 0, and confirmed 0.
2. **Given** an item with 10 available units, **When** a customer reserves 4 units until
   a future expiration time, **Then** a pending reservation is returned and inventory
   shows total 10, available 6, held 4, and confirmed 0.
3. **Given** an item with 3 available units, **When** a customer requests 4 units,
   **Then** the request is rejected for insufficient inventory and all quantities remain
   unchanged.
4. **Given** an item with 5 available units, **When** concurrent customers each request
   4 units, **Then** no more than one request succeeds and held plus confirmed inventory
   never exceeds total inventory.

---

### User Story 2 - Confirm a Reservation Exactly Once (Priority: P2)

An API consumer confirms a pending, unexpired reservation so its quantity becomes a
permanent allocation. The consumer can safely retry after a timeout without a second
deduction.

**Why this priority**: Confirmation converts a temporary hold into the system's durable
inventory outcome and must be trustworthy despite retries.

**Independent Test**: Confirm a pending reservation, repeat the identical request, and
verify both calls report the same confirmed reservation while inventory is deducted
exactly once.

**Acceptance Scenarios**:

1. **Given** a pending, unexpired reservation for 4 of 10 units, **When** it is
   confirmed, **Then** its status becomes confirmed and inventory shows total 10,
   available 6, held 0, and confirmed 4.
2. **Given** an already confirmed reservation, **When** confirmation is retried,
   **Then** the same confirmed outcome is returned and no quantity changes again.
3. **Given** a pending reservation whose expiration time has passed, **When**
   confirmation is requested, **Then** confirmation is rejected, the reservation is
   treated as expired, and its held quantity is available again.

---

### User Story 3 - Cancel or Expire a Temporary Hold (Priority: P3)

An API consumer cancels a pending reservation, or invokes expiration processing for
overdue reservations, so held inventory becomes available to other customers.

**Why this priority**: Releasing abandoned holds prevents otherwise sellable inventory
from remaining unavailable.

**Independent Test**: Cancel one pending reservation and expire another overdue
reservation, retry both actions, and verify held inventory is released exactly once.

**Acceptance Scenarios**:

1. **Given** a pending reservation for 3 units, **When** it is cancelled, **Then** its
   status becomes cancelled and all 3 units return to availability.
2. **Given** an already cancelled reservation, **When** cancellation is retried,
   **Then** the same cancelled outcome is returned without changing inventory again.
3. **Given** a confirmed reservation, **When** cancellation is requested, **Then** the
   request is rejected and confirmed inventory is not restored.
4. **Given** overdue and unexpired pending reservations, **When** expiration processing
   runs with a batch limit, **Then** at most that many overdue reservations become
   expired, unexpired reservations remain unchanged, and the response reports whether
   more overdue reservations remain.
5. **Given** an already expired reservation, **When** expiration processing runs again,
   **Then** no additional inventory is released.
6. **Given** more overdue reservations than one batch can process, **When** expiration
   processing is repeated until `hasMore` is false, **Then** every overdue reservation
   is eventually expired exactly once.

---

### User Story 4 - Integrate Through a Reliable API Contract (Priority: P4)

An API consumer validates requests and responses using browsable documentation and a
machine-readable contract, while operators can reproduce setup, deployment, and
concurrency behavior from repository instructions.

**Why this priority**: The inventory lifecycle is only usable and reviewable when its
contract, errors, and operating instructions match the delivered behavior.

**Independent Test**: Exercise valid and invalid operations against the documented
contract, compare actual responses with documented schemas and status codes, and follow
the repository instructions from a clean environment through concurrency verification.

**Acceptance Scenarios**:

1. **Given** the running service, **When** a consumer visits `/docs`, **Then** interactive
   API documentation is available and describes every implemented operation.
2. **Given** the running service, **When** a consumer requests `/openapi.json`, **Then** a
   valid machine-readable contract is returned that matches implemented validation,
   success responses, and errors.
3. **Given** any invalid API input, **When** the request is submitted, **Then** it is
   rejected with the documented status code and standard error format.
4. **Given** a clean development environment and database, **When** an operator follows
   the README, **Then** the schema, local service, deployment, and concurrency
   demonstration can be reproduced without undocumented steps.

### Edge Cases

- Zero, negative, fractional, non-numeric, or out-of-range item and reservation
  quantities are rejected without changing state.
- Missing, malformed, blank, or oversized customer identifiers and malformed item or
  reservation identifiers are rejected.
- An expiration time at or before the current time is rejected when creating a
  reservation; the server's current time determines whether an existing hold expired.
- A reservation is expired when server time is exactly equal to its expiration time.
  Confirmation at that boundary is rejected, and retries after time advances preserve
  the original expiration and request identity rather than recalculating either value.
- A request for a missing item or reservation returns a not-found outcome.
- Concurrent reservation requests cannot collectively hold more than the item's
  available quantity.
- Confirmation racing with expiration has exactly one durable result: confirmation may
  win only before expiration; otherwise expiration wins and no inventory is confirmed.
- Cancellation racing with confirmation or expiration results in one legal terminal
  state and adjusts held inventory no more than once.
- Retrying confirmation, cancellation, or expiration after an ambiguous response does
  not repeat its inventory effect.
- Retrying reservation creation with the same idempotency key and identical input
  returns the original reservation without creating another hold; reusing the key with
  different input is rejected as a conflict.
- A blank or oversized idempotency key is rejected before database work. Concurrent
  first uses of the same valid key are serialized: identical requests resolve to one
  reservation, while a difference in item, customer, quantity, or explicit-versus-
  default expiration input returns a conflict without another hold.
- Database lock contention is serialized within the configured transaction timeout.
  A lock timeout, transaction failure, or database outage produces no partially
  committed reservation or inventory effect. Exhausting caller retries does not cause
  compensation or any additional inventory mutation.
- Expiration processing with no overdue reservations succeeds without changing data.
- Item status remains internally consistent after every success, rejection, conflict,
  retry, and concurrent operation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an API consumer to create an item with a
  server-generated identifier and a strictly positive whole-number initial quantity.
- **FR-002**: The system MUST return an item's total quantity, available quantity,
  quantity held by pending unexpired reservations, and confirmed quantity.
- **FR-003**: For every item and after every operation, quantities MUST satisfy:
  `available = total - held - confirmed`, with every component non-negative and
  `held + confirmed <= total`.
- **FR-004**: The system MUST create a temporary reservation from an existing item, a
  non-blank customer identifier, a strictly positive whole-number quantity, and an
  expiration time later than the server's current time.
- **FR-005**: A reservation MUST expose its identifier, item identifier, customer
  identifier, quantity, status, creation time, and expiration time.
- **FR-006**: Reservation status MUST be exactly one of `pending`, `confirmed`,
  `cancelled`, or `expired`; allowed transitions are pending-to-confirmed,
  pending-to-cancelled, and pending-to-expired.
- **FR-007**: Reservation creation MUST succeed only when the entire requested quantity
  is available; partial reservations are not permitted.
- **FR-008**: Reservation creation MUST atomically establish the pending reservation and
  its hold, including when requests for the same item execute concurrently.
- **FR-009**: The system MUST prevent held plus confirmed quantity from exceeding total
  quantity under every concurrent request ordering.
- **FR-010**: Confirmation of a pending, unexpired reservation MUST atomically move its
  quantity from held to confirmed without changing available quantity.
- **FR-011**: Reconfirming a confirmed reservation MUST return the existing confirmed
  outcome without applying a second inventory effect.
- **FR-012**: Confirmation MUST NOT succeed when the reservation is expired, cancelled,
  or already past its expiration time. A pending reservation found past expiration
  during confirmation MUST become expired atomically and release its hold.
- **FR-013**: Cancellation of a pending reservation MUST atomically mark it cancelled
  and release its entire held quantity to availability.
- **FR-014**: Recancelling a cancelled reservation MUST return the existing cancelled
  outcome without applying a second inventory effect.
- **FR-015**: Cancellation MUST NOT restore inventory for a confirmed reservation and
  MUST return a conflict outcome for confirmation-incompatible terminal states.
- **FR-016**: The system MUST provide an explicitly invoked expiration operation that
  atomically marks up to the requested batch limit of overdue pending reservations as
  expired, releases each hold exactly once, and returns `expiredCount` plus `hasMore`.
  Callers MAY repeat the operation until `hasMore` is false. No background worker is
  required.
- **FR-017**: Expiration processing MUST be safe to retry and MUST NOT change confirmed,
  cancelled, already expired, or not-yet-expired reservations.
- **FR-018**: Competing lifecycle operations on one reservation MUST commit at most one
  legal transition and MUST leave inventory consistent.
- **FR-019**: The system MUST validate every supported path parameter, query parameter,
  request header, and request body before applying business behavior.
- **FR-020**: Invalid or malformed input MUST return HTTP 400; a missing item or
  reservation MUST return HTTP 404; insufficient inventory or an incompatible state
  transition MUST return HTTP 409; creation MUST return HTTP 201; successful retrieval,
  transition, idempotent retry, and expiration processing MUST return HTTP 200; and an
  unexpected server failure MUST return HTTP 500.
- **FR-021**: Every error MUST use one response shape containing an `error` object with
  a stable machine-readable `code`, a human-readable `message`, and optional structured
  `details`; validation details MUST identify invalid fields without exposing secrets.
- **FR-022**: The service MUST expose interactive Swagger UI at `/docs` and its OpenAPI
  JSON at `/openapi.json`.
- **FR-023**: The OpenAPI contract MUST document every implemented operation, input,
  validation constraint, response body, error code, and HTTP status accurately.
- **FR-024**: The deliverable MUST include ordered, reproducible SQL migrations for all
  required tables, data constraints, relationships, and indexes, and applying those
  migrations to a clean Supabase PostgreSQL database MUST produce the complete schema.
- **FR-025**: Database-level safeguards MUST enforce identifier relationships, valid
  quantities, legal statuses, required fields, and important inventory consistency
  rules wherever the database can practically enforce them.
- **FR-026**: The deliverable MUST use the required Express.js and TypeScript runtime,
  Supabase PostgreSQL persistence, and a Vercel-compatible deployment configuration.
- **FR-027**: The README MUST document Supabase setup, reproducible local development,
  required environment variables without secret values, migration application, Vercel
  deployment, and commands plus expected results for reproducing concurrent contention.
- **FR-028**: The README MUST state assumptions, limitations, and material trade-offs and
  provide clearly labeled locations for the deployed service URL and demo video link.
- **FR-029**: The delivered scope MUST exclude a frontend, payment processing, user
  registration, background workers, and an admin portal.
- **FR-030**: Automated verification MUST cover API contracts, inventory calculations,
  all legal and illegal lifecycle transitions, retry behavior, expiration boundaries,
  and concurrent attempts that would oversell without coordination.
- **FR-031**: Reservation creation MUST require a non-blank `Idempotency-Key` request
  header. The key MUST identify at most one creation request: an identical retry MUST
  return the original reservation and HTTP 200 without applying another hold, while
  reuse with different item, customer, quantity, or expiration input MUST return HTTP
  409 without changing inventory.
- **FR-032**: A database lock timeout, transaction failure, or database unavailability
  MUST NOT leave a partial reservation, lifecycle transition, idempotency mapping, or
  inventory effect and MUST return the standard `INTERNAL_ERROR` HTTP 500 response.
  Creation retries MUST reuse the original idempotency key, and lifecycle retries MUST
  reuse the reservation identifier. Exhausting caller retries MUST NOT trigger
  compensation or any additional inventory mutation.

### Key Entities

- **Item**: A reservable inventory record with a unique identifier and total quantity.
  Its status derives available, held, and confirmed quantities from durable reservation
  outcomes.
- **Reservation**: A temporary or completed allocation associated with exactly one item
  and one customer identifier. It records a positive quantity, one lifecycle status,
  creation time, expiration time, and unique creation idempotency key.
- **Customer Reference**: A caller-supplied, non-blank identifier stored on a
  reservation for business correlation. It is not a registered user account.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across 100 simultaneous attempts to reserve the last available units of
  one item, 0 runs result in held plus confirmed quantity exceeding total quantity.
- **SC-002**: Across 100 retries each of confirmation, cancellation, and expiration,
  every reservation quantity affects inventory exactly once.
- **SC-003**: In 100% of tested races among confirmation, cancellation, and expiration,
  each reservation ends in one legal status and its item's four reported quantities
  satisfy the inventory invariant.
- **SC-004**: Every supported operation has at least one documented success example and
  every applicable 400, 404, 409, and 500 error outcome is represented in the published
  API contract.
- **SC-005**: A new operator can follow the README from a clean environment to create the
  schema, run the service, inspect the API documentation, and reproduce the concurrency
  test in 30 minutes or less, excluding account provisioning and deployment wait time.
- **SC-006**: All invalid-input test cases are rejected before any observable state
  change: item quantities, reservation rows or statuses, and idempotency mappings remain
  byte-for-byte logically unchanged.

## Assumptions

- API authentication and authorization are outside the assignment scope; deployment
  access controls, if desired, are an operator concern.
- Item identifiers and reservation identifiers are generated by the service. Items do
  not require catalog attributes such as price, SKU, or description for this scope.
- Customer identifiers are opaque business references rather than managed user records.
- Callers supply an optional reservation expiration time; when omitted, the service uses
  a documented 15-minute hold duration. A supplied expiration must be in the future.
- Server time is authoritative for creation, confirmation, and expiration decisions;
  all timestamps are represented in UTC.
- Inventory totals are set at item creation and are not adjusted through this API.
- Expiration is triggered through an API operation or during access to an overdue
  reservation; scheduled execution is outside scope because background workers are
  explicitly excluded.
- The deployed URL and demo video may be added to the documented placeholders after
  those external artifacts exist, but the final submission is incomplete without them.

## Limitations and Trade-offs

- The service manages inventory for a single item per reservation; multi-item carts and
  all-or-nothing reservations across several items are outside scope.
- The service does not manage authentication, authorization, users, products, pricing,
  payments, replenishment, returns, or order fulfillment.
- Without a background worker, overdue holds may remain marked pending until expiration
  is explicitly invoked or the reservation is encountered. They MUST nevertheless be
  excluded from effective held inventory once expired and MUST never be confirmable.
- Database-enforced concurrency consistency is prioritized over maximizing throughput
  for many simultaneous operations on the same item.
- The default 15-minute hold balances customer completion time against inventory
  availability and is configurable only through documented environment configuration.
