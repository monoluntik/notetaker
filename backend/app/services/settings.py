from sqlalchemy.orm import Session

from app.models import UserSettings
from app.schemas import SettingsUpdate


def get_settings_row(db: Session) -> UserSettings:
    row = db.get(UserSettings, 1)
    if row is None:  # на случай ручной очистки таблицы
        row = UserSettings(id=1, timezone="UTC")
        db.add(row)
        db.flush()
    return row


def update_settings(db: Session, data: SettingsUpdate) -> UserSettings:
    row = get_settings_row(db)
    if "email" in data.model_fields_set:
        row.email = data.email
    if data.timezone is not None:
        # Меняется только отображение: моменты заметок и напоминаний хранятся в UTC (DECISIONS D4).
        row.timezone = data.timezone
    db.commit()
    return row
