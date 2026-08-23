<!--
Sync Impact Report
- Version change: template (unratified) -> 1.0.0
- Modified principles:
  - Placeholder Principle 1 -> I. Database-Enforced Inventory Correctness
  - Placeholder Principle 2 -> II. Atomic and Retry-Safe Reservation Lifecycle
  - Placeholder Principle 3 -> III. Clear Application Boundaries
  - Placeholder Principle 4 -> IV. Validated and Consistent HTTP Contracts
  - Placeholder Principle 5 -> V. Simplicity and Reviewability
- Added sections:
  - Technology and Data Constraints
  - Delivery and Verification Gates
- Removed sections: none
- Template synchronization:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ not applicable: .specify/templates/commands/ (directory absent)
  - ✅ reviewed: README.md (no conflicting guidance; project content not yet present)
- Follow-up TODOs: none
-->
# Inventory Reservation API Constitution

## Core Principles

### I. Database-Enforced Inventory Correctness
The system MUST never make confirmed and active reserved inventory exceed available
inventory, including under concurrent requests. PostgreSQL MUST be the final authority
for inventory consistency. Transactions, row-level locking or equivalent concurrency
control, constraints, foreign keys, and appropriate indexes MUST enforce important
invariants at the database level wherever practical. Application-only checks MUST NOT
be the sole protection for an invariant that the database can enforce.

Rationale: concurrent application instances can observe stale state; database-backed
invariants provide one consistent decision point and prevent overselling.

### II. Atomic and Retry-Safe Reservation Lifecycle
Reservation creation, confirmation, cancellation, and expiration MUST each complete as
a single atomic state transition. Every transition MUST either commit all related
inventory and reservation changes or commit none. Repeated requests, transaction
retries, timeouts, and duplicate delivery MUST NOT double-allocate, double-release, or
otherwise corrupt inventory. Valid state transitions and terminal-state behavior MUST
be explicit and protected by transactional SQL and constraints where practical.

Rationale: lifecycle operations cross multiple records and may be retried after an
ambiguous network outcome; atomicity and idempotent behavior preserve correctness.

### III. Clear Application Boundaries
Express routing, input validation, business logic, and database access MUST remain in
distinct, identifiable modules. Routes MUST translate HTTP requests and responses;
validators MUST define accepted inputs; services MUST coordinate business rules and
transactions; database modules and migrations MUST own persistence details. Business
logic MUST NOT be embedded in route handlers or duplicated across endpoints.

Rationale: explicit boundaries make behavior easier to test, review, and change without
introducing inconsistent implementations of the same rule.

### IV. Validated and Consistent HTTP Contracts
Every external input MUST be validated before use, including path, query, header, and
body data. All endpoints MUST return a consistent error shape, stable machine-readable
error identifiers, and HTTP status codes appropriate to the outcome. Swagger/OpenAPI
documentation MUST describe the implemented routes, schemas, validation constraints,
success responses, and error responses accurately; contract-changing code and its API
documentation MUST be updated together.

Rationale: strict, documented contracts prevent ambiguous client behavior and ensure
that invalid data cannot reach business or persistence logic.

### V. Simplicity and Reviewability
Implementation MUST be limited to assignment requirements and the minimum supporting
infrastructure needed to satisfy them. New abstractions, dependencies, features, or
services MUST have a concrete current requirement and a demonstrable benefit. Clear,
direct TypeScript and SQL MUST be preferred over speculative generalization or clever
indirection. Correctness-critical behavior MUST remain easy to locate and review.

Rationale: a small, explicit solution reduces defect surface and makes concurrency and
data-integrity reasoning tractable.

## Technology and Data Constraints

- The API MUST use Express.js with TypeScript, Supabase PostgreSQL for persistence, and
  a Vercel-compatible deployment design.
- Schema changes MUST be delivered as ordered, reproducible SQL migrations. Migrations
  MUST define required constraints, foreign keys, and indexes explicitly and MUST be
  executable from a clean database.
- Inventory mutations and reservation state transitions MUST use PostgreSQL
  transactions. The chosen isolation, lock order, conditional update, or database
  function strategy MUST be documented and tested under concurrency.
- Database access MUST use parameterized operations. Secrets and environment-specific
  values MUST come from validated environment configuration and MUST NOT be committed.
- Indexes MUST support foreign-key lookups, reservation lifecycle queries, expiration
  processing, and other demonstrated critical access paths without speculative tuning.

## Delivery and Verification Gates

- Each feature specification and plan MUST identify inventory invariants, legal state
  transitions, retry behavior, transaction boundaries, concurrency risks, and failure
  outcomes that apply to the feature.
- Automated tests MUST cover business rules and API contracts. Integration and
  concurrency tests MUST demonstrate no overselling and correct behavior for duplicate,
  conflicting, confirmation, cancellation, and expiration requests.
- A change MUST NOT be considered complete unless its SQL migrations, implementation,
  tests, and Swagger/OpenAPI contract agree.
- The README MUST provide environment configuration, reproducible local setup, migration
  steps, local execution, Vercel deployment, concurrency-test commands and expected
  results, assumptions, limitations, and material design trade-offs.
- Reviews MUST reject unexplained complexity, application-only enforcement of practical
  database invariants, undocumented API behavior, or changes that cannot be reproduced
  from repository instructions.

## Governance

This constitution is the highest-authority engineering guidance for this repository.
Specifications, plans, tasks, implementation, and reviews MUST demonstrate compliance.
Any exception MUST be documented in the relevant plan's Complexity Tracking section
with the violated rule, necessity, risks, and rejected simpler alternatives.

Amendments require a written change to this file, an updated Sync Impact Report, review
of dependent templates and runtime guidance, and explicit approval through the normal
project review process. Amendments take effect when merged. If an amendment changes an
existing data invariant or lifecycle guarantee, it MUST include a safe migration and
compatibility plan.

Constitution versions follow semantic versioning: MAJOR for incompatible principle or
governance changes, MINOR for added principles or materially expanded obligations, and
PATCH for clarifications that do not alter obligations. Every implementation plan MUST
run the Constitution Check before design begins and again after design; every code
review MUST verify the applicable gates before acceptance.

**Version**: 1.0.0 | **Ratified**: 2026-08-19 | **Last Amended**: 2026-08-19
