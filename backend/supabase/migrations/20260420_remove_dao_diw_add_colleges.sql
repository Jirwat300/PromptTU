-- Remove campaign teams ทีมดาว / ทีมดิว; add วิทยาลัยสหวิทยาการ + วิทยาลัยนวัตกรรม (matches poptu-faculties.json).

delete from public.faculty_scores
where id in ('team_dao', 'team_diw');

insert into public.faculty_scores (id, name, emoji, count) values
  ('interdisc', 'วิทยาลัยสหวิทยาการ', '🧩', 0),
  ('innov',     'วิทยาลัยนวัตกรรม',   '💡', 0)
on conflict (id) do update set
  name  = excluded.name,
  emoji = excluded.emoji;
