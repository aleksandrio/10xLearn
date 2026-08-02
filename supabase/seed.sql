-- Seed content (F-01): two ordered zones on the AI-assisted-development subject,
-- one mission + one lesson each, three quiz questions per mission.
-- Deterministic (fixed UUIDs) and idempotent: the truncate lets this seed be
-- re-applied on its own, and `db reset` re-runs it cleanly.
--
-- Integrity rule: every question is answerable from its mission's lesson body,
-- and each `correct_option_id` matches an option `id` in that row's `options`.

-- DESTRUCTIVE: cascades through zones -> missions -> lessons -> quiz_questions.
-- Intended ONLY for local `supabase db reset` re-seeding. NEVER run this file by
-- hand against a shared/staging/production database — it wipes all content.
truncate table zones cascade;

-- ---------------------------------------------------------------------------
-- Zones
-- ---------------------------------------------------------------------------

insert into zones (id, slug, title, description, order_index) values
  ('a0000000-0000-0000-0000-000000000001', 'foundations',
   'Foundations of AI-Assisted Development',
   'Learn how AI coding assistants think and how to prompt them so they produce the code you actually want.',
   1),
  ('a0000000-0000-0000-0000-000000000002', 'context-and-agents',
   'Context & Agents',
   'Go beyond one-off prompts: understand the context window and how tool-using agents act on your codebase.',
   2);

-- ---------------------------------------------------------------------------
-- Missions (one per zone)
-- ---------------------------------------------------------------------------

-- xp_value escalates per zone (10 → 20) so progression feels weighted: a small
-- game-feel signal that later zones are worth more. Derived XP sums these.
insert into missions (id, zone_id, slug, title, order_index, xp_value) values
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001', 'prompting-basics', 'Prompting Basics', 1, 10),
  ('b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002', 'working-with-context', 'Working with Context', 1, 20);

-- ---------------------------------------------------------------------------
-- Lessons (one per mission) — the quiz answers live in these bodies
-- ---------------------------------------------------------------------------

insert into lessons (id, mission_id, title, body) values
  ('c0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'Prompting Basics',
$md$# Prompting Basics

AI coding assistants work by predicting the next **token** based on the text you give them. They do not "know" your project — they only see the **context** you provide in the prompt.

Three habits make prompts far more effective:

1. **Be specific.** State the language, framework, and the exact outcome you want. "Write a TypeScript function that validates an email and returns a boolean" beats "write email code".
2. **Give examples.** Showing one or two examples of the input and the output you expect (called *few-shot* prompting) steers the model toward the format you want.
3. **Iterate.** Treat the first response as a draft. Refine your prompt with feedback instead of expecting a perfect answer on the first try.

Remember: a vague prompt produces a vague answer. The clearer your instructions, the better the generated code.$md$),
  ('c0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002', 'Working with Context',
$md$# Working with Context

Everything an AI assistant can reason about must fit inside its **context window** — the limited amount of text (measured in tokens) it can consider at once. If information is not in the context window, the model cannot use it.

This has practical consequences:

- **Provide the relevant files.** The assistant only sees the code you share, so include the files that matter for the task and leave out unrelated ones to avoid wasting the context window.
- **Agents can use tools.** Unlike a plain chat model, an *agent* can take actions — reading files, running commands, and editing code — by calling tools, then using each result to decide its next step.
- **More context is not always better.** Flooding the window with irrelevant code can bury the important details and degrade the quality of the answer.

In short: curate what you feed the model. Relevant, focused context beats dumping your entire codebase.$md$);

-- ---------------------------------------------------------------------------
-- Quiz questions (three per mission). options: array of { id, text }.
-- correct_option_id is isolated from options and never leaves the DB.
-- ---------------------------------------------------------------------------

-- Mission 1: Prompting Basics
insert into quiz_questions (id, mission_id, order_index, prompt, options, correct_option_id) values
  ('d1000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 1,
   'How does an AI coding assistant primarily generate its output?',
   '[{"id":"a","text":"By predicting the next token from the context you provide"},
     {"id":"b","text":"By automatically reading every file in your project"},
     {"id":"c","text":"By running your test suite and copying the output"},
     {"id":"d","text":"By searching the public web in real time"}]'::jsonb,
   'a'),
  ('d1000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000001', 2,
   'What does "few-shot" prompting mean?',
   '[{"id":"a","text":"Asking the model the same question only once"},
     {"id":"b","text":"Giving one or two examples of the input and expected output"},
     {"id":"c","text":"Limiting the model to a few output tokens"},
     {"id":"d","text":"Running the prompt across several different models"}]'::jsonb,
   'b'),
  ('d1000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000001', 3,
   'How does the lesson recommend treating the AI''s first response?',
   '[{"id":"a","text":"As a final answer to ship immediately"},
     {"id":"b","text":"As a draft to refine through iteration"},
     {"id":"c","text":"As an error that should be discarded"},
     {"id":"d","text":"As a test case for your code"}]'::jsonb,
   'b');

-- Mission 2: Working with Context
insert into quiz_questions (id, mission_id, order_index, prompt, options, correct_option_id) values
  ('d2000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 1,
   'What is the "context window"?',
   '[{"id":"a","text":"The limited amount of text (in tokens) the model can consider at once"},
     {"id":"b","text":"The editor pane where you type your code"},
     {"id":"c","text":"A window that lists compiler errors"},
     {"id":"d","text":"The model''s permanent memory of every past chat"}]'::jsonb,
   'a'),
  ('d2000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002', 2,
   'What distinguishes an agent from a plain chat model?',
   '[{"id":"a","text":"It always has a larger context window"},
     {"id":"b","text":"It can take actions by calling tools, then use each result to decide next steps"},
     {"id":"c","text":"It never makes mistakes in its answers"},
     {"id":"d","text":"It runs entirely offline without a model"}]'::jsonb,
   'b'),
  ('d2000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000002', 3,
   'Why is adding more context not always better?',
   '[{"id":"a","text":"It always costs more money to run"},
     {"id":"b","text":"Irrelevant code can bury important details and degrade the answer"},
     {"id":"c","text":"The model refuses any long input"},
     {"id":"d","text":"It makes the generated code run slower"}]'::jsonb,
   'b');
