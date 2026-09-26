"""Work keeps going when the page that started it goes away, and can be picked up again."""
import asyncio
import json

from app import jobs


def lines(n, delay=0.01):
    async def gen():
        for i in range(n):
            await asyncio.sleep(delay)
            yield json.dumps({"i": i}) + "\n"
    return gen()


def test_a_job_finishes_even_when_nobody_watches_to_the_end():
    async def go():
        job = jobs.start("chat", lines(20), {"session_id": "s1"})
        seen = []
        async for line in jobs.follow(job):
            seen.append(line)
            if len(seen) == 3:
                break          # the page went away
        await asyncio.wait_for(job.task, timeout=5)
        return job, seen

    job, seen = asyncio.run(go())
    assert job.done and len(job.lines) == 20
    assert json.loads(seen[0])["type"] == "job"


def test_attaching_later_replays_everything_then_follows_live():
    async def go():
        job = jobs.start("agent", lines(10, 0.02), {"session_id": "s2"})
        await asyncio.sleep(0.07)
        got = [line async for line in jobs.follow(job, 0, announce=False)]
        return got

    got = asyncio.run(go())
    assert [json.loads(l)["i"] for l in got] == list(range(10))


def test_jobs_are_listed_by_conversation_and_can_be_cancelled():
    async def go():
        job = jobs.start("chat", lines(1000, 0.05), {"session_id": "s3"})
        listed = jobs.listing(session_id="s3")
        assert jobs.cancel(job.id)
        try:
            await job.task
        except asyncio.CancelledError:
            pass
        return listed, job

    listed, job = asyncio.run(go())
    assert listed and listed[0]["meta"]["session_id"] == "s3"
    assert job.done and job.error == "Stopped."


def test_an_error_in_the_work_is_reported_to_whoever_attaches():
    async def boom():
        yield "{}\n"
        raise RuntimeError("model went away")

    async def go():
        job = jobs.start("chat", boom(), {})
        await asyncio.wait_for(job.task, timeout=5)
        return [line async for line in jobs.follow(job, 0, announce=False)]

    got = asyncio.run(go())
    assert "model went away" in got[-1]


def test_a_reply_being_prepared_is_listed_until_it_becomes_a_job():
    from app import jobs
    waiting = jobs.preparing("chat", {"session_id": "prep-1"})
    listed = jobs.listing(session_id="prep-1")
    assert listed and listed[0]["preparing"] and listed[0]["id"] is None and not listed[0]["done"]
    jobs.prepared(waiting)
    assert jobs.listing(session_id="prep-1") == []


def test_listing_by_kind_means_the_kind_of_job():
    from app import jobs
    waiting = jobs.preparing("agent", {"session_id": "kind-1"})
    try:
        assert [j["kind"] for j in jobs.listing(kind="agent", session_id="kind-1")] == ["agent"]
        assert jobs.listing(kind="chat", session_id="kind-1") == []
    finally:
        jobs.prepared(waiting)
