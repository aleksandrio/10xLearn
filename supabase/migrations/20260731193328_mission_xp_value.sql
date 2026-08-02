-- XP across sessions (S-03): give each mission an integer XP value so XP can be
-- weighted per mission (and later tuned) rather than a hard-coded constant.
--
-- XP is never stored as a running total — it is DERIVED at read time from the
-- mission_completions set (see src/lib/progress.ts, mirroring the existing
-- "derive unlocks from completions" idiom). This column only supplies the
-- per-mission weight the derivation sums over.
--
-- Additive and backfill-free: a positive NOT NULL default means every already-
-- seeded mission is immediately worth 10 XP with no re-seed required. Missions
-- already have public read, so no RLS change is needed. Rollback is dropping the
-- column; the derived-XP code has no other schema dependency.

alter table missions add column xp_value int not null default 10;
