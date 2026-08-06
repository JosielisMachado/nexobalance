-- La interfaz bloquea la app; estos triggers impiden que una llamada directa
-- al API o al RPC de sincronización escriba datos sin una licencia vigente.

create or replace function nb.enforce_active_license()
returns trigger
language plpgsql
security definer
set search_path = nb, public
as $$
begin
  if not nb.license_is_current() then
    raise exception using
      errcode = '42501',
      message = 'Se requiere una licencia activa para usar NexoBalance.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function nb.enforce_active_license() from public;

do $$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'accounts',
    'budgets',
    'categories',
    'goals',
    'monthly_plan',
    'movements'
  ] loop
    if to_regclass('nb.' || protected_table) is not null then
      execute format('drop trigger if exists enforce_active_license on nb.%I', protected_table);
      execute format(
        'create trigger enforce_active_license before insert or update or delete on nb.%I for each row execute function nb.enforce_active_license()',
        protected_table
      );
    end if;
  end loop;
end;
$$;
