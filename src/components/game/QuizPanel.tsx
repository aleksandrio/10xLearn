import { useEffect, useRef, useState } from "react";
import { ArrowLeft, HelpCircle } from "lucide-react";
import type { QuizQuestion } from "@/lib/content";

export interface QuizData {
  mission: { id: string; title: string; slug: string };
  questions: QuizQuestion[];
}

interface Props {
  status: "loading" | "error" | "ready";
  data: QuizData | null;
  onBack: () => void;
}

// Quiz sub-view (Phase 2): renders the questions as selectable radio groups.
// No submit yet — grading, result, and retry land in Phase 3.
export default function QuizPanel({ status, data, onBack }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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

          {status === "ready" && data && (
            <ol className="mt-8 space-y-8">
              {data.questions.map((question, index) => (
                <li key={question.id}>
                  <fieldset>
                    <legend className="text-base font-semibold text-slate-100">
                      <span className="mr-2 font-mono text-sm text-slate-500">{index + 1}.</span>
                      {question.prompt}
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
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
