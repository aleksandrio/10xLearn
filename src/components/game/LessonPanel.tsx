import { useEffect, useRef } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";

export interface LessonData {
  mission: { id: string; title: string; slug: string };
  lesson: { id: string; title: string; body: string };
}

interface Props {
  status: "loading" | "error" | "ready";
  data: LessonData | null;
  onBack: () => void;
}

// Lesson sub-view (Phase 2): displays a zone's briefing text with a route back to
// the map. Focus moves to the heading on open — and again once the real title
// lands — so keyboard/SR users land in the panel and hear what they opened.
export default function LessonPanel({ status, data, onBack }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Re-runs on the loading → ready|error transition, not just on mount: the heading
  // reads "Loading briefing…" when focus first lands, and swapping its text in place
  // would otherwise be a silent change for a screen reader. `status` settles at most
  // once per mount, so this can't fight a learner who has moved on.
  useEffect(() => {
    headingRef.current?.focus();
  }, [status]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      aria-labelledby="lesson-heading"
      className="relative min-h-screen w-full bg-slate-950 text-slate-100 focus-visible:outline-none"
    >
      <div className="mx-auto max-w-2xl px-4 py-12">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs tracking-widest text-amber-300/90 uppercase transition hover:text-amber-200 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to map
        </button>

        <section aria-labelledby="lesson-heading" className="mt-6">
          <p className="flex items-center gap-2 font-mono text-xs tracking-[0.3em] text-amber-300/70 uppercase">
            <BookOpen className="size-3.5" aria-hidden />
            Briefing
          </p>
          <h1
            id="lesson-heading"
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 text-3xl font-black tracking-tight focus-visible:outline-none"
          >
            {status === "ready" && data ? data.lesson.title : "Loading briefing…"}
          </h1>

          {status === "loading" && <p className="mt-6 text-sm text-slate-400">Fetching the briefing…</p>}

          {status === "error" && (
            <p role="alert" className="mt-6 text-sm text-rose-300">
              We couldn&rsquo;t load this briefing. Head back to the map and try again.
            </p>
          )}

          {status === "ready" && data && (
            <div className="mt-6 space-y-4 leading-relaxed text-slate-300">
              {data.lesson.body.split(/\n\n+/).map((paragraph, index) => (
                <p key={index} className="whitespace-pre-wrap">
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
