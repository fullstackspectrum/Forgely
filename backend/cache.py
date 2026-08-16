"""Persistent scan-result cache for the Forgely backend.

perf/05 of docs/performance-design.md.

WHAT IS CACHED, AND WHY IT IS SAFE
----------------------------------
Vulnerability scan results, keyed on the package's ``security_scan_completed_at``
timestamp. A completed scan is immutable — its findings never change — so an
entry keyed on the completion time can be kept indefinitely without a TTL.
Invalidation is automatic rather than time-based: when Cloudsmith re-scans a
package the timestamp moves, the key changes, and the old entry is simply never
read again.

Crucially that timestamp arrives on the *package list* response, which the build
already fetches. So a warm build can skip the per-package scan call entirely,
rather than having to make it in order to discover whether it was needed.

The design doc originally proposed keying on the scan identifier. That cannot
work: the identifier is only obtainable from the very call we are trying to
avoid, so it could only ever elide the detail fetch — which perf/03 already
reduced to a couple of dozen calls.

STORAGE
-------
SQLite via the stdlib, in WAL mode. No new dependency. One connection shared
across the build's worker threads, guarded by a lock: writes are small and
infrequent relative to the network call each one follows.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import sqlite3
import threading
import time

log = logging.getLogger("forgely.cache")

CACHE_PATH_ENV = "FORGELY_CACHE_PATH"
CACHE_DISABLE_ENV = "FORGELY_DISABLE_CACHE"
SCHEMA_VERSION = 1


def default_cache_path() -> pathlib.Path:
    """Where the cache lives unless FORGELY_CACHE_PATH overrides it.

    Read lazily, never at import: ``main`` imports this module before it calls
    ``load_dotenv()``, so a module-level getenv would miss a value set in .env.
    """
    override = os.getenv(CACHE_PATH_ENV)
    if override:
        return pathlib.Path(override).expanduser()
    return pathlib.Path(__file__).parent / ".cache" / "scans.db"


def cache_enabled() -> bool:
    """False when FORGELY_DISABLE_CACHE is set — the escape hatch."""
    return os.getenv(CACHE_DISABLE_ENV, "").strip().lower() not in ("1", "true", "yes")


class ScanCache:
    """Immutable scan results keyed on (owner, repo, slug, completed_at)."""

    def __init__(self, path: pathlib.Path | None = None) -> None:
        self.path = path or default_cache_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS scans (
                   key        TEXT PRIMARY KEY,
                   payload    TEXT NOT NULL,
                   written_at REAL NOT NULL,
                   version    INTEGER NOT NULL
               )"""
        )
        self._conn.commit()
        self.hits = 0
        self.misses = 0
        self.writes = 0
        self.skipped = 0  # entries we declined to key (no completion timestamp)

    # -- keying ----------------------------------------------------------
    @staticmethod
    def key(owner: str, repo: str, slug: str, completed_at: str) -> str:
        return f"{owner}/{repo}/{slug}@{completed_at}"

    # -- reads / writes --------------------------------------------------
    def get(self, owner: str, repo: str, slug: str, completed_at: str | None):
        """Return the cached (max_sev, vuln_count, vulns) tuple, or None.

        A package with no completion timestamp is never cached — without it
        there is no way to tell a stale entry from a fresh one, and guessing
        would risk serving a superseded scan result.
        """
        if not completed_at:
            with self._lock:
                self.skipped += 1
            return None
        k = self.key(owner, repo, slug, completed_at)
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM scans WHERE key = ? AND version = ?",
                (k, SCHEMA_VERSION),
            ).fetchone()
            if row is None:
                self.misses += 1
                return None
            self.hits += 1
        try:
            max_sev, vuln_count, vulns = json.loads(row[0])
        except (ValueError, TypeError):
            return None
        return max_sev, vuln_count, vulns

    def put(self, owner: str, repo: str, slug: str, completed_at: str | None, result) -> None:
        if not completed_at:
            return
        k = self.key(owner, repo, slug, completed_at)
        payload = json.dumps(result)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO scans (key, payload, written_at, version) VALUES (?,?,?,?)",
                (k, payload, time.time(), SCHEMA_VERSION),
            )
            self.writes += 1

    def commit(self) -> None:
        """Flush pending writes. Called once at the end of a build."""
        with self._lock:
            self._conn.commit()

    # -- housekeeping ----------------------------------------------------
    def prune(self, max_age_days: float = 90) -> int:
        """Drop entries not written within *max_age_days*.

        Superseded keys are never read again but would otherwise accumulate,
        since nothing deletes them when a package is re-scanned.
        """
        cutoff = time.time() - max_age_days * 86400
        with self._lock:
            cur = self._conn.execute("DELETE FROM scans WHERE written_at < ?", (cutoff,))
            self._conn.commit()
            return cur.rowcount

    def entry_count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM scans").fetchone()[0]

    def size_bytes(self) -> int:
        try:
            return self.path.stat().st_size
        except OSError:
            return 0

    def stats(self) -> dict:
        with self._lock:
            looked_up = self.hits + self.misses
            return {
                "hits": self.hits,
                "misses": self.misses,
                "writes": self.writes,
                "unkeyable": self.skipped,
                "hit_rate": round(100 * self.hits / looked_up, 1) if looked_up else 0.0,
            }

    def close(self) -> None:
        with self._lock:
            self._conn.commit()
            self._conn.close()
