-- Keep faculty `med` score fixed at 0 forever.
-- This enforces product policy at the database layer, regardless of API path.

create or replace function public.force_med_zero()
returns trigger
language plpgsql
as $fn$
begin
  if lower(coalesce(new.id, '')) = 'med' then
    new.count := 0;
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_force_med_zero on public.faculty_scores;

create trigger trg_force_med_zero
before insert or update on public.faculty_scores
for each row
execute function public.force_med_zero();

-- Reset current value immediately.
update public.faculty_scores
set count = 0, updated_at = now()
where lower(id) = 'med';
