"""Database connection and session management."""

import sys
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

_engine_kwargs: dict = {"echo": settings.sql_echo}
if "pytest" in sys.modules:
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs.update(pool_size=10, max_overflow=20, pool_pre_ping=True, pool_recycle=1800)

engine = create_async_engine(settings.database_url, **_engine_kwargs)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


import sqlalchemy.orm as _orm

_orig_relationship = _orm.relationship


def _relationship(*args, **kwargs):
    """Async sessions forbid implicit lazy loads; make every relationship
    selectin-eager so router code can safely access related objects."""
    kwargs.setdefault("lazy", "selectin")
    backref = kwargs.get("backref")
    if isinstance(backref, str):
        kwargs["backref"] = (backref, {"lazy": "selectin"})
    return _orig_relationship(*args, **kwargs)


_orm.relationship = _relationship


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional database session as a FastAPI dependency."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Create all database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
