"""Government Supervision and Key Task Management Models."""

import uuid
from datetime import date, datetime, timezone
from sqlalchemy import (
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class SupTask(Base):
    """Supervision Key Task."""
    __tablename__ = "sup_task"

    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    supervision_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), default="LEADER_INSTRUCTION") # LEADER_INSTRUCTION, GOV_REPORT, COUNCIL_DECISION, EMERGENCY
    priority: Mapped[str] = mapped_column(String(20), default="NORMAL") # TOP(特急), URGENT(急), NORMAL(常规)
    lead_dept_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="CASCADE"), index=True)
    assist_dept_names: Mapped[str | None] = mapped_column(String(255), nullable=True) # 协办处室
    leader_in_charge: Mapped[str | None] = mapped_column(String(100), nullable=True) # 分管领导
    deadline: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    warning_level: Mapped[str] = mapped_column(String(20), default="GREEN") # GREEN(正常), YELLOW(预警), RED(逾期)
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="IN_PROGRESS", index=True) # DRAFT, IN_PROGRESS, EXTENSION_PENDING, CLOSE_PENDING, CLOSED, CANCELLED
    content: Mapped[str] = mapped_column(Text, nullable=False)
    closeout_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    closeout_approved_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    closeout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    lead_dept = relationship("SysDept")
    milestones: Mapped[list["SupMilestone"]] = relationship("SupMilestone", back_populates="task", cascade="all, delete-orphan")
    reports: Mapped[list["SupProgressReport"]] = relationship("SupProgressReport", back_populates="task", cascade="all, delete-orphan")


class SupMilestone(Base):
    """Supervision Task Milestone."""
    __tablename__ = "sup_milestone"

    milestone_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sup_task.task_id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    target_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, IN_PROGRESS, DONE, OVERDUE

    task = relationship("SupTask", back_populates="milestones")


class SupProgressReport(Base):
    """Periodic progress report (weekly/monthly/special)."""
    __tablename__ = "sup_progress_report"

    report_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sup_task.task_id", ondelete="CASCADE"), index=True)
    submit_dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    submit_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    period_type: Mapped[str] = mapped_column(String(20), default="WEEKLY") # WEEKLY, MONTHLY, SPECIAL
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    blockers: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    task = relationship("SupTask", back_populates="reports")
    submit_dept = relationship("SysDept")
    submit_user = relationship("SysUser")
