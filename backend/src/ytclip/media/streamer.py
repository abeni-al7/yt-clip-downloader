"""ffmpeg subprocess → async chunks (research R6). ffmpeg is killed whenever the consumer stops."""

import asyncio
import contextlib
import logging
import time
import weakref
from collections import deque
from collections.abc import AsyncIterator
from typing import ClassVar

log = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024
TERMINATE_GRACE_S = 5.0
STDERR_TAIL_BYTES = 4096


class ProcessingFailed(Exception):
    def __init__(self, stderr_tail: str, returncode: int | None) -> None:
        self.stderr_tail = stderr_tail
        self.returncode = returncode
        super().__init__(f"ffmpeg exited with {returncode} before producing output")


class FfmpegStream:
    # Lets tests assert that every process has been reaped; WeakSet so finished streams vanish.
    instances: ClassVar[weakref.WeakSet["FfmpegStream"]] = weakref.WeakSet()

    def __init__(self, argv: list[str]) -> None:
        self.argv = argv
        self.process: asyncio.subprocess.Process | None = None
        self.bytes_sent = 0
        self.started_at = time.monotonic()
        self.reached_eof = False
        self._first_chunk: bytes | None = None
        self._stderr_chunks: deque[bytes] = deque(maxlen=8)
        self._stderr_task: asyncio.Task[None] | None = None
        self._closed = False
        FfmpegStream.instances.add(self)

    @property
    def returncode(self) -> int | None:
        return self.process.returncode if self.process is not None else None

    @property
    def stderr_tail(self) -> str:
        return b"".join(self._stderr_chunks)[-STDERR_TAIL_BYTES:].decode("utf-8", "replace")

    async def start(self) -> None:
        """Spawn ffmpeg and wait for its first chunk so early failures still get a status code."""
        self.process = await asyncio.create_subprocess_exec(
            *self.argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=CHUNK_SIZE * 4,
        )
        self._stderr_task = asyncio.create_task(self._drain_stderr())
        assert self.process.stdout is not None
        first = await self.process.stdout.read(CHUNK_SIZE)
        if not first:
            await self.process.wait()
            await self._stderr_task
            self._closed = True
            raise ProcessingFailed(self.stderr_tail, self.process.returncode)
        self._first_chunk = first

    async def chunks(self) -> AsyncIterator[bytes]:
        assert self.process is not None and self.process.stdout is not None
        assert self._first_chunk is not None, "call start() first"
        try:
            self.bytes_sent += len(self._first_chunk)
            yield self._first_chunk
            while True:
                chunk = await self.process.stdout.read(CHUNK_SIZE)
                if not chunk:
                    break
                self.bytes_sent += len(chunk)
                yield chunk
            self.reached_eof = True
            returncode = await self.process.wait()
            if returncode != 0:
                log.warning(
                    "ffmpeg exited with %s after %d bytes: %s",
                    returncode,
                    self.bytes_sent,
                    self.stderr_tail,
                )
        finally:
            await self.close()

    async def close(self) -> None:
        """Idempotent: terminate, kill after a grace period, then reap.

        asyncio's ``Process.wait()`` only completes once every pipe has hit EOF, and a paused
        stdout reader (consumer gone, buffer full) never sees EOF — so stdout is drained here.
        """
        if self._closed:
            return
        self._closed = True
        process = self.process
        if process is None:
            return
        drain = asyncio.create_task(self._drain_stdout())
        try:
            if process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), TERMINATE_GRACE_S)
                except TimeoutError:
                    with contextlib.suppress(ProcessLookupError):
                        process.kill()
                    await asyncio.wait_for(process.wait(), TERMINATE_GRACE_S)
            else:
                await asyncio.wait_for(process.wait(), TERMINATE_GRACE_S)
        except TimeoutError:
            log.error("ffmpeg did not exit after SIGKILL; leaving it to the OS")
        finally:
            await self._finish_task(drain)
            if self._stderr_task is not None:
                await self._finish_task(self._stderr_task)

    async def _finish_task(self, task: asyncio.Task[None]) -> None:
        if task.done():
            return
        try:
            await asyncio.wait_for(task, 1.0)
        except (TimeoutError, asyncio.CancelledError):
            task.cancel()

    async def _drain_stdout(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        while await self.process.stdout.read(CHUNK_SIZE):
            pass

    async def _drain_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        while True:
            data = await self.process.stderr.read(4096)
            if not data:
                return
            self._stderr_chunks.append(data)
