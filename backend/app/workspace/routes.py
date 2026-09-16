"""HTTP surface for the open folder.

Proposing and applying are separate endpoints on purpose. A model can call
/propose as often as it likes and nothing on disk moves; /apply is the only
route that writes, and it takes an id that a person has seen the diff for.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .core import WorkspaceError, workspace

def require_local_workspace(request: Request):
    """The shared desktop folder is not a remotely owned workspace.

    Proposal IDs are returned to their creator and listed by /pending, so
    they cannot authenticate approval. Gate reads and proposals as well as
    apply, before touching any state. Never trust forwarded headers here.
    """
    host = request.client.host if request.client else ""
    if host not in {"127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"}:
        raise HTTPException(
            status_code=403,
            detail="Workspace controls are available only on this computer.",
        )


router = APIRouter(prefix="/api/workspace", tags=["workspace"],
                   dependencies=[Depends(require_local_workspace)])


class OpenRequest(BaseModel):
    folder: str = Field(..., description="Absolute path to the project folder.")


class WriteRequest(BaseModel):
    path: str = Field(..., description="Path relative to the open folder.")
    text: str
    summary: str = ""


class PathRequest(BaseModel):
    path: str
    summary: str = ""


class ChangeRequest(BaseModel):
    id: str


def _guard(fn, *args, **kwargs):
    """Turn a refusal into a 400 carrying the reason it was refused."""
    try:
        return fn(*args, **kwargs)
    except WorkspaceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/status")
async def status():
    return workspace.describe()


@router.get("/browse")
async def browse(path: str = ""):
    """Folders at a path, so the interface can offer a picker."""
    return _guard(workspace.browse, path or None)


@router.post("/open")
async def open_folder(req: OpenRequest):
    return _guard(workspace.open, req.folder)


@router.post("/close")
async def close_folder():
    workspace.close()
    return {"open": False}


@router.get("/tree")
async def tree(limit: int = 2000):
    return _guard(workspace.tree, limit)


@router.get("/file")
async def read_file(path: str):
    return _guard(workspace.read, path)


@router.post("/propose/write")
async def propose_write(req: WriteRequest):
    """Describe an edit. Writes nothing; returns a diff and an id."""
    return _guard(workspace.propose_write, req.path, req.text, req.summary)


@router.post("/propose/delete")
async def propose_delete(req: PathRequest):
    return _guard(workspace.propose_delete, req.path, req.summary)


@router.get("/pending")
async def pending():
    return {"pending": workspace.pending()}


@router.post("/apply")
async def apply(req: ChangeRequest):
    """The only endpoint that changes a file. Needs an id that was approved."""
    return _guard(workspace.apply, req.id)


@router.post("/reject")
async def reject(req: ChangeRequest):
    return _guard(workspace.reject, req.id)


@router.get("/history")
async def history():
    return {"applied": workspace.history()}
