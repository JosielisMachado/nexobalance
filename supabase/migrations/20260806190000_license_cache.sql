-- Cache local de la licencia central. Las Edge Functions son las únicas que la actualizan.

create table if not exists nb.license_cache (
  user_id uuid primary key references auth.users(id) on delete cascade,
  platform_license_id uuid,
  status text not null default 'pending',
  valid boolean not null default false,
  plan_code text,
  plan_name text,
  trial_ends_at date,
  paid_through date,
  grace_until date,
  valid_until timestamptz,
  daily_price numeric(14,2) not null default 0,
  currency text not null default 'UYU',
  amount_due numeric(14,2) not null default 0,
  checked_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

alter table nb.license_cache enable row level security;

drop policy if exists license_cache_select_own on nb.license_cache;
create policy license_cache_select_own on nb.license_cache
  for select to authenticated using (user_id = auth.uid());

create or replace function nb.license_is_current()
returns boolean
language sql
stable
security definer
set search_path = nb, public
as $$
  select exists (
    select 1
    from nb.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ) or exists (
    select 1
    from nb.license_cache l
    where l.user_id = auth.uid()
      and l.valid = true
      and (l.valid_until is null or l.valid_until >= now())
  );
$$;

revoke all on function nb.license_is_current() from public;
grant execute on function nb.license_is_current() to authenticated, service_role;

-- Administrador permanente de JosmaTech para mantenimiento y soporte.
update nb.profiles p
set is_admin = true
from auth.users u
where u.id = p.id
  and (
    lower(u.email) = 'josielisuruguay@gmail.com'
    or p.phone = '+59898308375'
  );
