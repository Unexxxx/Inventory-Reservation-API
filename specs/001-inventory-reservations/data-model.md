# Data Model: Inventory Reservation API

## Inventory Invariant

For each item at database time `t`:

```text
confirmed = sum(quantity where status = 'confirmed')
held      = sum(quantity where status = 'pending' and expires_at > t)
available = total_quantity - confirmed - held

0 <= confirmed + held <= total_quantity
```

Expired pending rows are excluded from held quantity immediately, even before their
persisted status is cleaned up. All values are whole numbers represented as PostgreSQL
`bigint` and serialized as JSON numbers only after a safe-range check.

## Entity: `items`

| Field | PostgreSQL type | Null | Rules |
|---|---|---|---|
| `id` | `uuid` | No | Primary key; default `gen_random_uuid()` |
| `total_quantity` | `bigint` | No | `CHECK (total_quantity > 0)`; immutable through this API |
| `created_at` | `timestamptz` | No | Default `now()` |

An item has zero or more reservations. Deleting items is outside scope; the foreign key
uses `ON DELETE RESTRICT` as a defensive rule.

## Entity: `reservations`

| Field | PostgreSQL type | Null | Rules |
|---|---|---|---|
| `id` | `uuid` | No | Primary key; default `gen_random_uuid()` |
| `item_id` | `uuid` | No | Foreign key to `items(id)`, `ON DELETE RESTRICT` |
| `customer_id` | `varchar(255)` | No | Trimmed; length 1–255 |
| `quantity` | `bigint` | No | `CHECK (quantity > 0)` |
| `status` | `text` | No | Default `pending`; check allows `pending`, `confirmed`, `cancelled`, `expired` |
| `idempotency_key` | `varchar(255)` | No | Globally unique; trimmed length 1–255 |
| `request_fingerprint` | `text` | No | SHA-256 hex of canonical raw caller input; omitted expiration uses `DEFAULT_TTL` |
| `created_at` | `timestamptz` | No | Default `now()` |
| `expires_at` | `timestamptz` | No | `CHECK (expires_at > created_at)` |
| `updated_at` | `timestamptz` | No | Default `now()`; set by lifecycle functions |

The migration MUST define a least-privileged `inventory_api` NOLOGIN privilege role,
revoke direct `INSERT`, `UPDATE`, and `DELETE` on both tables from `PUBLIC` and that
role, and grant it only required `SELECT` and approved function `EXECUTE` privileges.
Setup provisions a separate LOGIN role, grants it membership in `inventory_api`, and
uses that login in the deployed `DATABASE_URL`. The API MUST NOT connect as the migration
owner or Supabase `postgres` role, and no password may appear in a migration.

Every mutation function MUST be `SECURITY DEFINER`, owned by the migration owner, set a
fixed empty `search_path`, and reference schema-qualified objects. The migration MUST
revoke default function execution from `PUBLIC` before granting `EXECUTE` only to
`inventory_api`. Read-only functions MAY remain `SECURITY INVOKER` when their required
table `SELECT` privileges are explicitly granted.

## Relationships

- `reservations.item_id` → `items.id`: many reservations belong to exactly one item.
- Customer IDs are opaque values, not foreign keys, because user registration is out of
  scope.
- An idempotency key belongs permanently to exactly one reservation and is not recycled.

## Indexes

1. `items_pkey` on `items(id)` for item lookup and row locking.
2. `reservations_pkey` on `reservations(id)` for lifecycle lookup and row locking.
3. Unique `reservations_idempotency_key_key` on `reservations(idempotency_key)` for
   durable creation retry safety.
4. `reservations_item_active_idx` on `(item_id, expires_at)` with predicate
   `status = 'pending'` for held-quantity and item cleanup queries.
5. `reservations_item_confirmed_idx` on `(item_id)` with predicate
   `status = 'confirmed'` for confirmed-quantity aggregation.
6. `reservations_expiration_idx` on `(expires_at, id)` with predicate
   `status = 'pending'` for bounded global expiration.

No speculative customer or creation-time indexes are added because the API does not list
reservations by those fields.

## State Machine

```text
pending ──confirm before expiry──> confirmed
   │
   ├────cancel───────────────────> cancelled
   │
   └────expire at/after deadline─> expired
```

- `confirmed`, `cancelled`, and `expired` are terminal.
- Repeating confirmation on `confirmed` returns the row with no write.
- Repeating cancellation on `cancelled` returns the row with no write.
- Repeating expiration ignores terminal rows.
- Confirmation of a pending row at or after `expires_at` changes it to `expired` and
  returns an expired conflict outcome.
- Confirmation/cancellation against incompatible terminal states returns a conflict and
  never changes quantity accounting.

## Database Function Contracts

### `get_item_inventory(p_item_id uuid)`

Returns the item and its `total_quantity`, `available_quantity`, `held_quantity`, and
`confirmed_quantity`, computed in one statement at database time. Returns no row when
the item does not exist.

### `create_item_atomic(p_total_quantity bigint)`

Validates and inserts one item, then returns the same inventory shape as
`get_item_inventory`. This is the only runtime item-creation write path.

### `create_reservation_atomic(...)`

Inputs: item ID, customer ID, quantity, expiration, idempotency key, fingerprint.

The service computes the fingerprint from normalized raw caller input. If `expiresAt`
is omitted, the canonical fingerprint value is the literal `DEFAULT_TTL`, not a computed
timestamp. The effective expiration is calculated once only for first creation and is
stored on the reservation. A later identical retry therefore keeps the same fingerprint
and returns the original stored expiration.

Lock order:

1. Acquire `pg_advisory_xact_lock(hashtextextended(idempotency_key, 0))`.
2. If the key exists, compare fingerprint and return `replayed` or
   `idempotency_conflict` without applying inventory.
3. Lock the item row `FOR UPDATE`; return `item_not_found` if absent.
4. Mark overdue pending reservations for that item expired.
5. Aggregate active held plus confirmed quantity while the item lock excludes competing
   creators.
6. Return `insufficient_inventory` or insert and return one pending reservation.

All creators for one item take the same item row lock, so none can make a decision from
the same pre-reservation availability. Different items proceed independently.

### `confirm_reservation_atomic(p_reservation_id uuid)`

Locks the reservation `FOR UPDATE`. Returns `not_found`, `confirmed` (new or replayed),
`expired`, or `state_conflict`. A pending row is confirmed only when database time is
strictly before `expires_at`; otherwise it is atomically marked expired.

### `cancel_reservation_atomic(p_reservation_id uuid)`

Locks the reservation `FOR UPDATE`. Returns `not_found`, `cancelled` (new or replayed),
or `state_conflict`. Only pending rows transition; confirmed inventory is never restored.

### `expire_reservations_atomic(p_limit integer default 500)`

Selects up to `p_limit` overdue pending rows ordered by `(expires_at, id)` using
`FOR UPDATE SKIP LOCKED`, marks them expired, and returns `expired_count` plus a
`has_more` check for remaining overdue rows. One API invocation processes one batch;
callers explicitly repeat it until `hasMore` is false. Every retry safely continues
remaining work.

## Error/Outcome Mapping

| Database outcome | Domain error code | HTTP status |
|---|---|---|
| Missing item/reservation | `NOT_FOUND` | 404 |
| Insufficient availability | `INSUFFICIENT_INVENTORY` | 409 |
| Reused key with different input | `IDEMPOTENCY_CONFLICT` | 409 |
| Illegal terminal transition | `RESERVATION_STATE_CONFLICT` | 409 |
| Expired confirmation target | `RESERVATION_EXPIRED` | 409 |
| Invalid HTTP input | `VALIDATION_ERROR` | 400 |
| Unexpected database/runtime failure | `INTERNAL_ERROR` | 500 |

Expected outcomes are values returned by SQL functions, not raw database exceptions.
Unexpected errors are logged server-side and mapped without leaking SQL or credentials.
