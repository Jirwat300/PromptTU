-- Add 7 campus / campaign teams to faculty_scores (matches frontend FACULTIES).
-- Safe to re-run: upserts name/emoji only, preserves count.

insert into public.faculty_scores (id, name, emoji, count) values
  ('team_phromtham', 'ทีมพร้อมธรรม',     '✨', 0),
  ('team_dao',       'ทีมดาว',           '⭐', 0),
  ('team_diw',       'ทีมดิว',           '💫', 0),
  ('team_rangsit',   'ทีมรังสิต',        '🏢', 0),
  ('team_lampang',   'ทีมลำปาง',         '🏔️', 0),
  ('team_thaprachan', 'ทีมท่าพระจันทร์', '🛕', 0),
  ('team_pattaya',   'ทีมพัทยา',         '🌊', 0)
on conflict (id) do update set
  name  = excluded.name,
  emoji = excluded.emoji;
