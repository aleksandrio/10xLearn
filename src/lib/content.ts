// Typed content-query module (F-01). S-01 consumes these helpers to render the
// guest core loop. Every function takes the shared `createClient(...)` result,
// matching the existing `@/lib` convention (see src/lib/supabase.ts).
//
// Answer-key isolation is preserved by construction: quiz reads go through the
// `quiz_questions_public` view (no `correct_option_id`), and grading goes through
// the `grade_mission_quiz` RPC — the key never crosses into application code.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db/database.types";

/** Supabase client typed against the generated content schema. */
export type ContentClient = SupabaseClient<Database>;

export type Zone = Database["public"]["Tables"]["zones"]["Row"];
export type Mission = Database["public"]["Tables"]["missions"]["Row"];
export type Lesson = Database["public"]["Tables"]["lessons"]["Row"];

/** A selectable quiz option — never carries a correctness flag. */
export interface QuizOption {
  id: string;
  text: string;
}

/** A quiz question as exposed to clients: no `correct_option_id`. */
export interface QuizQuestion {
  id: string;
  mission_id: string;
  order_index: number;
  prompt: string;
  options: QuizOption[];
}

/** A mission together with its (single) lesson. */
export interface MissionWithLesson extends Mission {
  lesson: Lesson | null;
}

/** A single answer submitted for grading. */
export interface QuizAnswer {
  question_id: string;
  option_id: string;
}

/** Shape returned by the `grade_mission_quiz` RPC. */
export interface QuizResult {
  passed: boolean;
  correct_count: number;
  total: number;
  results: { question_id: string; correct: boolean }[];
}

/** All zones in play order (`order_index` ascending). */
export async function getZones(supabase: ContentClient): Promise<Zone[]> {
  const { data, error } = await supabase.from("zones").select("*").order("order_index", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * The first mission of a zone (by zone id), together with its lesson.
 * Returns `null` when the zone has no mission. Prefer this when the caller
 * already holds the zone row (e.g. from `getZones()`), to skip a slug lookup.
 */
export async function getMissionByZoneId(supabase: ContentClient, zoneId: string): Promise<MissionWithLesson | null> {
  const { data, error } = await supabase
    .from("missions")
    .select("*, lessons(*)")
    .eq("zone_id", zoneId)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { lessons, ...mission } = data;
  return { ...mission, lesson: lessons[0] ?? null };
}

/**
 * The first mission of a zone (by slug), together with its lesson.
 * Returns `null` when the zone or its mission does not exist.
 */
export async function getMissionByZone(supabase: ContentClient, zoneSlug: string): Promise<MissionWithLesson | null> {
  const { data: zone, error: zoneError } = await supabase.from("zones").select("id").eq("slug", zoneSlug).maybeSingle();
  if (zoneError) throw zoneError;
  if (!zone) return null;

  return getMissionByZoneId(supabase, zone.id);
}

/**
 * Quiz questions for a mission, read from the key-omitting public view and
 * ordered by `order_index`. The `correct_option_id` is never in this payload.
 */
export async function getQuizQuestions(supabase: ContentClient, missionId: string): Promise<QuizQuestion[]> {
  const { data, error } = await supabase
    .from("quiz_questions_public")
    .select("*")
    .eq("mission_id", missionId)
    .order("order_index", { ascending: true });
  if (error) throw error;

  return data.map((row) => ({
    id: row.id ?? "",
    mission_id: row.mission_id ?? "",
    order_index: row.order_index ?? 0,
    prompt: row.prompt ?? "",
    options: (row.options as QuizOption[] | null) ?? [],
  }));
}

/**
 * Grade a mission submission server-side via the `grade_mission_quiz` RPC.
 * The answer key stays in the database; only pass/fail + per-question
 * correctness come back.
 */
export async function gradeQuiz(
  supabase: ContentClient,
  missionId: string,
  answers: QuizAnswer[],
): Promise<QuizResult> {
  const { data, error } = await supabase.rpc("grade_mission_quiz", {
    p_mission_id: missionId,
    p_answers: answers as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as QuizResult;
}
