---
change_id: seed-content-model
title: Define and seed zone/mission/lesson/quiz content
status: impl_reviewed
created: 2026-07-27
updated: 2026-07-27
archived_at: null
---

## Notes

- Roadmap slice **F-01** (foundation). Unblocks **S-01 guest-core-loop**.
- Deliberately minimal: read-only content model + seed only. NO progression / persistence / XP tables — those arrive with S-02 / S-03.
- Key decisions (see `plan-brief.md`): seed subject = 10xLearn's own domain (AI-assisted dev); quiz options as JSONB with an isolated `correct_option_id`; RLS on with public content read + answer key hidden behind a view/RPC; 2 zones × 1 mission × 3 questions; ships generated types + a typed `src/lib/content.ts` query module.
