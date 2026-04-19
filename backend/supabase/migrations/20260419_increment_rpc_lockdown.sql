-- Lock down increment_faculty_score: no arbitrary fid upserts; callable only by service_role.
-- Apply after seed rows exist for every valid faculty id.
--
-- Avoid `SELECT ... INTO var` (plain SQL treats INTO as table target → "relation does not exist").
-- Use `var := (SELECT ...)` only. Run the whole file in one execution.

create or replace function public.increment_faculty_score (fid text, delta integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d int;
  r bigint;
begin
  if delta is null or delta <= 0 then
    r := (
      select coalesce(fs."count", 0)
      from public.faculty_scores fs
      where fs.id = increment_faculty_score.fid
      limit 1
    );
    return coalesce(r, 0);
  end if;

  d := least(delta, 100);
  update public.faculty_scores fs
  set
    "count" = fs."count" + d,
    updated_at = now()
  where fs.id = increment_faculty_score.fid;

  r := (
    select coalesce(fs."count", 0)
    from public.faculty_scores fs
    where fs.id = increment_faculty_score.fid
    limit 1
  );

  return coalesce(r, 0);
end;
$fn$;

revoke all on function public.increment_faculty_score(text, integer) from public;
grant execute on function public.increment_faculty_score(text, integer) to service_role;
