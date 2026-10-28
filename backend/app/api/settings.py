from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas import SettingsOut, SettingsUpdate
from app.services import settings as svc
from app.timeutil import all_timezones

router = APIRouter(tags=["settings"])


def _out(row, request: Request) -> SettingsOut:
    return SettingsOut(email=row.email, timezone=row.timezone,
                       trash_retention_days=request.app.state.settings.trash_retention_days)


@router.get("/settings", response_model=SettingsOut)
def get_settings(request: Request, db: Session = Depends(get_db)):
    row = svc.get_settings_row(db)
    db.commit()
    return _out(row, request)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(data: SettingsUpdate, request: Request, db: Session = Depends(get_db)):
    return _out(svc.update_settings(db, data), request)


@router.get("/timezones", response_model=list[str])
def timezones():
    return all_timezones()
