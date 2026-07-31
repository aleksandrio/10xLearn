-- Quiz attempts (S-04): replaces the binary `mission_completions` row with an
-- append-only ledger of every submission, so a learner can retake a quiz to
-- improve their score and bank more XP.
--
-- Why a ledger instead of a mutable "best score" row:
--   * It keeps the insert-only RLS posture `mission_completions` established —
--     no UPDATE policy, so the row-reassignment hole stays closed and a recorded
--     attempt can never be rewritten after the fact.
--   * "Best score" and "cleared" are then *derived* (max ratio / any passed
--     attempt), matching this codebase's rule that progress is summed on demand
--     rather than stored as a running total. See src/lib/progress.ts.
--   * Recording the attempt needs no read-compare-write, so two concurrent
--     submissions cannot race a best-score update.
--
-- The unlock gate is unchanged: `passed` still means every question correct
-- (PRD: "all 3 questions correct — a strict gate"). XP is what became graded —
-- it now scales with the score of the learner's best attempt.

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null references missions (id) on delete cascade,
  correct_count int not null check (correct_count >= 0),
  -- The question count *at the time of the attempt*, so XP stays faithful to the
  -- quiz the learner actually faced if content later changes length.
  question_total int not null check (question_total > 0),
  -- The pass verdict under the rules in force at the time. Stored rather than
  -- re-derived so tightening the gate later cannot retroactively re-lock zones.
  passed boolean not null,
  attempted_at timestamptz not null default now(),
  constraint correct_count_within_total check (correct_count <= question_total)
);

-- Every read is "this user's attempts, for one or all missions".
create index quiz_attempts_user_mission_idx on quiz_attempts (user_id, mission_id);

-- ---------------------------------------------------------------------------
-- Carry existing progress forward: each completion was, by definition, a
-- perfect attempt. Runs before the drop so no learner loses a cleared zone.
-- ---------------------------------------------------------------------------

insert into quiz_attempts (user_id, mission_id, correct_count, question_total, passed, attempted_at)
select
  completion.user_id,
  completion.mission_id,
  counted.question_total,
  counted.question_total,
  true,
  completion.completed_at
from mission_completions completion
join (
  select mission_id, count(*)::int as question_total
  from quiz_questions
  group by mission_id
) counted on counted.mission_id = completion.mission_id;

drop table mission_completions;

-- ---------------------------------------------------------------------------
-- RLS: owner-only, insert-only. Mirrors the table it replaces. No anon access —
-- guests keep their attempts in the signed cookie, never in this table.
-- ---------------------------------------------------------------------------

alter table quiz_attempts enable row level security;

create policy "Owner reads own attempts" on quiz_attempts
  for select to authenticated using (auth.uid() = user_id);

create policy "Owner inserts own attempts" on quiz_attempts
  for insert to authenticated with check (auth.uid() = user_id);

-- Table-level grant required in addition to the RLS policies: the role grant is
-- checked before RLS, and newer Supabase CLIs create migration tables under a
-- restrictive default ACL that withholds these privileges.
grant select, insert on quiz_attempts to authenticated;

-- No UPDATE/DELETE policies: the ledger is immutable. A better score is a new
-- row, never an edit — which is what makes "best" safe to derive.
