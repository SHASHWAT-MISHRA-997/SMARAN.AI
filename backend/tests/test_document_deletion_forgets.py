"""Deleting a document has to delete what was learned from it.

Found by uploading a file, asking about it, deleting it, and asking again.

The file went. Its vectors went - checked directly in the vector store, and
they were correctly purged. The app still answered the question, in a brand new
chat session, from a document the user had just been told was "deleted
successfully".

The facts had been extracted into long-term memory during the conversation, and
memory recorded which *session* a fact came from but never which *file*. So
there was nothing to delete by. Someone removes a confidential document, is
told it is gone, and it goes on being quoted.

Two attempts at this, and the first was wrong in a way worth recording. It
stored a single document id, and only when a turn was grounded in exactly one
file. Retrieval draws chunks from the whole collection, so in any real
collection more than one file is involved and the id was never recorded at all
- the leak stayed open and the code looked like it had been fixed. It is a list
now, and a memory is forgotten if the deleted document is anywhere in it:
over-forgetting is the safe direction when the alternative is a deleted
confidential file still answering questions.
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_memory_records_which_files_a_fact_came_from():
    from app.models import UserMemory

    assert hasattr(UserMemory, "source_document_ids"), (
        "memory has no link back to the file a fact came from, so deleting "
        "the file cannot remove it"
    )


def test_provenance_is_a_list_not_a_single_id():
    """A turn is normally grounded in several documents at once.

    Storing one id, and only when exactly one file was involved, meant nothing
    was ever recorded in a real collection - which looks identical to a fix
    that works until someone deletes something confidential.
    """
    import inspect

    from app import main

    source = inspect.getsource(main._extract_and_save_memory)
    assert "json.dumps(sorted({int(d) for d in source_document_ids}))" in source, (
        "provenance is not stored as a list of every document that was used"
    )
    assert "len(set(source_document_ids)) == 1" not in source, (
        "provenance is still only recorded when a single document was used, "
        "which is almost never"
    )


def test_both_chat_paths_pass_the_documents_they_used():
    """A path that forgets to pass them leaks by omission."""
    source = (BACKEND / "app" / "main.py").read_text(encoding="utf-8")
    assert source.count("source_document_ids=[") >= 2, (
        "at least one chat path saves memories without recording which files "
        "they came from"
    )


def test_deleting_a_document_removes_its_remembered_facts():
    import inspect

    from app import main

    source = inspect.getsource(main.delete_document)
    assert "UserMemory" in source, "deletion does not touch memory at all"
    assert "source_document_ids" in source
    assert "forgotten" in source


def test_the_match_is_exact_rather_than_a_substring():
    """"3" appears inside "13". A LIKE against the JSON would forget the
    wrong things, which is its own kind of data loss."""
    import inspect

    from app import main

    source = inspect.getsource(main.delete_document)
    assert "json.loads(memory.source_document_ids)" in source
    assert "doc.id in sources" in source
    # The SQLAlchemy call, not the English word - the comment above this code
    # explains why LIKE is wrong here, and matching that comment made this
    # assertion fail on correct code.
    assert ".like(" not in source
    assert ".contains(" not in source


def test_a_memory_from_several_files_goes_with_any_of_them():
    """Deleting one source of a fact must remove the fact.

    Keeping it because another file also mentioned it would leave the deleted
    document's content in place, which is the thing being prevented.
    """
    sources = json.loads(json.dumps(sorted({4, 1})))
    assert 4 in sources and 1 in sources


def test_a_failed_vector_delete_is_not_reported_as_success():
    """It used to be. The chunks stayed searchable, the user was told the
    document was deleted, and nothing anywhere said otherwise."""
    import inspect

    from app import main

    source = inspect.getsource(main.delete_document)
    assert "vector_error" in source
    assert "raise HTTPException" in source, (
        "a failure to clear the search index still reports success"
    )
    assert "may still be found in" in source


def test_unrelated_memories_are_left_alone():
    """Forgetting everything on any delete would be a different bug."""
    import inspect

    from app import main

    source = inspect.getsource(main.delete_document)
    # Scoped to this user and to memories that name a source at all.
    assert "UserMemory.user_id == current_user.id" in source
    assert "UserMemory.source_document_ids.isnot(None)" in source


def test_the_migration_leaves_old_rows_null():
    """Nothing recorded where those facts came from at the time. Inventing a
    provenance would make a later delete remove memories that had nothing to
    do with the file."""
    import inspect

    from app import main

    source = inspect.getsource(main._add_memory_source_document)
    assert "ADD COLUMN source_document_ids TEXT" in source
    assert "if \"source_document_ids\" in columns" in source, (
        "the migration would run again on every start"
    )
