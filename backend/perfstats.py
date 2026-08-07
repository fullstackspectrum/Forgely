"""Request instrumentation for Forgely performance baselining.

Tier 0 of docs/performance-design.md. Every downstream optimisation branch is
validated against numbers this module produces, so it is deliberately
self-contained: deleting this file and its call sites removes instrumentation
entirely without touching any data path.

Counters live on the `requests.Session`. Each graph build already constructs
its own session via `cloudsmith.create_session`, so per-build attribution is
free and no global state is involved.
"""

from __future__ import annotations

import os
import threading
import time

# Endpoint families we care about. The vulnerability scan list and the
# vulnerability *detail* fetch are bucketed separately on purpose — the ratio
# between them is exactly what perf/03-short-circuit-scan-details targets.
BUCKET_UNKNOWN = "other"


def bucket_for(url: str) -> str:
    """Classify a Cloudsmith URL into an endpoint family."""
    path = url.split("/v1/", 1)[-1].strip("/")
    parts = [p for p in path.split("/") if p]
    if not parts:
        return BUCKET_UNKNOWN

    head, rest = parts[0], parts[1:]
    n = len(rest)

    if head == "packages":
        if n >= 4 and rest[3] == "dependencies":
            return "packages.dependencies"
        return "packages.list"

    if head == "vulnerabilities":
        # /{owner}/{repo}/{slug}/          -> scan list
        # /{owner}/{repo}/{slug}/{scan_id} -> scan detail
        return "vulns.details" if n >= 4 else "vulns.scans"

    if head == "repos":
        if n >= 3 and rest[2] == "privileges":
            return "repos.privileges"
        if n >= 3 and rest[2] == "upstream":
            return "repos.upstream"
        return "repos.list"

    if head == "orgs":
        if n >= 4 and rest[1] == "teams" and rest[3] == "members":
            return "orgs.team_members"
        if n >= 2:
            return f"orgs.{rest[1]}"
        return "orgs.other"

    if head in ("entitlements", "namespaces", "user"):
        return head

    return BUCKET_UNKNOWN


class RequestStats:
    """Thread-safe per-build request counters.

    Mutated from up to 20 worker threads during a graph build, so every
    mutation takes the lock. Contention is negligible relative to the network
    call each increment accompanies.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.calls: dict[str, int] = {}
        self.seconds: dict[str, float] = {}
        self.statuses: dict[str, dict[int, int]] = {}
        self.rate_limited = 0
        self.throttle_seconds = 0.0
        self.retries = 0
        self.failures = 0
        # Last-seen rate-limit headers. Answers open question #2 in the design
        # doc: whether Tier 4 (async client) has any value, or whether we are
        # limit-bound rather than concurrency-bound.
        self.rl_limit: str | None = None
        self.rl_remaining: str | None = None
        self.rl_reset: str | None = None
        # Which package formats actually return dependency data. Feeds the
        # DEPENDENCY_FORMATS constant in perf/02-gate-dependency-fetch.
        self.dep_formats: dict[str, dict[str, int]] = {}

    def record_call(self, bucket: str, elapsed: float, status: int) -> None:
        with self._lock:
            self.calls[bucket] = self.calls.get(bucket, 0) + 1
            self.seconds[bucket] = self.seconds.get(bucket, 0.0) + elapsed
            by_status = self.statuses.setdefault(bucket, {})
            by_status[status] = by_status.get(status, 0) + 1

    def record_throttle(self, seconds: float) -> None:
        with self._lock:
            self.rate_limited += 1
            self.throttle_seconds += seconds

    def record_retry(self) -> None:
        with self._lock:
            self.retries += 1

    def record_failure(self) -> None:
        with self._lock:
            self.failures += 1

    def record_rate_limit_headers(self, headers) -> None:
        limit = headers.get("X-RateLimit-Limit")
        remaining = headers.get("X-RateLimit-Remaining")
        reset = headers.get("X-RateLimit-Reset")
        if limit is None and remaining is None and reset is None:
            return
        with self._lock:
            if limit is not None:
                self.rl_limit = limit
            if remaining is not None:
                self.rl_remaining = remaining
            if reset is not None:
                self.rl_reset = reset

    def record_dependency_result(self, fmt: str, non_empty: bool) -> None:
        """Track which formats return dependency data (input to perf/02)."""
        key = (fmt or "unknown").lower()
        with self._lock:
            entry = self.dep_formats.setdefault(key, {"calls": 0, "nonempty": 0})
            entry["calls"] += 1
            if non_empty:
                entry["nonempty"] += 1

    def total_calls(self) -> int:
        with self._lock:
            return sum(self.calls.values())

    def snapshot(self) -> dict:
        """Immutable view suitable for logging or JSON serialisation."""
        with self._lock:
            buckets = {
                name: {
                    "calls": count,
                    "seconds": round(self.seconds.get(name, 0.0), 2),
                    "mean_ms": round((self.seconds.get(name, 0.0) / count) * 1000, 1) if count else 0.0,
                    "statuses": dict(self.statuses.get(name, {})),
                }
                for name, count in sorted(self.calls.items(), key=lambda kv: -kv[1])
            }
            return {
                "total_calls": sum(self.calls.values()),
                "buckets": buckets,
                "rate_limited": self.rate_limited,
                "throttle_seconds": round(self.throttle_seconds, 2),
                "retries": self.retries,
                "failures": self.failures,
                "rate_limit_headers": {
                    "limit": self.rl_limit,
                    "remaining": self.rl_remaining,
                    "reset": self.rl_reset,
                },
                "dependency_formats": dict(sorted(self.dep_formats.items())),
            }


def get_stats(session) -> RequestStats | None:
    """Return the stats object bound to a session, if instrumentation is on."""
    return getattr(session, "forgely_stats", None)


def payload_bytes_enabled() -> bool:
    """Measuring payload size costs an extra full serialisation.

    Off by default so the stats line is cheap; enable it for the baseline runs
    that populate the measurements table in the design doc.
    """
    return os.getenv("FORGELY_PERF_PAYLOAD", "").lower() in ("1", "true", "yes")


def format_report(label: str, stats: RequestStats, wall_seconds: float, extra: dict | None = None) -> str:
    """Render a single multi-line log record for one build."""
    snap = stats.snapshot()
    extra = extra or {}

    lines = [
        f"PERF {label} — {wall_seconds:.1f}s wall, {snap['total_calls']} API calls"
    ]

    headline = ", ".join(f"{k}={v}" for k, v in extra.items() if v is not None)
    if headline:
        lines.append(f"  result:    {headline}")

    lines.append(
        f"  throttle:  {snap['rate_limited']} x 429, "
        f"{snap['throttle_seconds']}s slept, "
        f"{snap['retries']} retries, {snap['failures']} failures"
    )

    rl = snap["rate_limit_headers"]
    if any(rl.values()):
        lines.append(
            f"  ratelimit: limit={rl['limit']} remaining={rl['remaining']} reset={rl['reset']}"
        )

    if snap["buckets"]:
        lines.append(f"  {'endpoint':<24} {'calls':>7} {'mean':>9} {'total':>8}  statuses")
        for name, b in snap["buckets"].items():
            statuses = " ".join(f"{code}:{n}" for code, n in sorted(b["statuses"].items()))
            lines.append(
                f"  {name:<24} {b['calls']:>7} {b['mean_ms']:>8.0f}ms {b['seconds']:>7.1f}s  {statuses}"
            )

    deps = snap["dependency_formats"]
    if deps:
        useful = [f for f, v in deps.items() if v["nonempty"]]
        wasted = sum(v["calls"] for f, v in deps.items() if not v["nonempty"])
        lines.append(
            f"  deps:      {wasted} calls returned nothing; "
            f"formats with data: {', '.join(sorted(useful)) or 'none'}"
        )
        for fmt, v in deps.items():
            lines.append(f"    {fmt:<20} {v['calls']:>6} calls  {v['nonempty']:>6} non-empty")

    return "\n".join(lines)


class BuildTimer:
    """Wall-clock timer for one build.

    Usable either as a context manager or via start()/stop(), since some build
    functions have early returns that make a `with` block awkward.
    """

    def __init__(self) -> None:
        self._start = time.perf_counter()
        self.elapsed = 0.0

    def start(self) -> BuildTimer:
        self._start = time.perf_counter()
        return self

    def stop(self) -> float:
        self.elapsed = time.perf_counter() - self._start
        return self.elapsed

    def __enter__(self) -> BuildTimer:
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()
