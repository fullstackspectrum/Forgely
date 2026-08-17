"""Gzip compression that does not defeat the NDJSON progress stream.

Starlette's GZipResponder compresses streaming chunks with a bare
`compressor.compress(body)` and only flushes when the response ends. zlib
buffers until it has a full deflate block, so small chunks produce no output at
all: feeding it the 105 progress frames of a real build emits 10 bytes — the
gzip header — and nothing else. Every frame stays in the compressor until the
build finishes, which is precisely the wait /api/graph/stream exists to remove.

Z_SYNC_FLUSH after each chunk terminates the current block and aligns the
output to a byte boundary, so whatever has been written so far is decodable by
the client immediately. The same 105 frames then emit 1,232 bytes as they are
produced.

The cost is a few bytes per flush and slightly worse ratios across chunk
boundaries. That matters only for many small chunks, which is exactly the case
where latency matters more than size — the large terminal graph frame arrives
as one chunk and is flushed once.
"""

from __future__ import annotations

import zlib

from starlette.middleware.gzip import GZipMiddleware, GZipResponder


class _FlushingGZipResponder(GZipResponder):
    """GZipResponder that makes each streamed chunk immediately decodable."""

    def _compress_body(self, body: bytes, more_body: bool) -> bytes:
        if more_body:
            return self.compressor.compress(body) + self.compressor.flush(zlib.Z_SYNC_FLUSH)
        return self.compressor.compress(body) + self.compressor.flush()


class StreamingGZipMiddleware(GZipMiddleware):
    """GZipMiddleware whose streaming responses stay streaming.

    Subclasses rather than reimplements so content negotiation, minimum_size
    handling and header rewriting stay with Starlette. The behaviour this
    changes is covered by a test that asserts frames arrive incrementally — if
    a Starlette upgrade moves this logic, that test fails rather than the
    stream silently reverting to buffered.
    """

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[no-untyped-def]
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        from starlette.datastructures import Headers

        if "gzip" in Headers(scope=scope).get("Accept-Encoding", ""):
            responder = _FlushingGZipResponder(
                self.app,
                self.minimum_size,
                compresslevel=self.compresslevel,
                thread_minimum_size=self.thread_minimum_size,
            )
            await responder(scope, receive, send)
            return

        await super().__call__(scope, receive, send)
