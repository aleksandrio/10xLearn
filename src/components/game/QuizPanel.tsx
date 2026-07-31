import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, HelpCircle, PartyPopper, RotateCcw, XCircle } from "lucide-react";
import type { QuizQuestion } from "@/lib/content";

export interface QuizData {
  mission: { id: string; title: string; slug: string };
  questions: QuizQuestion[];
}

interface GradeResult {
  passed: boolean;
  correct_count: number;
  total: number;
  results: { question_id: string; correct: boolean }[];
  unlockedZones: string[];
}

interface Props {
  zoneSlug: string;
  status: "loading" | "error" | "ready";
  data: QuizData | null;
  onBack: () => void;
  onUnlocked: (unlockedZones: string[]) => void;
}

// Quiz sub-view (Phase 3): select answers → submit → grade server-side. On a
// pass, the success panel shows and the map is told to unlock (via onUnlocked);
// on a fail, per-question correctness shows with unlimited "Try again".
export default function QuizPanel({ zoneSlug, status, data, onBack, onUnlocked }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"answering" | "grading" | "result">("answering");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
      if (graded.passed) onUnlocked(graded.unlockedZones);
    } catch {
      setSubmitError("We couldn't grade your answers. Please try again.");
      setPhase("answering");
    }
  }

  function tryAgain() {
    setAnswers({});
    setResult(null);
    setPhase("answering");
  }

  return (
    <main className="relative min-h-screen w-full bg-slate-950 text-slate-100">
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

          {/* Screen-reader + visual announcement of the outcome. */}
          <div aria-live="polite" className="sr-only">
            {phase === "result" && result
              ? result.passed
                ? "You passed. The next zone is unlocked."
                : `Not quite. ${result.correct_count} of ${result.total} correct. Try again.`
              : ""}
          </div>

          {status === "ready" && data && phase === "result" && result?.passed && (
            <div className="mt-8 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-6">
              <p className="flex items-center gap-2 text-lg font-bold text-amber-200">
                <PartyPopper className="size-5" aria-hidden />
                You cleared the gate!
              </p>
              <p className="mt-2 text-sm text-slate-300">
                The next zone is lit. Head back to the map to see the trail open up.
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
              >
                Back to the map
              </button>
            </div>
          )}

          {status === "ready" && data && !(phase === "result" && result?.passed) && (
            <>
              {phase === "result" && result && !result.passed && (
                <div className="mt-8 rounded-xl border border-rose-400/40 bg-rose-400/10 p-4" role="status">
                  <p className="text-sm font-semibold text-rose-200">
                    Not quite — {result.correct_count} of {result.total} correct.
                  </p>
                  <p className="mt-1 text-sm text-slate-300">Review the marked questions and try again.</p>
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
                          {graded &&
                            (graded.correct ? (
                              <CheckCircle2 className="size-4 text-emerald-400" aria-label="Correct" />
                            ) : (
                              <XCircle className="size-4 text-rose-400" aria-label="Incorrect" />
                            ))}
                        </legend>
                        <div className="mt-4 space-y-2">
                          {question.options.map((option) => {
                            const selected = answers[question.id] === option.id;
                            return (
                              <label
                                key={option.id}
                                className={
                                  "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition " +
                                  (selected
                                    ? "border-sky-400/70 bg-sky-400/10 text-slate-100"
                                    : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-slate-600")
                                }
                              >
                                <input
                                  type="radio"
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
