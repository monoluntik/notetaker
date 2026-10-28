"""SQL functions for occurrence expansion and a partial index for series

Вхождения серий в окне и их число вычисляются в PostgreSQL, а не в Python: на 100k заметок
развёртка в Python занимала секунды (см. docs/LOADTEST.md). Python-генератор
services/recurrence.py остаётся эталоном; совпадение проверяется тестами (test_sql_recurrence.py).

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-28 17:10
"""
from alembic import op

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None

FUNCTIONS = r"""
-- Местное «настенное» время → момент. Несуществующее время (переход вперёд) PostgreSQL сам
-- трактует по смещению до перехода (как Python). Для неоднозначного (переход назад) PostgreSQL
-- берёт более поздний момент, а правило D5 — первый (fold=0), поэтому сдвигаем на час назад,
-- если более ранний момент даёт то же местное время.
CREATE OR REPLACE FUNCTION nt_local_to_utc(l timestamp, tz text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE inst timestamptz := l AT TIME ZONE tz;
BEGIN
  IF ((inst - interval '1 hour') AT TIME ZONE tz) = l THEN
    RETURN inst - interval '1 hour';
  END IF;
  RETURN inst;
END $$;

CREATE OR REPLACE FUNCTION nt_step(freq text, k int) RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE freq WHEN 'daily' THEN make_interval(days => k)
                   WHEN 'weekly' THEN make_interval(days => 7 * k)
                   ELSE make_interval(months => k) END
$$;

-- k-е вхождение серии (k от 0): местное время + шаг от якоря (месяц «прижимается» к концу).
CREATE OR REPLACE FUNCTION nt_occurrence(start_at timestamptz, tz text, freq text, k int) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nt_local_to_utc((start_at AT TIME ZONE tz) + nt_step(freq, k), tz)
$$;

-- Число вхождений серии с моментом < x (с учётом даты окончания until, включительно).
-- Оценка индекса по разнице местного времени даёт нижнюю границу, затем 1–3 шага уточнения.
CREATE OR REPLACE FUNCTION nt_count_before(start_at timestamptz, tz text, freq text, until date, x timestamptz)
RETURNS int LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  ls timestamp := start_at AT TIME ZONE tz;
  xl timestamp;
  k int;
  k_until int;
BEGIN
  IF x <= start_at OR until < ls::date THEN
    RETURN 0;
  END IF;
  xl := x AT TIME ZONE tz;
  IF freq = 'daily' THEN
    k := floor(extract(epoch FROM (xl - ls)) / 86400)::int;
    k_until := until - ls::date;
  ELSIF freq = 'weekly' THEN
    k := floor(extract(epoch FROM (xl - ls)) / 604800)::int;
    k_until := (until - ls::date) / 7;
  ELSE
    k := (extract(year FROM xl)::int - extract(year FROM ls)::int) * 12 + extract(month FROM xl)::int - extract(month FROM ls)::int;
    k_until := (extract(year FROM until)::int - extract(year FROM ls)::int) * 12 + extract(month FROM until)::int - extract(month FROM ls)::int;
    IF (ls + make_interval(months => k_until))::date > until THEN
      k_until := k_until - 1;
    END IF;
  END IF;
  k := least(greatest(k - 1, 0), k_until + 1);  -- все вхождения 0..k-1 заведомо раньше x
  WHILE k <= k_until AND nt_local_to_utc(ls + nt_step(freq, k), tz) < x LOOP
    k := k + 1;
  END LOOP;
  RETURN k;
END $$;
"""


def upgrade() -> None:
    op.execute(FUNCTIONS)
    op.execute(
        "CREATE INDEX ix_notes_series_start ON notes (start_at) "
        "WHERE recurrence_freq <> 'none' AND deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_series_start")
    for fn in ("nt_count_before(timestamptz, text, text, date, timestamptz)",
               "nt_occurrence(timestamptz, text, text, int)", "nt_step(text, int)",
               "nt_local_to_utc(timestamp, text)"):
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
