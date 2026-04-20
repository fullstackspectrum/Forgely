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

interface Props {
  variant?: "packages" | "workspace";
}

export default function LoadingIndicator({ variant = "packages" }: Props) {
  const STAGES = variant === "workspace" ? WORKSPACE_STAGES : PACKAGE_STAGES;
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  /* Advance stages on a timer to show progress */
  useEffect(() => {
    const delays = [1200, 2500, 3000, 2000];
    if (stage >= STAGES.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), delays[stage] ?? 2000);
    return () => clearTimeout(t);
  }, [stage]);

  /* Elapsed timer */
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

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

      <div className="loading-elapsed">
        {elapsed}s elapsed
      </div>
    </div>
  );
}
