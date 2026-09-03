import logging

from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

logger = logging.getLogger(__name__)

# Checked before anything opens it, and a copy taken while it is known good.
#
# A damaged store used to be discovered halfway through startup, by a migration
# that logged a warning and carried on - so the app ran on a file it could not
# fully read, and a conversation that was there looked like one that was not.
# This runs first because after the engine connects it is too late to swap the
# file underneath it.
try:
    from app.db_guard import ensure_usable
    logger.info("Conversation store: %s", ensure_usable(settings.DATABASE_URL))
except Exception as exc:  # noqa: BLE001 - never stop the app from starting
    logger.warning("Could not check the conversation store: %s", exc)

# Conditional database configuration for SQLite vs PostgreSQL
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_engine(
    settings.DATABASE_URL, connect_args=connect_args
)

@event.listens_for(engine, "connect")
def configure_sqlite(connection, _):
    """Make the shared SQLite store tolerant of simultaneous LAN requests (only when SQLite)."""
    if settings.DATABASE_URL.startswith("sqlite"):
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
