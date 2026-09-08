"""Use the bundled SQLite during PyInstaller's isolated Linux analysis too."""
import sys

if sys.platform.startswith("linux"):
    import sqlite3

    if sqlite3.sqlite_version_info < (3, 35, 0):
        import pysqlite3
        import pysqlite3.dbapi2

        sys.modules["sqlite3"] = pysqlite3
        sys.modules["sqlite3.dbapi2"] = pysqlite3.dbapi2
