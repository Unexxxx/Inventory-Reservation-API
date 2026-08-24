begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'inventory_api') then
    create role inventory_api nologin;
  end if;
end
$$;

alter default privileges in schema public revoke execute on functions from public;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null check (length(btrim(name)) between 1 and 255),
  total_quantity bigint not null check (total_quantity > 0),
  created_at timestamptz not null default clock_timestamp()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  customer_id varchar(255) not null check (length(btrim(customer_id)) between 1 and 255),
  quantity bigint not null check (quantity > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  idempotency_key varchar(255) not null unique check (length(btrim(idempotency_key)) between 1 and 255),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint reservations_expiration_after_creation check (expires_at > created_at)
);

create index reservations_item_active_idx on public.reservations (item_id, expires_at)
  where status = 'pending';
create index reservations_item_confirmed_idx on public.reservations (item_id)
  where status = 'confirmed';
create index reservations_expiration_idx on public.reservations (expires_at, id)
  where status = 'pending';

revoke all on public.items, public.reservations from public, inventory_api;
grant usage on schema public to inventory_api;
grant select on public.items, public.reservations to inventory_api;

create function public.get_item_inventory(p_item_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'totalQuantity', i.total_quantity,
    'availableQuantity', i.total_quantity
      - coalesce(sum(r.quantity) filter (where r.status = 'confirmed'), 0)
      - coalesce(sum(r.quantity) filter (where r.status = 'pending' and r.expires_at > clock_timestamp()), 0),
    'heldQuantity', coalesce(sum(r.quantity) filter (where r.status = 'pending' and r.expires_at > clock_timestamp()), 0),
    'confirmedQuantity', coalesce(sum(r.quantity) filter (where r.status = 'confirmed'), 0),
    'createdAt', i.created_at
  )
  from public.items i
  left join public.reservations r on r.item_id = i.id
  where i.id = p_item_id
  group by i.id;
$$;

create function public.create_item_atomic(p_name text, p_total_quantity bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'invalid item name';
  end if;
  if p_total_quantity is null or p_total_quantity <= 0 then
    raise exception using errcode = '22023', message = 'invalid total quantity';
  end if;
  insert into public.items(name, total_quantity)
    values (btrim(p_name), p_total_quantity) returning * into v_item;
  return jsonb_build_object(
    'id', v_item.id, 'name', v_item.name, 'totalQuantity', v_item.total_quantity,
    'availableQuantity', v_item.total_quantity, 'heldQuantity', 0,
    'confirmedQuantity', 0, 'createdAt', v_item.created_at
  );
end;
$$;

create function public.create_reservation_atomic(
  p_item_id uuid,
  p_customer_id text,
  p_quantity bigint,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.reservations;
  v_item public.items;
  v_reservation public.reservations;
  v_committed bigint;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));

  select * into v_existing from public.reservations where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint = p_request_fingerprint then
      return jsonb_build_object('outcome', 'replayed', 'reservation', jsonb_build_object(
        'id', v_existing.id, 'itemId', v_existing.item_id, 'customerId', v_existing.customer_id,
        'quantity', v_existing.quantity, 'status', v_existing.status,
        'createdAt', v_existing.created_at, 'expiresAt', v_existing.expires_at));
    end if;
    return jsonb_build_object('outcome', 'idempotency_conflict');
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if p_expires_at <= v_now then
    return jsonb_build_object('outcome', 'invalid_expiration');
  end if;

  update public.reservations
    set status = 'expired', updated_at = v_now
    where item_id = p_item_id and status = 'pending' and expires_at <= v_now;

  select coalesce(sum(quantity), 0) into v_committed
  from public.reservations
  where item_id = p_item_id
    and (status = 'confirmed' or (status = 'pending' and expires_at > v_now));

  if v_committed + p_quantity > v_item.total_quantity then
    return jsonb_build_object('outcome', 'insufficient_inventory');
  end if;

  insert into public.reservations(
    item_id, customer_id, quantity, idempotency_key, request_fingerprint,
    created_at, expires_at, updated_at
  ) values (
    p_item_id, btrim(p_customer_id), p_quantity, btrim(p_idempotency_key),
    p_request_fingerprint, v_now, p_expires_at, v_now
  ) returning * into v_reservation;

  return jsonb_build_object('outcome', 'created', 'reservation', jsonb_build_object(
    'id', v_reservation.id, 'itemId', v_reservation.item_id,
    'customerId', v_reservation.customer_id, 'quantity', v_reservation.quantity,
    'status', v_reservation.status, 'createdAt', v_reservation.created_at,
    'expiresAt', v_reservation.expires_at));
end;
$$;

create function public.confirm_reservation_atomic(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_reservation from public.reservations where id = p_reservation_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  if v_reservation.status = 'confirmed' then
    return jsonb_build_object('outcome', 'confirmed', 'reservation', jsonb_build_object(
      'id', v_reservation.id, 'itemId', v_reservation.item_id, 'customerId', v_reservation.customer_id,
      'quantity', v_reservation.quantity, 'status', v_reservation.status,
      'createdAt', v_reservation.created_at, 'expiresAt', v_reservation.expires_at));
  end if;
  if v_reservation.status <> 'pending' then return jsonb_build_object('outcome', 'state_conflict'); end if;
  if v_reservation.expires_at <= v_now then
    update public.reservations set status = 'expired', updated_at = v_now where id = p_reservation_id
      returning * into v_reservation;
    return jsonb_build_object('outcome', 'expired');
  end if;

  update public.reservations set status = 'confirmed', updated_at = v_now where id = p_reservation_id
    returning * into v_reservation;
  return jsonb_build_object('outcome', 'confirmed', 'reservation', jsonb_build_object(
    'id', v_reservation.id, 'itemId', v_reservation.item_id, 'customerId', v_reservation.customer_id,
    'quantity', v_reservation.quantity, 'status', v_reservation.status,
    'createdAt', v_reservation.created_at, 'expiresAt', v_reservation.expires_at));
end;
$$;

create function public.cancel_reservation_atomic(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reservations;
begin
  select * into v_reservation from public.reservations where id = p_reservation_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_reservation.status = 'cancelled' then
    return jsonb_build_object('outcome', 'cancelled', 'reservation', jsonb_build_object(
      'id', v_reservation.id, 'itemId', v_reservation.item_id, 'customerId', v_reservation.customer_id,
      'quantity', v_reservation.quantity, 'status', v_reservation.status,
      'createdAt', v_reservation.created_at, 'expiresAt', v_reservation.expires_at));
  end if;
  if v_reservation.status <> 'pending' then return jsonb_build_object('outcome', 'state_conflict'); end if;
  update public.reservations set status = 'cancelled', updated_at = clock_timestamp()
    where id = p_reservation_id returning * into v_reservation;
  return jsonb_build_object('outcome', 'cancelled', 'reservation', jsonb_build_object(
    'id', v_reservation.id, 'itemId', v_reservation.item_id, 'customerId', v_reservation.customer_id,
    'quantity', v_reservation.quantity, 'status', v_reservation.status,
    'createdAt', v_reservation.created_at, 'expiresAt', v_reservation.expires_at));
end;
$$;

create function public.expire_reservations_atomic(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_more boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'invalid expiration limit';
  end if;
  with candidates as (
    select id from public.reservations
    where status = 'pending' and expires_at <= clock_timestamp()
    order by expires_at, id
    limit p_limit
    for update skip locked
  ), updated as (
    update public.reservations r set status = 'expired', updated_at = clock_timestamp()
    from candidates c where r.id = c.id and r.status = 'pending'
    returning r.id
  ) select count(*)::integer into v_count from updated;

  select exists(
    select 1 from public.reservations
    where status = 'pending' and expires_at <= clock_timestamp()
  ) into v_more;
  return jsonb_build_object('expiredCount', v_count, 'hasMore', v_more);
end;
$$;

revoke execute on function public.get_item_inventory(uuid) from public;
revoke execute on function public.create_item_atomic(text,bigint) from public;
revoke execute on function public.create_reservation_atomic(uuid,text,bigint,timestamptz,text,text) from public;
revoke execute on function public.confirm_reservation_atomic(uuid) from public;
revoke execute on function public.cancel_reservation_atomic(uuid) from public;
revoke execute on function public.expire_reservations_atomic(integer) from public;

grant execute on function public.get_item_inventory(uuid) to inventory_api;
grant execute on function public.create_item_atomic(text,bigint) to inventory_api;
grant execute on function public.create_reservation_atomic(uuid,text,bigint,timestamptz,text,text) to inventory_api;
grant execute on function public.confirm_reservation_atomic(uuid) to inventory_api;
grant execute on function public.cancel_reservation_atomic(uuid) to inventory_api;
grant execute on function public.expire_reservations_atomic(integer) to inventory_api;

commit;
