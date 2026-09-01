"""HTTP surface for the coding agent.

Two endpoints, and the split between them is the point: one says what it
intends to do, the other does it. Anything that can write files and run
commands should be able to show its hand first.

The work streams as it happens - a step at a time, with the result of each
tool - rather than arriving as one block at the end. A tool call that is
about to run is worth seeing before it runs.
"""

from __future__ import annotations

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent import loop

logger = logging.getLogger("agent.routes")

router = APIRouter(prefix="/api/agent", tags=["agent"])


class AgentRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=20000)
    #: Empty means the router chooses from what is installed.
    model: str = ""
    #: Earlier turns, so a follow-up knows what was already done.
    history: Optional[List[dict]] = None
    #: A cloud provider and its key, when one is to be used. Without these
    #: the agent uses whatever model is installed locally, which is enough
    #: for small edits and measurably not enough for real work.
    provider: str = ""
    api_key: str = ""
    #: The folder to work in. The editor extension sends the project it has
    #: open; without it the agent uses the folder the desktop app has open.
    #: Guessing here would mean writing one project's changes into another.
    root: str = ""


@router.get("/tools")
async def list_tools():
    """What the agent can do, in the words the model is given."""
    from app.agent import tools as toolbox

    return {
        "tools": [
            {"name": name, "arguments": args, "description": description,
             "changes_things": name in toolbox.MUTATING}
            for name, (_, args, description) in toolbox.TOOLS.items()
        ],
        "note": ("Every tool returns its result to the model, which is what "
                 "lets it correct itself. Tools marked as changing things "
                 "write files or run commands."),
    }


@router.post("/plan")
async def agent_plan(request: AgentRequest):
    """What the agent intends to do. Nothing is touched by this."""
    try:
        return {"plan": await loop.plan(request.task, request.model,
                                        request.provider, request.api_key)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)[:300]) from exc


@router.post("/run")
async def agent_run(request: AgentRequest):
    """Carry out the task, streaming each step as it happens."""

    async def stream():
        try:
            async for event in loop.run(request.task, request.model, request.history,
                                        request.provider, request.api_key,
                                        request.root):
                yield json.dumps(event) + "\n"
        except Exception as exc:  # noqa: BLE001 - the client is told, not left waiting
            logger.exception("agent run failed")
            yield json.dumps({"type": "error", "message": str(exc)[:300]}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
