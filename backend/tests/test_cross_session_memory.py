import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, User, ChatSession, ChatMessage, UserMemory
from app.schemas import ChatRequest
from app.conversation_memory import recent_context


@pytest.fixture
def memory_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Create test user
    test_user = User(id=1, username="test_dev", password_hash="pw", is_approved=True)
    session.add(test_user)
    session.commit()
    
    yield session
    session.close()


def test_cross_session_memory_retrieval(memory_db):
    """Verify that when a user starts a new conversation, recent topics from past sessions are captured."""
    # 1. Simulate an earlier session where the user was working on a Python snake game
    old_session = ChatSession(id="session_prev_1", user_id=1, title="Python Snake Game with Pygame")
    memory_db.add(old_session)
    memory_db.commit()
    
    m1 = ChatMessage(session_id="session_prev_1", role="user", content="Let's build a snake game in Python using Pygame.")
    m2 = ChatMessage(session_id="session_prev_1", role="assistant", content="Here is the Pygame snake code with grid movement and food spawning.")
    memory_db.add_all([m1, m2])
    memory_db.commit()
    
    # 2. Add long-term user memory fact
    memory_fact = UserMemory(user_id=1, fact="Prefers dark theme and TypeScript for frontend apps", category="user_preference")
    memory_db.add(memory_fact)
    memory_db.commit()
    
    # 3. Simulate a brand new session
    new_session = ChatSession(id="session_new_2", user_id=1, title="New Conversation")
    memory_db.add(new_session)
    memory_db.commit()
    
    # Query recent other sessions exactly like /api/chat does
    other_sessions = (
        memory_db.query(ChatSession)
        .filter(ChatSession.user_id == 1, ChatSession.id != new_session.id)
        .order_by(ChatSession.updated_at.desc())
        .limit(4)
        .all()
    )
    assert len(other_sessions) == 1
    assert other_sessions[0].title == "Python Snake Game with Pygame"
    
    # Verify turns are captured
    last_turns = (
        memory_db.query(ChatMessage)
        .filter(ChatMessage.session_id == other_sessions[0].id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(2)
        .all()
    )
    assert len(last_turns) == 2
    assert "snake game" in last_turns[1].content.lower()
    
    # Verify long-term memory vault facts are retrieved
    vault_facts = memory_db.query(UserMemory).filter(UserMemory.user_id == 1).all()
    assert len(vault_facts) == 1
    assert "TypeScript" in vault_facts[0].fact


def test_sliding_window_short_term_memory(memory_db):
    """Verify that multi-turn short-term history preserves back-and-forth conversation within a session."""
    session = ChatSession(id="session_multi_turn", user_id=1, title="Multi-turn coding session")
    memory_db.add(session)
    memory_db.commit()
    
    # Add 10 turns
    for i in range(10):
        memory_db.add(ChatMessage(session_id="session_multi_turn", role="user", content=f"Step {i}: implement feature {i}"))
        memory_db.add(ChatMessage(session_id="session_multi_turn", role="assistant", content=f"Step {i}: feature {i} implemented successfully with tests."))
    memory_db.commit()
    
    # Retrieve with the expanded 3000-word limit
    past_messages = (
        memory_db.query(ChatMessage)
        .filter(ChatMessage.session_id == "session_multi_turn")
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(24)
        .all()
    )
    pruned_history = recent_context(past_messages)
    
    # All 20 messages (10 user + 10 assistant) are retained without being wiped out
    assert len(pruned_history) == 20
    assert pruned_history[0]["content"] == "Step 0: implement feature 0"
    assert pruned_history[-1]["content"] == "Step 9: feature 9 implemented successfully with tests."
