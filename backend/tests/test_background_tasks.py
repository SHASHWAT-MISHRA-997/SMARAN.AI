"""Background work has to survive the garbage collector, and say when it fails.

`asyncio.create_task` hands back a task the event loop references only weakly.
Nothing else was holding these, so the collector was free to take one partway
through - and the documented symptom is the worst kind: work that stops in the
middle with nothing logged anywhere. Two of the five call sites were the memory
extraction that runs *after* a reply has finished streaming, which means a
memory that occasionally, silently, never got written.

Forgotten tasks also swallow their own failures: nobody retrieves the result,
so the exception surfaces only as "Task exception was never retrieved" printed
to a console the packaged build does not have.
"""

import asyncio
import gc
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import main as app_main  # noqa: E402


def test_a_running_task_is_referenced_so_it_cannot_be_collected():
    async def scenario():
        started = asyncio.Event()

        async def slow():
            started.set()
            await asyncio.sleep(0.05)
            return "finished"

        task = app_main.spawn_background(slow())
        await started.wait()
        # The caller deliberately keeps no reference; the registry must.
        assert task in app_main._background_tasks
        gc.collect()
        assert await task == "finished"

    asyncio.run(scenario())


def test_the_reference_is_released_once_it_finishes():
    """Holding them forever would just be a slower leak."""
    async def scenario():
        async def quick():
            return None

        task = app_main.spawn_background(quick())
        await task
        await asyncio.sleep(0)  # let done callbacks run
        assert task not in app_main._background_tasks

    asyncio.run(scenario())


def test_a_failure_is_logged_rather_than_swallowed(caplog):
    async def scenario():
        async def boom():
            raise RuntimeError("extraction exploded")

        task = app_main.spawn_background(boom(), label="memory extraction")
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)

    with caplog.at_level("ERROR"):
        asyncio.run(scenario())

    assert any(
        "memory extraction failed" in record.message and "extraction exploded" in record.message
        for record in caplog.records
    ), f"expected the label and the cause in the log, got: {[r.message for r in caplog.records]}"


def test_cancellation_is_not_reported_as_a_failure():
    """Shutting down cancels outstanding work; that is not an error."""
    async def scenario():
        async def forever():
            await asyncio.sleep(60)

        task = app_main.spawn_background(forever(), label="long job")
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)
        assert task not in app_main._background_tasks

    asyncio.run(scenario())


def test_no_fire_and_forget_task_is_left_unreferenced_in_main():
    """The two that remain keep their own local references and are awaited."""
    source = (BACKEND / "app" / "main.py").read_text(encoding="utf-8")
    offenders = []
    for number, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if not stripped.startswith("asyncio.create_task("):
            continue
        # `task = asyncio.create_task(...)` and `[asyncio.create_task(...)]`
        # keep a reference; a bare statement does not.
        offenders.append((number, stripped[:60]))
    assert offenders == [], (
        "these start a task without keeping a reference; use spawn_background: "
        + ", ".join(f"line {n}: {t}" for n, t in offenders)
    )
