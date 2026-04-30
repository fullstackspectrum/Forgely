import { useEffect, useState } from "react";

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
  variant?: "packages" | "workspace";
}

export default function LoadingIndicator({ variant = "packages" }: Props) {
  const STAGES = variant === "workspace" ? WORKSPACE_STAGES : PACKAGE_STAGES;
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [funnyIdx, setFunnyIdx] = useState(-1);

  /* Advance stages on a timer to show progress */
  useEffect(() => {
    const delays = [1200, 2500, 3000, 2000];
    if (stage >= STAGES.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), delays[stage] ?? 2000);
    return () => clearTimeout(t);
  }, [stage, STAGES.length]);

  /* Elapsed timer */
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* Start cycling patience messages after 4 s on the final stage */
  useEffect(() => {
    if (stage < STAGES.length - 1) return;
    const t = setTimeout(() => setFunnyIdx(0), 4000);
    return () => clearTimeout(t);
  }, [stage, STAGES.length]);

  useEffect(() => {
    if (funnyIdx < 0) return;
    const t = setTimeout(
      () => setFunnyIdx((i) => (i + 1) % PATIENCE_MESSAGES.length),
      3500,
    );
    return () => clearTimeout(t);
  }, [funnyIdx]);

  return (
    <div className="loading-indicator">
      <div className="loading-logo-pulse">
        <img src="/forgely-logo.png" alt="" className="loading-logo-img" />
      </div>

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
            {i === stage && <span className="loading-stage-dots" />}
          </div>
        ))}
      </div>

      <div className="loading-elapsed">{elapsed}s elapsed</div>

      {funnyIdx >= 0 && (
        <div key={funnyIdx} className="loading-funny">
          {PATIENCE_MESSAGES[funnyIdx]}
        </div>
      )}
    </div>
  );
}
