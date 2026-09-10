import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models import ChatSession, ChatMessage
from app.conversation_memory import retrieve_conversations, query_terms, relevant_excerpt, recent_context


def test_retrieval_finds_older_context_across_models_and_isolates_owner():
    engine = create_engine('sqlite:///:memory:')
    ChatSession.__table__.create(engine)
    ChatMessage.__table__.create(engine)
    with Session(engine) as db:
        db.add_all([ChatSession(id='old', user_id=1, title='Project'),
                    ChatSession(id='new', user_id=1, title='New'),
                    ChatSession(id='other', user_id=2, title='Private')])
        db.flush()
        db.add(ChatMessage(session_id='old', role='user', content='Orion launch date is November 18.', model_used='local'))
        for index in range(20):
            db.add(ChatMessage(session_id='old', role='assistant', content=f'Unrelated response {index}', model_used='cloud'))
        db.add(ChatMessage(session_id='other', role='user', content='Orion private secret'))
        db.commit()
        recalled = retrieve_conversations(db, 1, 'new', 'Orion launch date')
        assert 'November 18' in recalled[0]['content']
        assert all(item['session_id'] != 'other' for item in recalled)
        assert sum(len(item['content']) for item in retrieve_conversations(db, 1, 'new', 'Orion', 20)) <= 20
        assert retrieve_conversations(db, 3, 'new', 'Orion') == []
        assert retrieve_conversations(db, 1, 'new', 'Orion', 0) == []
        assert retrieve_conversations(db, 1, 'new', 'Orion', -1) == []
        assert recalled[0]['message_id'] is not None


def test_hindi_combining_marks_and_literal_search_terms():
    assert query_terms('मेरी परियोजना याद रखो') == ['मेरी', 'परियोजना', 'याद', 'रखो']
    assert query_terms('please % Orion_orion') == ['orion']


def test_excerpt_keeps_match_after_long_prefix():
    content = 'Earlier unrelated content. ' * 500 + 'Orion launches November 18.'
    excerpt, offset = relevant_excerpt(content, ['orion'], 100)
    assert 'Orion launches November 18.' in excerpt
    assert offset > 0
    assert len(excerpt) <= 100
    assert content[offset:offset + len(excerpt)] == excerpt


def test_excerpt_accounts_for_casefold_expansion():
    content = 'ß' * 500 + 'Orion deadline'
    excerpt, offset = relevant_excerpt(content, ['orion'], 50)
    assert 'Orion deadline' in excerpt
    assert content[offset:offset + len(excerpt)] == excerpt


def test_oversized_newest_turn_does_not_erase_context():
    rows = [ChatMessage(role='assistant', content='old ' * 100 + 'The deadline is tomorrow.')]
    result = recent_context(rows, max_words=10)
    assert len(result) == 1
    assert result[0]['content'].endswith('The deadline is tomorrow.')
    assert result[0]['content'].startswith('[Earlier-content-omitted]')
    assert len(result[0]['content'].split()) <= 10


def test_context_preserves_chronology_and_code_whitespace():
    rows = [ChatMessage(role='assistant', content='def run():\n    return 42'),
            ChatMessage(role='user', content='Write a function.')]
    assert recent_context(rows) == [
        {'role': 'user', 'content': 'Write a function.'},
        {'role': 'assistant', 'content': 'def run():\n    return 42'}]
    assert recent_context(rows, max_words=0) == []
