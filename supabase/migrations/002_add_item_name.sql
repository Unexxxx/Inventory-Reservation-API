begin;

alter table public.items add column if not exists name varchar(255);

update public.items
set name = 'Item ' || left(id::text, 8)
where name is null;

alter table public.items alter column name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass and conname in ('items_name_check', 'items_name_length')
  ) then
    alter table public.items
      add constraint items_name_length check (length(btrim(name)) between 1 and 255);
  end if;
end
$$;

create or replace function public.get_item_inventory(p_item_id uuid)
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

create or replace function public.create_item_atomic(p_name text, p_total_quantity bigint)
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

revoke execute on function public.create_item_atomic(text,bigint) from public;
grant execute on function public.create_item_atomic(text,bigint) to inventory_api;

-- Temporary compatibility overload for an already-running pre-v1 deployment.
-- New code uses the named overload above.
create or replace function public.create_item_atomic(p_total_quantity bigint)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.create_item_atomic('Legacy item', p_total_quantity);
$$;

revoke execute on function public.create_item_atomic(bigint) from public;
grant execute on function public.create_item_atomic(bigint) to inventory_api;

commit;
