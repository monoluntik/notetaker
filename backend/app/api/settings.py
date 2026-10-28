from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas import SettingsOut, SettingsUpdate
from app.services import settings as svc
from app.timeutil import all_timezones

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    row = svc.get_settings_row(db)
    db.commit()
    return row


@router.patch("/settings", response_model=SettingsOut)
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db)):
    return svc.update_settings(db, data)


@router.get("/timezones", response_model=list[str])
def timezones():
    return all_timezones()
