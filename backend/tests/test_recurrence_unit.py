from datetime import UTC, date, datetime

from app.services.recurrence import is_occurrence, iter_occurrence_starts


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC) if "+" not in s else datetime.fromisoformat(s)


def gen(start, tz, freq, until, ws="2000-01-01T00:00", we="2100-01-01T00:00"):
    return [d.strftime("%Y-%m-%dT%H:%MZ") for d in iter_occurrence_starts(utc(start), tz, freq, until, utc(ws), utc(we))]


def test_daily_until_is_inclusive():
    assert gen("2026-11-01T09:00", "UTC", "daily", date(2026, 11, 3)) == [
        "2026-11-01T09:00Z", "2026-11-02T09:00Z", "2026-11-03T09:00Z"]


def test_until_is_local_date_of_note_timezone():
    # 23:30 по Алматы (UTC+5) = 18:30Z. until=03.11 по местной дате.
    out = gen("2026-11-01T18:30", "Asia/Almaty", "daily", date(2026, 11, 3))
    assert out == ["2026-11-01T18:30Z", "2026-11-02T18:30Z", "2026-11-03T18:30Z"]


def test_until_before_start_gives_nothing_but_single_day_series_gives_one():
    assert gen("2026-11-05T09:00", "UTC", "daily", date(2026, 11, 4)) == []
    assert gen("2026-11-05T09:00", "UTC", "weekly", date(2026, 11, 5)) == ["2026-11-05T09:00Z"]


def test_weekly():
    assert gen("2026-11-02T09:00", "UTC", "weekly", date(2026, 11, 30)) == [
        "2026-11-02T09:00Z", "2026-11-09T09:00Z", "2026-11-16T09:00Z", "2026-11-23T09:00Z", "2026-11-30T09:00Z"]


def test_monthly_clamps_to_last_day_and_keeps_anchor():
    out = gen("2028-01-31T10:00", "UTC", "monthly", date(2028, 5, 31))
    assert out == ["2028-01-31T10:00Z", "2028-02-29T10:00Z", "2028-03-31T10:00Z", "2028-04-30T10:00Z", "2028-05-31T10:00Z"]


def test_monthly_across_year_boundary():
    assert gen("2026-11-15T10:00", "UTC", "monthly", date(2027, 2, 15)) == [
        "2026-11-15T10:00Z", "2026-12-15T10:00Z", "2027-01-15T10:00Z", "2027-02-15T10:00Z"]


def test_window_is_half_open_and_boundaries_exact():
    args = ("2026-11-01T09:00", "UTC", "daily", date(2026, 12, 31))
    assert gen(*args, ws="2026-11-05T09:00", we="2026-11-07T09:00") == ["2026-11-05T09:00Z", "2026-11-06T09:00Z"]
    assert gen(*args, ws="2026-11-05T09:00:01", we="2026-11-06T09:00:01") == ["2026-11-06T09:00Z"]


def test_window_far_from_start_is_efficient_and_correct():
    out = gen("2020-01-01T09:00", "UTC", "daily", date(2030, 1, 1), ws="2029-12-30T00:00", we="2030-02-01T00:00")
    assert out == ["2029-12-30T09:00Z", "2029-12-31T09:00Z", "2030-01-01T09:00Z"]


def test_dst_keeps_local_wall_time():
    # Нью-Йорк: 01.11.2026 переход с EDT (-4) на EST (-5)
    out = gen("2026-10-31T13:00", "America/New_York", "daily", date(2026, 11, 2))  # 09:00 EDT
    assert out == ["2026-10-31T13:00Z", "2026-11-01T14:00Z", "2026-11-02T14:00Z"]  # 09:00 местного


def test_dst_nonexistent_time_shifts_forward():
    # 08.03.2026 02:30 в Нью-Йорке не существует → 03:30 EDT = 07:30Z
    out = gen("2026-03-07T07:30", "America/New_York", "daily", date(2026, 3, 9))  # 02:30 EST
    assert out == ["2026-03-07T07:30Z", "2026-03-08T07:30Z", "2026-03-09T06:30Z"]


def test_is_occurrence():
    start = utc("2026-11-01T09:00")
    assert is_occurrence(start, "UTC", "daily", date(2026, 11, 5), utc("2026-11-03T09:00"))
    assert not is_occurrence(start, "UTC", "daily", date(2026, 11, 5), utc("2026-11-03T09:01"))
    assert not is_occurrence(start, "UTC", "daily", date(2026, 11, 5), utc("2026-11-06T09:00"))
