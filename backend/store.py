import copy
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, String, Integer, JSON, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

load_dotenv()
Path('data').mkdir(exist_ok=True)
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./data/reroute.db')
engine = create_engine(DATABASE_URL, connect_args={'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {}, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Case(Base):
    __tablename__ = 'cases'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[dict] = mapped_column(JSON)


class Ledger(Base):
    __tablename__ = 'purchase_requests'
    key: Mapped[str] = mapped_column(String(180), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)


def now():
    return datetime.now(timezone.utc).isoformat()


def event(data, actor, title, detail, kind='info'):
    data['events'].append({'id': len(data['events']) + 1, 'at': now(), 'actor': actor, 'title': title, 'detail': detail, 'kind': kind})


def read(case_id):
    with Session() as session:
        row = session.get(Case, case_id)
        if row is None:
            raise KeyError(case_id)
        return copy.deepcopy(row.payload), row.revision


def save(case_id, data, revision):
    data['updated_at'] = now()
    with Session.begin() as session:
        result = session.execute(update(Case).where(Case.id == case_id, Case.revision == revision).values(payload=data, revision=revision + 1))
        if result.rowcount != 1:
            raise ValueError('This case changed in another session. Refresh and try again.')
    return revision + 1


def all_cases():
    with Session() as session:
        return [copy.deepcopy(c.payload) for c in session.scalars(select(Case))]
