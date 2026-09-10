"""Revision-checked coding snapshots; deliberately separate from ordinary chat.

Clients must retain unsynced changes when a write returns 409. A tombstone
prevents a stale offline client from resurrecting a deleted task.
"""
import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CodingTask, User

router = APIRouter(prefix='/api/code/tasks', tags=['coding-sync'])


def sync_user(request: Request, db: Session = Depends(get_db)):
    # 1. Bearer token or cookie session token
    token = request.cookies.get('session_token', '')
    authorization = request.headers.get('Authorization', '')
    if authorization.startswith('Bearer '):
        token = authorization[7:].strip()
    if token:
        user = db.query(User).filter(User.session_token == token).first()
        if user and user.session_expires and user.session_expires > datetime.now():
            return user

    # 2. Local loopback connection (Desktop SMARAN Code and local VS Code extension)
    client_ip = request.client.host if request.client else "127.0.0.1"
    if client_ip in ["127.0.0.1", "localhost", "::1"]:
        from app.main import get_current_user
        try:
            return get_current_user(request, db)
        except Exception:
            pass

    raise HTTPException(401, 'Sign in or connect locally to synchronize coding tasks.')


class Turn(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=500000)


class Snapshot(BaseModel):
    expected_revision: int = Field(ge=0)
    project_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    entries: list[dict] = Field(default_factory=list, max_length=10000)
    history: list[Turn] = Field(default_factory=list, max_length=10000)
    archived: bool = False
    deleted: bool = False

    @model_validator(mode='after')
    def bounded_payload(self):
        if len(self.model_dump_json().encode('utf-8')) > 4 * 1024 * 1024:
            raise ValueError('Task snapshot exceeds 4 MiB; retain locally and export attachments separately.')
        return self


def serialize(row):
    return dict(id=row.id, project_id=row.project_id, title=row.title,
                revision=row.revision, archived=row.archived, deleted=row.deleted,
                updated_at=row.updated_at.isoformat(), **json.loads(row.payload))


@router.get('')
def list_tasks(project_id: str | None = None, offset: int = Query(0, ge=0),
               limit: int = Query(100, ge=1, le=200), db: Session = Depends(get_db),
               user: User = Depends(sync_user)):
    query = db.query(CodingTask).filter(CodingTask.user_id == user.id)
    if project_id is not None:
        query = query.filter(CodingTask.project_id == project_id)
    # Includes tombstones so reconnecting clients learn about deletions.
    rows = query.order_by(CodingTask.id).offset(offset).limit(limit + 1).all()
    return {'tasks': [dict(id=r.id, project_id=r.project_id, title=r.title,
                           revision=r.revision, archived=r.archived, deleted=r.deleted,
                           updated_at=r.updated_at.isoformat()) for r in rows[:limit]],
            'next_offset': offset + limit if len(rows) > limit else None}


@router.get('/{task_id}')
def get_task(task_id: str, db: Session = Depends(get_db), user: User = Depends(sync_user)):
    row = db.query(CodingTask).filter_by(id=task_id, user_id=user.id).first()
    if row is None:
        raise HTTPException(404, 'Coding task not found.')
    return serialize(row)


@router.put('/{task_id}')
def put_task(task_id: str, body: Snapshot, db: Session = Depends(get_db),
             user: User = Depends(sync_user)):
    if not task_id or len(task_id) > 100:
        raise HTTPException(422, 'Invalid task identifier.')
    row = db.query(CodingTask).filter_by(id=task_id).first()
    if row is not None and row.user_id != user.id:
        raise HTTPException(404, 'Coding task not found.')
    payload = json.dumps({'entries': [] if body.deleted else body.entries,
                          'history': [] if body.deleted else [t.model_dump() for t in body.history]},
                         sort_keys=True, ensure_ascii=False)
    values = dict(project_id=body.project_id, title=body.title, payload=payload,
                  archived=body.archived, deleted=body.deleted)
    if row is not None:
        # Retrying a response-lost write is harmless even with the old revision.
        if all(getattr(row, key) == value for key, value in values.items()):
            return serialize(row)
        if row.deleted or row.revision != body.expected_revision:
            raise HTTPException(409, {'message': 'Task changed; fetch and reconcile before retrying.',
                                      'revision': row.revision})
        count = db.query(CodingTask).filter_by(id=task_id, user_id=user.id,
                                              revision=body.expected_revision).update(
            dict(**values, revision=body.expected_revision + 1, updated_at=datetime.now()),
            synchronize_session=False)
        if count != 1:
            db.rollback()
            raise HTTPException(409, 'Concurrent task update; fetch and reconcile.')
    else:
        if body.expected_revision != 0:
            raise HTTPException(409, 'Task does not exist; preserve local changes.')
        db.add(CodingTask(id=task_id, user_id=user.id, revision=1, **values))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Concurrent task creation; fetch and reconcile.') from None
    db.expire_all()
    return serialize(db.query(CodingTask).filter_by(id=task_id, user_id=user.id).one())
