-- Per-user progress (S-02): records which missions a learner has passed.
-- This is the second source of truth introduced alongside the signed guest
-- cookie (see src/lib/guest-progress.ts). Authenticated learners read/write
-- their unlocks here; the completion set is reconciled with the guest cookie on
-- login (merge-forward). See plan Critical Implementation Details.
--
-- RLS is owner-only: a learner can only ever see or mutate their own rows.
-- The FK cascade on auth.users means deleting an account carries its progress
-- away automatically (used by account deletion in a later phase).

create table mission_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null references missions (id) on delete cascade,
  completed_at timestamptz not null default now(), -- present now so S-03 XP can read it without a migration
  unique (user_id, mission_id)
);

-- ---------------------------------------------------------------------------
-- RLS: owner-only. No anon access — guests never touch this table.
-- ---------------------------------------------------------------------------

alter table mission_completions enable row level security;

create policy "Owner reads own completions" on mission_completions
  for select to authenticated using (auth.uid() = user_id);

create policy "Owner inserts own completions" on mission_completions
  for insert to authenticated with check (auth.uid() = user_id);

-- Table-level grant required in addition to the RLS policies: the role grant is
-- checked before RLS, and newer Supabase CLIs create migration tables under a
-- restrictive default ACL that withholds these privileges. RLS still restricts
-- rows to the owner. No anon grant — guests never touch this table.
grant select, insert on mission_completions to authenticated;

-- No UPDATE/DELETE policies: completions are insert-only from the app (writes
-- are idempotent upserts that resolve to INSERT). Withholding UPDATE also closes
-- the row-reassignment hole a `using`-only UPDATE policy would leave open.
-- Account deletion removes rows via the FK cascade (service-role admin client).
