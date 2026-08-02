import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, HelpCircle, PartyPopper, RotateCcw, Trophy, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuizQuestion } from "@/lib/content";

export interface QuizData {
  mission: { id: string; title: string; slug: string };
  questions: QuizQuestion[];
}

export interface GradeResult {
  passed: boolean;
  correct_count: number;
  total: number;
  results: { question_id: string; correct: boolean }[];
  unlockedZones: string[];
  // What this submission added to the running total — the gain over the learner's
  // previous best, so a retake can raise it but never inflate it.
  xpEarned: number;
  totalXp: number;
  // What this attempt's score is worth on its own, and whether it beat the
  // previous best. `attemptXp` is shown even when `xpEarned` is 0, so a retake
  // always reports something instead of going silent.
  attemptXp: number;
  isRecord: boolean;
  bestCorrectCount: number;
  bestQuestionTotal: number;
  bestXp: number;
  missionXpValue: number;
}

interface Props {
  zoneSlug: string;
  status: "loading" | "error" | "ready";
  data: QuizData | null;
  onBack: () => void;
  onGraded: (result: GradeResult) => void;
}

/**
 * The full outcome as one spoken sentence. It lives as `sr-only` text *inside* the
 * result panel, which takes focus on grading — one announcement channel, not two.
 * An `aria-live` region alongside a focus move would speak the outcome twice.
 */
function announce(result: GradeResult): string {
  const score = `You scored ${result.correct_count} of ${result.total}.`;
  const banked = result.isRecord
    ? `A new record — you banked ${result.xpEarned} more XP, ${result.bestXp} of ${result.missionXpValue} for this mission.`
    : `No new XP; your best is still ${result.bestCorrectCount} of ${result.bestQuestionTotal}, worth ${result.bestXp} XP.`;
  const gate = result.passed
    ? "You passed and the next zone is unlocked."
    : "Not a pass — every question must be correct. Try again.";
  return `${gate} ${score} ${banked}`;
}

/**
 * What this attempt was worth, shown on a pass *and* a fail. Two parts, on
 * purpose: the "+N XP" pill is the transient celebration (only on a record, and
 * `aria-hidden` because `announce()` already speaks it), while the "Best …" line is
 * persistent state a learner — or a screen reader re-reading the panel — can
 * always check. When the best is short of perfect, it says so and invites another
 * run; when it's maxed, it stops asking.
 */
function AttemptOutcome({ result }: { result: GradeResult }) {
  const maxed = result.bestCorrectCount >= result.bestQuestionTotal;
  return (
    <div className="mt-3 space-y-2">
      {result.isRecord && (
        <div aria-hidden className="flex flex-wrap items-center gap-2">
          <p className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 inline-flex items-center gap-1.5 rounded-full bg-amber-300/20 px-3 py-1 text-2xl font-black text-amber-100 motion-safe:duration-700">
            <Zap className="size-6" aria-hidden />+{result.xpEarned} XP
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-widest text-emerald-200 uppercase">
            <Trophy className="size-3" aria-hidden />
            New record
          </span>
        </div>
      )}
      <p className="text-sm text-slate-300">
        Scored {result.correct_count} of {result.total} · best {result.bestCorrectCount} of {result.bestQuestionTotal} ·{" "}
        <span className="font-semibold text-amber-200">
          {result.bestXp} of {result.missionXpValue} XP
        </span>{" "}
        banked
        {maxed ? " · maxed out" : ""}
      </p>
      {!maxed && (
        <p className="text-xs text-slate-400">
          Retake the quiz any time — a better score banks the difference. A perfect run is worth the full{" "}
          {result.missionXpValue} XP.
        </p>
      )}
    </div>
  );
}

// Quiz sub-view (Phase 3, rescored in S-04): select answers → submit → grade
// server-side. On a pass, the success panel shows and the map is told to unlock;
// on a fail, per-question correctness shows with unlimited "Try again". Either
// way the XP the attempt banked is reported (via onGraded, which also refreshes
// the map badge), so retaking to improve a score always shows its result.
export default function QuizPanel({ zoneSlug, status, data, onBack, onGraded }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Whichever outcome panel renders (pass or fail) takes this ref — they are
  // mutually exclusive — so grading can land focus on the result.
  const resultRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLInputElement>(null);
  // "Try again" unmounts the button that was just activated, so the retry path has
  // to place focus deliberately. The flag keeps this effect from firing on mount,
  // where the heading owns focus.
  const retryPending = useRef(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"answering" | "grading" | "result">("answering");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-runs when the real quiz title replaces "Loading quiz…" — see LessonPanel.
  useEffect(() => {
    headingRef.current?.focus();
  }, [status]);

  useEffect(() => {
    if (phase === "result") {
      resultRef.current?.focus();
      return;
    }
    if (phase === "answering" && retryPending.current) {
      retryPending.current = false;
      firstOptionRef.current?.focus();
    }
  }, [phase]);

  const questions = data?.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((question) => answers[question.id]);

  async function submit() {
    setPhase("grading");
    setSubmitError(null);
    try {
      const response = await fetch("/api/game/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zoneSlug,
          answers: questions.map((question) => ({ question_id: question.id, option_id: answers[question.id] })),
        }),
      });
      if (!response.ok) throw new Error(`grade request failed: ${response.status}`);
      const graded = (await response.json()) as GradeResult;
      setResult(graded);
      setPhase("result");
      // Reported on a fail too: a partial score still banks XP, so the map badge
      // must refresh either way.
      onGraded(graded);
    } catch {
      setSubmitError("We couldn't grade your answers. Please try again.");
      setPhase("answering");
    }
  }

  function tryAgain() {
    retryPending.current = true;
    setAnswers({});
    setResult(null);
    setPhase("answering");
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      aria-labelledby="quiz-heading"
      className="relative min-h-screen w-full bg-slate-950 text-slate-100 focus-visible:outline-none"
    >
      <div className="mx-auto max-w-2xl px-4 py-12">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs tracking-widest text-sky-300/90 uppercase transition hover:text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to map
        </button>

        <section aria-labelledby="quiz-heading" className="mt-6">
          <p className="flex items-center gap-2 font-mono text-xs tracking-[0.3em] text-sky-300/70 uppercase">
            <HelpCircle className="size-3.5" aria-hidden />
            Summit gate
          </p>
          <h1
            id="quiz-heading"
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 text-3xl font-black tracking-tight focus-visible:outline-none"
          >
            {status === "ready" && data ? data.mission.title : "Loading quiz…"}
          </h1>

          {status === "loading" && <p className="mt-6 text-sm text-slate-400">Fetching the questions…</p>}

          {status === "error" && (
            <p role="alert" className="mt-6 text-sm text-rose-300">
              We couldn&rsquo;t load this quiz. Head back to the map and try again.
            </p>
          )}

          {status === "ready" && data && phase === "result" && result?.passed && (
            <div
              ref={resultRef}
              tabIndex={-1}
              className="mt-8 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-6 focus-visible:outline-none"
            >
              {/* Spoken when this panel takes focus: the score, what it banked,
                  whether it beat the previous best, and where that leaves the gate. */}
              <p className="sr-only">{announce(result)}</p>
              <p className="flex items-center gap-2 text-lg font-bold text-amber-200">
                <PartyPopper className="size-5" aria-hidden />
                You cleared the gate!
              </p>
              <AttemptOutcome result={result} />
              <p className="mt-3 text-sm text-slate-300">
                The next zone is lit. Head back to the map to see the trail open up.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
                >
                  Back to the map
                </button>
                <button
                  type="button"
                  onClick={tryAgain}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-400/50 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/10 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Retake quiz
                </button>
              </div>
            </div>
          )}

          {status === "ready" && data && !(phase === "result" && result?.passed) && (
            <>
              {phase === "result" && result && !result.passed && (
                <div
                  ref={resultRef}
                  tabIndex={-1}
                  className="mt-8 rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 focus-visible:outline-none"
                >
                  {/* Same single channel as the pass panel — spoken on focus, so no
                      `role="status"` here to double it up. */}
                  <p className="sr-only">{announce(result)}</p>
                  <p className="text-sm font-semibold text-rose-200">
                    Not quite — {result.correct_count} of {result.total} correct. Every question must be right to open
                    the next zone.
                  </p>
                  {/* A fail still banks the XP its score earned, so the outcome
                      shows here too — the zone stays locked, the points don't. */}
                  <AttemptOutcome result={result} />
                  <p className="mt-3 text-sm text-slate-300">Review the marked questions and try again.</p>
                  <button
                    type="button"
                    onClick={tryAgain}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-sky-400/50 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-400/10 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Try again
                  </button>
                </div>
              )}

              <ol className="mt-8 space-y-8">
                {questions.map((question, index) => {
                  const graded =
                    phase === "result" && result
                      ? result.results.find((r) => r.question_id === question.id)
                      : undefined;
                  return (
                    <li key={question.id}>
                      <fieldset disabled={phase === "grading"}>
                        <legend className="flex items-center gap-2 text-base font-semibold text-slate-100">
                          <span className="font-mono text-sm text-slate-500">{index + 1}.</span>
                          {question.prompt}
                          {/* Icon + `sr-only` text rather than `aria-label` on a bare
                              <svg>: assistive tech isn't obliged to honour the latter,
                              and this matches the convention used elsewhere here. */}
                          {graded && (
                            <>
                              {graded.correct ? (
                                <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
                              ) : (
                                <XCircle className="size-4 text-rose-400" aria-hidden />
                              )}
                              <span className="sr-only">{graded.correct ? "Correct" : "Incorrect"}</span>
                            </>
                          )}
                        </legend>
                        <div className="mt-4 space-y-2">
                          {question.options.map((option, optionIndex) => {
                            const selected = answers[question.id] === option.id;
                            return (
                              <label
                                key={option.id}
                                className={cn(
                                  "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition",
                                  selected
                                    ? "border-sky-400/70 bg-sky-400/10 text-slate-100"
                                    : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-slate-600",
                                )}
                              >
                                <input
                                  type="radio"
                                  // The landing point for "Try again".
                                  ref={index === 0 && optionIndex === 0 ? firstOptionRef : undefined}
                                  name={question.id}
                                  value={option.id}
                                  checked={selected}
                                  onChange={() => {
                                    setAnswers((prev) => ({ ...prev, [question.id]: option.id }));
                                  }}
                                  className="size-4 accent-sky-400"
                                />
                                {option.text}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    </li>
                  );
                })}
              </ol>

              {submitError && (
                <p role="alert" className="mt-6 text-sm text-rose-300">
                  {submitError}
                </p>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={!allAnswered || phase === "grading"}
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === "grading" ? "Grading…" : "Submit answers"}
              </button>
              {!allAnswered && phase !== "grading" && (
                <p className="mt-2 text-xs text-slate-500">Answer all {questions.length} questions to submit.</p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
