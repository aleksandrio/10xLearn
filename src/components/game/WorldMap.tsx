import { useState } from "react";
import { BookOpen, Compass, HelpCircle, Lightbulb, Lock, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckpointType, MapZone } from "@/lib/game";
import LessonPanel, { type LessonData } from "./LessonPanel";
import QuizPanel, { type QuizData } from "./QuizPanel";

interface Props {
  initialZones: MapZone[];
  initialXp: number;
  isAuthenticated: boolean;
  userEmail?: string | null;
}

type View = "map" | "lesson" | "quiz";
type PanelStatus = "loading" | "error" | "ready";

const CHECKPOINT_ICON: Record<CheckpointType, typeof BookOpen> = {
  lesson: BookOpen,
  quiz: HelpCircle,
};

// Phase 2 wires station clicks to fetch gated content and switch sub-views
// (map ⇄ lesson ⇄ quiz) without touching the URL. Phase 3 adds grading + the
// unlock transition (the point at which the character advances to a new zone).
export default function WorldMap({ initialZones, initialXp, isAuthenticated, userEmail = null }: Props) {
  const [zones, setZones] = useState<MapZone[]>(initialZones);
  // Accumulated XP total, seeded from SSR and updated live when a pass reports a
  // new total (see handleUnlocked), so returning to the map shows current XP.
  const [xp, setXp] = useState(initialXp);
  const [view, setView] = useState<View>("map");
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  // Guests get a "save your progress" nudge the moment they clear a gate; authed
  // learners never see it (their progress is already persisted).
  const [showNudge, setShowNudge] = useState(false);

  function backToMap() {
    setView("map");
  }

  // Unlock is derived server-side; the grade response tells us which zones are
  // now open so the map re-renders (and the character advances to the frontier).
  function handleUnlocked(unlockedZones: string[], totalXp: number) {
    setZones((prev) => prev.map((zone) => (unlockedZones.includes(zone.slug) ? { ...zone, locked: false } : zone)));
    setXp(totalXp);
    if (!isAuthenticated) setShowNudge(true);
  }

  async function openLesson(zoneSlug: string) {
    setActiveZone(zoneSlug);
    setView("lesson");
    setStatus("loading");
    setLesson(null);
    try {
      const response = await fetch(`/api/game/lesson?zoneSlug=${encodeURIComponent(zoneSlug)}`);
      if (!response.ok) throw new Error(`lesson request failed: ${response.status}`);
      setLesson((await response.json()) as LessonData);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  async function openQuiz(zoneSlug: string) {
    setActiveZone(zoneSlug);
    setView("quiz");
    setStatus("loading");
    setQuiz(null);
    try {
      const response = await fetch(`/api/game/quiz?zoneSlug=${encodeURIComponent(zoneSlug)}`);
      if (!response.ok) throw new Error(`quiz request failed: ${response.status}`);
      setQuiz((await response.json()) as QuizData);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  if (view === "lesson") {
    return <LessonPanel status={status} data={lesson} onBack={backToMap} />;
  }
  if (view === "quiz") {
    return (
      <QuizPanel
        status={status}
        data={quiz}
        zoneSlug={activeZone ?? ""}
        onBack={backToMap}
        onUnlocked={handleUnlocked}
      />
    );
  }

  const total = zones.length;
  const litCount = zones.filter((zone) => !zone.locked).length;
  // The frontier is the furthest zone reached; the character waits at its lesson
  // station — the natural "start here" for the zone you've just unlocked.
  const frontierSlug = [...zones].reverse().find((zone) => !zone.locked)?.slug ?? zones[0]?.slug;

  return (
    <main
      aria-labelledby="worldmap-heading"
      className="relative min-h-screen w-full overflow-hidden bg-slate-950 text-slate-100"
    >
      {/* Ambient depth: warm lantern glow near the reached trail, cold haze up ahead. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
        <div className="absolute -bottom-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -top-40 left-1/3 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-16">
        {isAuthenticated ? (
          <nav aria-label="Account" className="mb-8 flex items-center justify-end gap-3 text-sm">
            {userEmail && (
              <span className="hidden text-slate-400 sm:inline" title={userEmail}>
                {userEmail}
              </span>
            )}
            <a
              href="/dashboard"
              className="rounded-lg px-3 py-1.5 font-medium text-slate-300 transition hover:text-white focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
            >
              Dashboard
            </a>
            <form method="POST" action="/api/auth/signout">
              <button
                type="submit"
                className="rounded-lg bg-amber-400/15 px-3 py-1.5 font-medium text-amber-200 transition hover:bg-amber-400/25 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
              >
                Sign out
              </button>
            </form>
          </nav>
        ) : (
          <nav aria-label="Account" className="mb-8 flex justify-end gap-2 text-sm">
            <a
              href="/auth/signin"
              className="rounded-lg px-3 py-1.5 font-medium text-slate-300 transition hover:text-white focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
            >
              Sign in
            </a>
            <a
              href="/auth/signup"
              className="rounded-lg bg-amber-400/15 px-3 py-1.5 font-medium text-amber-200 transition hover:bg-amber-400/25 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
            >
              Sign up
            </a>
          </nav>
        )}
        <header>
          <p className="flex items-center gap-2 font-mono text-xs tracking-[0.35em] text-amber-300/80 uppercase">
            <Compass className="size-3.5" aria-hidden />
            10xLearn · Field Map
          </p>
          <h1 id="worldmap-heading" className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            Your expedition
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
            Light the trail one zone at a time. Read the briefing, clear its gate, and the next zone lifts out of the
            fog.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 font-mono text-xs tracking-widest text-amber-200 uppercase">
              <Lightbulb className="size-3.5" aria-hidden />
              {litCount} / {total} zones lit
            </p>
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 font-mono text-xs tracking-widest text-amber-200 uppercase">
              <Zap className="size-3.5" aria-hidden />
              {xp} XP
            </p>
          </div>
        </header>

        {/* The trail: a single spine runs the full height; stations sit to either side. */}
        <div className="relative mt-14">
          <div
            aria-hidden
            className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-amber-300/50 via-amber-400/15 to-slate-600/10"
          />

          <div className="space-y-12">
            {zones.map((zone, zoneIndex) => (
              <section key={zone.slug} aria-labelledby={`zone-${zone.slug}-heading`} className="relative">
                {/* Trailhead sign, centered on the spine. */}
                <div className="relative z-10 flex justify-center">
                  <div
                    className={cn(
                      "flex flex-col items-center rounded-2xl border px-5 py-3 text-center",
                      zone.locked
                        ? "border-slate-700 bg-slate-900/90 text-slate-400"
                        : "border-amber-400/40 bg-slate-900/90 text-slate-100",
                    )}
                  >
                    <span className="font-mono text-[10px] tracking-[0.3em] text-slate-500 uppercase">
                      Zone {String(zoneIndex + 1).padStart(2, "0")}
                    </span>
                    <h2 id={`zone-${zone.slug}-heading`} className="mt-1 text-lg font-bold">
                      {zone.title}
                    </h2>
                    <span
                      className={cn(
                        "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        zone.locked ? "bg-slate-800 text-slate-400" : "bg-amber-400/15 text-amber-200",
                      )}
                    >
                      {zone.locked ? (
                        <>
                          <Lock className="size-3" aria-hidden />
                          Locked
                        </>
                      ) : (
                        <>
                          <Lightbulb className="size-3" aria-hidden />
                          Lit
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <ol className="mt-8 space-y-10">
                  {zone.checkpoints.map((checkpoint, checkpointIndex) => {
                    const side = (zoneIndex * 2 + checkpointIndex) % 2 === 0 ? "left" : "right";
                    const isCurrent = zone.slug === frontierSlug && checkpoint.type === "lesson";
                    const Icon = zone.locked ? Lock : CHECKPOINT_ICON[checkpoint.type];

                    const card = (
                      <div className="relative">
                        {isCurrent && (
                          <div
                            aria-hidden
                            className="absolute -top-11 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
                          >
                            <span className="text-2xl [animation-duration:2.2s] motion-safe:animate-bounce">🧗</span>
                            <span className="mt-0.5 rounded-full bg-amber-300 px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider whitespace-nowrap text-slate-950 uppercase">
                              You are here
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={zone.locked}
                          aria-disabled={zone.locked}
                          onClick={
                            zone.locked
                              ? undefined
                              : () => (checkpoint.type === "lesson" ? openLesson(zone.slug) : openQuiz(zone.slug))
                          }
                          aria-label={`${zone.title} ${checkpoint.type} checkpoint${zone.locked ? " (locked)" : ""}${
                            isCurrent ? ", your position" : ""
                          }`}
                          className={cn(
                            "group flex w-full max-w-[15rem] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                            "focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none",
                            zone.locked
                              ? "cursor-not-allowed border-dashed border-slate-700 bg-slate-900/50 text-slate-500"
                              : "border-slate-700/70 bg-slate-900/70 hover:border-amber-400/60 hover:bg-slate-800/80",
                            isCurrent && "border-amber-300/70 ring-1 ring-amber-300/40",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-11 shrink-0 place-items-center rounded-full ring-1",
                              zone.locked
                                ? "bg-slate-800/60 text-slate-500 ring-slate-700"
                                : checkpoint.type === "lesson"
                                  ? "bg-amber-400/15 text-amber-300 ring-amber-400/40"
                                  : "bg-sky-400/15 text-sky-300 ring-sky-400/40",
                            )}
                          >
                            <Icon className="size-5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-mono text-[10px] tracking-widest text-slate-400 uppercase">
                              {checkpoint.type}
                            </span>
                            <span className="block truncate text-sm font-semibold">{checkpoint.title}</span>
                          </span>
                        </button>
                      </div>
                    );

                    return (
                      <li key={checkpoint.type} className="relative flex items-center">
                        <div className="flex flex-1 justify-end pr-6">
                          {side === "left" && (
                            <>
                              <span
                                aria-hidden
                                className={cn(
                                  "absolute top-1/2 right-1/2 h-px w-6 -translate-y-1/2 border-t border-dashed",
                                  zone.locked ? "border-slate-700" : "border-amber-400/40",
                                )}
                              />
                              {card}
                            </>
                          )}
                        </div>
                        <span
                          aria-hidden
                          className={cn(
                            "relative z-10 size-3 shrink-0 rounded-full ring-4 ring-slate-950",
                            zone.locked ? "bg-slate-600" : "bg-amber-300",
                            isCurrent && "bg-amber-200 motion-safe:animate-pulse",
                          )}
                        />
                        <div className="flex flex-1 justify-start pl-6">
                          {side === "right" && (
                            <>
                              <span
                                aria-hidden
                                className={cn(
                                  "absolute top-1/2 left-1/2 h-px w-6 -translate-y-1/2 border-t border-dashed",
                                  zone.locked ? "border-slate-700" : "border-amber-400/40",
                                )}
                              />
                              {card}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </div>
      </div>

      {!isAuthenticated && showNudge && (
        <div
          role="region"
          aria-label="Save your progress"
          className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-amber-400/40 bg-slate-900/95 px-4 py-3 shadow-lg backdrop-blur"
        >
          <Lightbulb className="size-5 shrink-0 text-amber-300" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-slate-200">
            Nice — you lit a new zone.{" "}
            <a
              href="/auth/signup"
              className="font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
            >
              Sign up to save your progress
            </a>{" "}
            so it&rsquo;s here next time.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowNudge(false);
            }}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-slate-400 transition hover:text-white focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </main>
  );
}
