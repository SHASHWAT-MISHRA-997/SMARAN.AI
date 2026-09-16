"""Saving a workspace file must not destroy an unrelated sibling.

Live HTTP acceptance found that applying note.txt consumed an existing
note.txt.smaran-tmp: the fixed staging filename overwrote it and moved it away.
Save failures must also preserve the original and leave the proposal retryable.
"""
from pathlib import Path

import pytest

from app.workspace.core import Workspace


def test_apply_preserves_preexisting_staging_sibling(tmp_path):
    target = tmp_path / 'note.txt'
    sibling = tmp_path / 'note.txt.smaran-tmp'
    target.write_bytes(b'original\n')
    sibling.write_bytes(b'unrelated content\n')
    workspace = Workspace()
    workspace.open(str(tmp_path))
    proposal = workspace.propose_write('note.txt', 'approved\n')

    workspace.apply(proposal['id'])

    assert target.read_bytes() == b'approved\n'
    assert sibling.read_bytes() == b'unrelated content\n'
    assert sorted(p.name for p in tmp_path.iterdir()) == ['note.txt', 'note.txt.smaran-tmp']


def test_failed_replace_keeps_original_and_removes_only_own_temp(tmp_path, monkeypatch):
    target = tmp_path / 'note.txt'
    sibling = tmp_path / 'note.txt.smaran-tmp'
    target.write_bytes(b'original\n')
    sibling.write_bytes(b'unrelated content\n')
    workspace = Workspace()
    workspace.open(str(tmp_path))
    proposal = workspace.propose_write('note.txt', 'approved\n')

    def fail_replace(source, destination):
        assert Path(source).read_bytes() == b'approved\n'
        raise PermissionError('Fixture simulates a file held open by another app')

    monkeypatch.setattr('app.workspace.core.os.replace', fail_replace)
    with pytest.raises(PermissionError):
        workspace.apply(proposal['id'])

    assert target.read_bytes() == b'original\n'
    assert sibling.read_bytes() == b'unrelated content\n'
    assert sorted(p.name for p in tmp_path.iterdir()) == ['note.txt', 'note.txt.smaran-tmp']
    assert [p['id'] for p in workspace.pending()] == [proposal['id']]
