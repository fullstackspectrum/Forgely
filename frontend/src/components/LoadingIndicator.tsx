import { useEffect, useState } from "react";
import type { GraphProgress } from "../hooks/useGraphData";

const PACKAGE_STAGES = [
  { label: "Fetching packages", icon: "📦" },
  { label: "Scanning vulnerabilities", icon: "🛡" },
  { label: "Resolving dependencies", icon: "🔀" },
  { label: "Building graph", icon: "📊" },
];

const WORKSPACE_STAGES = [
  { label: "Fetching repositories", icon: "📂" },
  { label: "Loading members & services", icon: "👥" },
  { label: "Resolving privileges & entitlements", icon: "🔐" },
  { label: "Discovering upstreams", icon: "🔗" },
  { label: "Building workspace graph", icon: "📊" },
];

const WORKSPACE_OVERVIEW_STAGES = [
  { label: "Fetching repositories", icon: "📂" },
  { label: "Scanning packages", icon: "📦" },
  { label: "Analysing vulnerabilities", icon: "🛡" },
  { label: "Building overview", icon: "📊" },
];

/* Backend phase names from /api/graph/stream, mapped onto PACKAGE_STAGES.
   "cached" and the post-dependencies assembly both land on the final stage,
   which has no countable work and so renders indeterminate. */
const PHASE_STAGE: Record<string, number> = {
  packages: 0,
  scanning: 1,
  dependencies: 2,
  cached: 3,
};

const WORKSPACE_OVERVIEW_PATIENCE = [
  "Counting packages across your entire workspace…",
  "Some of these repos have a lot to answer for.",
  "Scanning for CVEs. Finding some. Finding more.",
  "Your workspace is extensive. Respect.",
  "Still going. There are a lot of packages.",
  "Correlating vulnerabilities across repos…",
  "Building a picture of your supply chain health…",
  "The more repos, the more interesting this gets.",
  "Cross-referencing CVEs. This takes a moment.",
  "Almost there. Probably.",
];

const PATIENCE_MESSAGES = [
  "Untangling the dependency spaghetti…",
  "Consulting the ghost of Log4Shell…",
  "Mapping the blast radius of questionable npm installs…",
  "Negotiating with circular dependencies…",
  "Your supply chain is… extensive.",
  "Still running. This is fine. 🔥",
  "Counting transitive vulnerabilities. There are a lot.",
  "Have you tried turning your dependencies off and on again?",
  "Teaching nodes to behave themselves…",
  "Asking your packages nicely to form a circle…",
  "Making it look like we're doing science…",
  "Your graph is impressively large. We'll give you that.",
  "Querying the void for package metadata…",
  "Maybe fewer dependencies next time? Just a thought.",
  "Calculating exactly how many CVEs you should probably care about…",
  "Finding out which commit started all this…",
  "The graph is big. The graph is bold. The graph is almost ready.",
  "We've seen worse. (We haven't.)",
];

interface Props {
  variant?: "packages" | "workspace" | "workspace-overview";
  /** Live phase from the graph stream. Only the "packages" variant has one. */
  progress?: GraphProgress | null;
}

export default function LoadingIndicator({ variant = "packages", progress }: Props) {
  const STAGES =
    variant === "workspace" ? WORKSPACE_STAGES :
    variant === "workspace-overview" ? WORKSPACE_OVERVIEW_STAGES :
    PACKAGE_STAGES;

  const MESSAGES =
    variant === "workspace-overview" ? WORKSPACE_OVERVIEW_PATIENCE : PATIENCE_MESSAGES;

  /* Only the packages graph streams progress. The other two variants have no
     equivalent endpoint yet, so they keep advancing on a timer. */
  const streamed = variant === "packages";

  const [timerStage, setTimerStage] = useState(0);
  const [reachedStage, setReachedStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [funnyIdx, setFunnyIdx] = useState(-1);

  /* A phase is complete when done === total; the work that follows the last
     phase (assembling the graph) reports nothing, so treat it as the final
     stage rather than leaving "Resolving dependencies" stuck at 100%. */
  const phaseStage = progress ? PHASE_STAGE[progress.phase] ?? 0 : 0;
  const phaseDone =
    !!progress && progress.total > 0 && progress.done >= progress.total;
  const liveStage = Math.min(
    STAGES.length - 1,
    phaseDone && phaseStage === 2 ? 3 : phaseStage,
  );

  /* Phases arrive in order, but pin the high-water mark anyway so a stage
     already ticked off can never un-tick.

     Adjusted during render rather than in an effect — React's documented
     pattern for deriving state from changed props. An effect would settle a
     render late, leaving one frame where the new phase's counts sit under the
     previous phase's label and the bar drops to indeterminate. */
  if (streamed && liveStage > reachedStage) setReachedStage(liveStage);

  const stage = streamed ? Math.max(reachedStage, liveStage) : timerStage;

  /* Timer-driven variants only: advance stages on a schedule. */
  useEffect(() => {
    if (streamed) return;
    const delays = [1200, 2500, 3000, 2000];
    if (timerStage >= STAGES.length - 1) return;
    const t = setTimeout(() => setTimerStage((s) => s + 1), delays[timerStage] ?? 2000);
    return () => clearTimeout(t);
  }, [streamed, timerStage, STAGES.length]);

  /* Elapsed timer */
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* Patience messages. With real progress the final stage is reached in
     seconds, so hold them back until the build is genuinely slow. */
  useEffect(() => {
    if (funnyIdx >= 0) return;
    const ready = streamed ? elapsed >= 20 : stage >= STAGES.length - 1;
    if (!ready) return;
    const t = setTimeout(() => setFunnyIdx(0), streamed ? 0 : 4000);
    return () => clearTimeout(t);
  }, [streamed, elapsed, stage, STAGES.length, funnyIdx]);

  useEffect(() => {
    if (funnyIdx < 0) return;
    const t = setTimeout(
      () => setFunnyIdx((i) => (i + 1) % MESSAGES.length),
      3500,
    );
    return () => clearTimeout(t);
  }, [funnyIdx]);

  /* Countable only while a phase is reporting real totals. */
  const counting =
    streamed && !!progress && progress.total > 0 && stage < STAGES.length - 1;
  const pct = counting
    ? Math.min(100, Math.round((progress!.done / progress!.total) * 100))
    : 0;

  return (
    <div className="loading-indicator">
      {/* The branded loader, not the logo on a pulse keyframe. Its ripple
          propagates outward from the ember cell, which is the point — motion
          away from the origin is what blast radius means (BRANDING.md §5).
          The animation is CSS inside the SVG, so it runs in an <img> with
          nothing to import, and the file freezes itself into the static mark
          under prefers-reduced-motion.

          §7 restricts this to graph-shaped work over a second, which a build
          is: 19s cold, and the phase list below is showing real progress
          throughout. A plain spinner belongs anywhere shorter. */}
      <img
        src="/forgely-loader-reversed.svg"
        alt=""
        className="loading-loader"
        width={96}
        height={96}
      />

      <div className="loading-stages">
        {STAGES.map((s, i) => (
          <div
            key={i}
            className={`loading-stage${i < stage ? " done" : i === stage ? " active" : ""}`}
          >
            <span className="loading-stage-icon">
              {i < stage ? "✓" : s.icon}
            </span>
            <span className="loading-stage-label">{s.label}</span>
            {i === stage && !counting && <span className="loading-stage-dots" />}
            {i === stage && counting && (
              <span className="loading-stage-count">
                {progress!.done.toLocaleString()} / {progress!.total.toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>

      {streamed && (
        <div
          className="loading-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={counting ? pct : undefined}
          aria-label={STAGES[stage]?.label}
        >
          <div className={`loading-progress-track${counting ? "" : " indeterminate"}`}>
            <div
              className="loading-progress-fill"
              style={counting ? { width: `${pct}%` } : undefined}
            />
          </div>
          <div className="loading-progress-pct">{counting ? `${pct}%` : " "}</div>
        </div>
      )}

      <div className="loading-elapsed">{elapsed}s elapsed</div>

      {funnyIdx >= 0 && (
        <div key={funnyIdx} className="loading-funny">
          {MESSAGES[funnyIdx]}
        </div>
      )}
    </div>
  );
}
