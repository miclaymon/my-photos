"""
ASGI middleware that works around a CachyOS 6.19 kernel bug where a single
TCP send() of ≥ ~4050 bytes on the loopback interface silently drops all data.

Symptoms: requests to localhost that return > ~4KB hang indefinitely.
Confirmed: raw blocking-socket tests show the exact same behaviour, ruling out
Python asyncio, uvicorn, and granian as the cause.

Fix: buffer each JSON response body and re-send it in ≤ 3 KB chunks with a
1 ms asyncio yield between each write.  The yield gives the kernel's loopback
softirq time to deliver the previous chunk before the next one arrives.
Overhead: ~1 ms per 3 KB of response (negligible in a local dev environment).
"""

import asyncio
from typing import Any

CHUNK_SIZE = 3000          # bytes per TCP write — stay well under the ~4050 limit
CHUNK_DELAY = 0.001        # seconds between writes (1 ms is the minimum that works)
MAX_BUFFER_SIZE = 10 << 20  # 10 MB — don't buffer huge responses (file downloads)


class LoopbackChunkMiddleware:
    """
    Buffer application/json responses and re-stream them in small chunks so
    that no single TCP write exceeds the loopback kernel bug threshold.

    Pass-through for:
      - Non-HTTP scopes (WebSocket, lifespan)
      - Non-JSON content types (file downloads, HTML, etc.)
      - Responses whose body exceeds MAX_BUFFER_SIZE
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start_message: dict | None = None
        body_parts: list[bytes] = []
        is_json = False
        overflow = False          # body exceeded MAX_BUFFER_SIZE → pass through

        async def capture(message: dict) -> None:
            nonlocal start_message, is_json, overflow

            if message["type"] == "http.response.start":
                start_message = message
                # Determine content type from response headers
                for name, value in message.get("headers", []):
                    if name.lower() == b"content-type":
                        is_json = b"application/json" in value
                        break
                # If not JSON, forward immediately
                if not is_json:
                    await send(message)
                return

            if message["type"] == "http.response.body":
                if not is_json or overflow:
                    # Pass-through mode (non-JSON or too large)
                    await send(message)
                    return

                chunk = message.get("body", b"")
                body_parts.append(chunk)
                total = sum(len(p) for p in body_parts)

                if total > MAX_BUFFER_SIZE:
                    # Response too large to buffer — fall back to pass-through
                    overflow = True
                    await send(start_message)  # type: ignore[arg-type]
                    for part in body_parts:
                        await send({"type": "http.response.body", "body": part, "more_body": True})
                    body_parts.clear()
                    return

                more_body = message.get("more_body", False)
                if more_body:
                    return  # keep accumulating

                # All body received — send headers then stream in chunks
                full_body = b"".join(body_parts)
                body_parts.clear()

                await send(start_message)  # type: ignore[arg-type]

                if len(full_body) <= CHUNK_SIZE:
                    # Small enough to send in one shot
                    await send({"type": "http.response.body", "body": full_body, "more_body": False})
                    return

                # Stream in CHUNK_SIZE chunks with a delay between each
                offset = 0
                while offset < len(full_body):
                    end = min(offset + CHUNK_SIZE, len(full_body))
                    is_last = end == len(full_body)
                    await send({
                        "type": "http.response.body",
                        "body": full_body[offset:end],
                        "more_body": not is_last,
                    })
                    if not is_last:
                        await asyncio.sleep(CHUNK_DELAY)
                    offset = end

        await self.app(scope, receive, capture)
