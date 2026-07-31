-- Content model (F-01): read-only zones -> missions -> lessons -> quiz_questions.
-- Establishes answer-key isolation: the quiz base table is locked to clients;
-- a key-omitting public view + a SECURITY DEFINER grading RPC are the only
-- client-reachable surfaces for quiz data. See plan Critical Implementation Details.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table zones (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  order_index int not null unique
);

create table missions (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones (id) on delete cascade,
  slug text unique not null,
  title text not null,
  order_index int not null
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions (id) on delete cascade,
  title text,
  body text not null
);

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions (id) on delete cascade,
  order_index int not null,
  prompt text not null,
  options jsonb not null, -- array of { id, text }; NEVER carries a correct flag
  correct_option_id text not null -- the answer key; isolated so the public view can omit it
);

-- ---------------------------------------------------------------------------
-- RLS: public read on non-sensitive content; quiz base table locked
-- ---------------------------------------------------------------------------

alter table zones enable row level security;
alter table missions enable row level security;
alter table lessons enable row level security;
alter table quiz_questions enable row level security;

create policy "Public read zones" on zones
  for select to anon, authenticated using (true);

create policy "Public read missions" on missions
  for select to anon, authenticated using (true);

create policy "Public read lessons" on lessons
  for select to anon, authenticated using (true);

-- Table-level SELECT grant is required in addition to the RLS policies above:
-- the role grant is checked before RLS, and newer Supabase CLIs create
-- migration tables under a restrictive default ACL that withholds SELECT from
-- anon/authenticated. Without this, reads fail with "permission denied" before
-- the policies ever apply. RLS still governs which rows are visible.
grant select on zones, missions, lessons to anon, authenticated;

-- quiz_questions: intentionally NO anon/authenticated SELECT policy.
-- With RLS enabled and no policy, clients read zero rows from the base table.
-- Access to safe quiz columns is only via quiz_questions_public below.

-- ---------------------------------------------------------------------------
-- Public view: hides the answer key; runs as owner (do NOT set security_invoker=on)
-- ---------------------------------------------------------------------------

create view quiz_questions_public as
  select id, mission_id, order_index, prompt, options
  from quiz_questions;

grant select on quiz_questions_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Server-side grading: answer key never leaves the database
-- ---------------------------------------------------------------------------

create function grade_mission_quiz(p_mission_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_correct int;
  v_results jsonb;
begin
  select count(*) into v_total from quiz_questions where mission_id = p_mission_id;
  select
    coalesce(sum(case when q.correct_option_id = a.option_id then 1 else 0 end), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'question_id', q.id, 'correct', q.correct_option_id = a.option_id)), '[]'::jsonb)
  into v_correct, v_results
  from quiz_questions q
  join jsonb_to_recordset(p_answers) as a(question_id uuid, option_id text)
    on a.question_id = q.id
  where q.mission_id = p_mission_id;
  return jsonb_build_object(
    'passed', v_correct = v_total and v_total > 0,
    'correct_count', v_correct,
    'total', v_total,
    'results', v_results);
end $$;

grant execute on function grade_mission_quiz(uuid, jsonb) to anon, authenticated;
