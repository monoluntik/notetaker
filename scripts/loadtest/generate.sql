-- Генератор нагрузочных данных Notetaker.
-- Запуск: psql -v n=10000000 -f generate.sql  (ТОЛЬКО на отдельной нагрузочной БД!)
-- Модель: приложение однопользовательское (TASK.md), поэтому «пользователь» = тег-владелец
-- user-NNNN у каждой заметки; email пользователя хранится в журнале доставок напоминаний.
\set ON_ERROR_STOP on
\timing on
SET synchronous_commit = off;
SELECT setseed(0.42);

\echo === очистка
TRUNCATE notes, tags, note_tags, note_reminders, reminder_deliveries, occurrence_overrides RESTART IDENTITY CASCADE;
DROP TABLE IF EXISTS lt_users;

\echo === пользователи: Zipf(s=1.07) по 1000 пользователей, домены email неравномерно
CREATE TABLE lt_users AS
WITH w AS (SELECT g AS uid, 1.0 / power(g, 1.07) AS w FROM generate_series(1, 1000) g)
SELECT uid,
       sum(w) OVER (ORDER BY uid) / sum(w) OVER () AS hi,
       w / sum(w) OVER () AS share,
       'user' || lpad(uid::text, 4, '0') || '@' ||
         CASE WHEN (uid * 7919) % 100 < 40 THEN 'gmail.com' WHEN (uid * 7919) % 100 < 65 THEN 'yandex.ru'
              WHEN (uid * 7919) % 100 < 80 THEN 'mail.ru' WHEN (uid * 7919) % 100 < 88 THEN 'outlook.com'
              ELSE 'corp' || (uid % 7) || '.example' END AS email,
       (ARRAY['Europe/Moscow','Europe/Moscow','Europe/Moscow','Europe/Moscow','Asia/Almaty','Asia/Almaty',
              'Asia/Yekaterinburg','UTC','Asia/Novosibirsk','Europe/Berlin','America/New_York'])[1 + (uid * 31) % 11] AS tz
FROM w;
CREATE UNIQUE INDEX ON lt_users (hi);

INSERT INTO tags (id, name, color) SELECT uid, 'user-' || lpad(uid::text, 4, '0'), '#64748b' FROM lt_users;
INSERT INTO tags (id, name, color)
SELECT 1000 + t, (ARRAY['Работа','Дом','Здоровье','Учёба','Финансы','Путешествия','Встречи','Покупки','Спорт','Семья',
                        'Проекты','Звонки','Документы','Авто','Хобби','Чтение','Отпуск','Ремонт','Дети','Питомцы'])[t],
       (ARRAY['#4f46e5','#16a34a','#dc2626','#9333ea','#ea580c','#0891b2','#db2777','#ca8a04','#0d9488','#2563eb'])[1 + t % 10]
FROM generate_series(1, 20) t;
SELECT setval('tags_id_seq', 1020);

\echo === удаляем индексы на время массовой вставки (пересоздаются ниже теми же определениями)
DROP INDEX IF EXISTS ix_notes_deleted_start, ix_notes_updated_at, ix_notes_title_trgm, ix_notes_body_trgm, ix_note_tags_tag_id;

\echo === заметки
CREATE UNLOGGED TABLE IF NOT EXISTS lt_owner (note_id int PRIMARY KEY, uid int NOT NULL);
TRUNCATE lt_owner;
INSERT INTO lt_owner
SELECT g, (SELECT uid FROM lt_users WHERE hi >= s.r ORDER BY hi LIMIT 1)
FROM (SELECT g, random() * 0.999999 AS r FROM generate_series(1, :n) g) s;

WITH base AS (
  SELECT o.note_id AS id, u.tz,
         -- день: 92% — прошедшие 12 месяцев с ростом к концу периода (r^0.8), 8% — будущие 3 месяца
         CASE WHEN random() < 0.92 THEN date '2025-10-29' + floor(365 * power(random(), 0.8))::int
              ELSE date '2026-10-29' + floor(random() * 92)::int END AS d0,
         random() AS rh, random() AS rk, random() AS ra, random() AS rd, random() AS rb, random() AS rt
  FROM lt_owner o JOIN lt_users u USING (uid)
), shaped AS (
  SELECT *,
         -- 60% заметок с выходных переносятся на будни
         CASE WHEN extract(isodow FROM d0) IN (6, 7) AND rk < 0.6 THEN d0 + CASE WHEN extract(isodow FROM d0) = 6 THEN -1 ELSE 1 END ELSE d0 END AS d,
         -- 70% — рабочие часы 8–19 (местное), остальное равномерно; минуты кратны 5
         CASE WHEN rh < 0.7 THEN 8 + floor(random() * 12)::int ELSE floor(random() * 24)::int END AS h,
         5 * floor(random() * 12)::int AS mi
  FROM base
)
INSERT INTO notes (id, title, body, start_at, timezone, is_active, deleted_at, recurrence_freq, recurrence_until,
                   version, created_at, updated_at)
SELECT id,
       (ARRAY['Созвон с командой','Оплатить счёт','Встреча с клиентом','Купить продукты','Подготовить отчёт','Записаться к врачу',
              'Тренировка','Позвонить маме','Код-ревью','Планёрка','Сдать документы','Забрать посылку','Ретроспектива',
              'День рождения','Продлить подписку','Отправить резюме','Урок английского','Техосмотр','Митап','Дедлайн проекта'])
         [1 + (id * 13) % 20] || ' #' || id,
       CASE WHEN rb < 0.30 THEN ''
            WHEN rb < 0.80 THEN 'Обсудить план и сроки, подготовить материалы.'
            WHEN rb < 0.95 THEN repeat('Нужно уточнить детали задачи, согласовать бюджет и отправить итоги участникам. ', 5)
            ELSE repeat('Подробное описание с контекстом, ссылками и чек-листом шагов для выполнения задачи. ', 24) END
         || CASE WHEN id % 10000 = 7 THEN ' квазар' ELSE '' END,
       (d + make_interval(hours => h, mins => mi))::timestamp AT TIME ZONE tz,
       tz,
       ra < 0.85,
       CASE WHEN rd < 0.03 THEN now() - make_interval(days => floor(random() * 60)::int) END,
       CASE WHEN rt < 0.006 THEN 'daily' WHEN rt < 0.016 THEN 'weekly' WHEN rt < 0.02 THEN 'monthly' ELSE 'none' END,
       CASE WHEN rt < 0.006 THEN d + 14 + floor(random() * 46)::int
            WHEN rt < 0.016 THEN d + 28 + floor(random() * 92)::int
            WHEN rt < 0.02 THEN d + 90 + floor(random() * 270)::int END,
       1 + floor(random() * 3)::int,
       least(now(), (d::timestamp AT TIME ZONE tz) - make_interval(days => floor(random() * 20)::int)),
       least(now(), (d::timestamp AT TIME ZONE tz) - make_interval(days => floor(random() * 20)::int) + make_interval(hours => floor(random() * 200)::int))
FROM shaped;
SELECT setval('notes_id_seq', (SELECT max(id) FROM notes));

\echo === теги заметок: владелец + 0–2 тематических
INSERT INTO note_tags (note_id, tag_id) SELECT note_id, uid FROM lt_owner;
INSERT INTO note_tags (note_id, tag_id)
SELECT note_id, 1001 + (note_id * 17) % 20 FROM lt_owner WHERE (note_id * 7) % 100 < 85
UNION ALL
SELECT note_id, 1001 + (note_id * 23 + 5) % 20 FROM lt_owner
WHERE (note_id * 7) % 100 < 25 AND (note_id * 23 + 5) % 20 <> (note_id * 17) % 20
ON CONFLICT DO NOTHING;

\echo === напоминания: 35% заметок
INSERT INTO note_reminders (note_id, offset_minutes)
SELECT id, m FROM (
  SELECT id, (id * 37) % 100 AS k FROM notes WHERE (id * 11) % 100 < 35
) s, LATERAL unnest(CASE WHEN k < 60 THEN ARRAY[10] WHEN k < 85 THEN ARRAY[60] WHEN k < 95 THEN ARRAY[1440] ELSE ARRAY[10, 60, 1440] END) m;

\echo === исключения вхождений: у 10% серий
INSERT INTO occurrence_overrides (note_id, original_start, title, is_cancelled)
SELECT id, start_at + CASE recurrence_freq WHEN 'daily' THEN interval '2 days' WHEN 'weekly' THEN interval '14 days' ELSE interval '1 month' END,
       CASE WHEN id % 2 = 0 THEN title || ' (перенос)' END, id % 2 = 1
FROM notes WHERE recurrence_freq <> 'none' AND id % 10 = 0;

\echo === журнал доставок за 12 месяцев (по первому вхождению прошедших заметок), email пользователя
INSERT INTO reminder_deliveries (note_id, original_start, offset_minutes, fire_at, occurrence_start, title, status, late,
                                 attempts, email_to, created_at, sent_at)
SELECT n.id, n.start_at, r.offset_minutes, n.start_at - make_interval(mins => r.offset_minutes), n.start_at, n.title,
       CASE WHEN x < 0.92 THEN 'sent' WHEN x < 0.93 THEN 'failed' WHEN x < 0.96 THEN 'missed' ELSE 'no_email' END,
       x > 0.98, CASE WHEN x < 0.92 THEN 1 WHEN x < 0.93 THEN 5 ELSE 0 END,
       CASE WHEN x < 0.93 THEN u.email END,
       n.start_at - make_interval(mins => r.offset_minutes),
       CASE WHEN x < 0.92 THEN n.start_at - make_interval(mins => r.offset_minutes) + interval '3 seconds' END
FROM notes n JOIN note_reminders r ON r.note_id = n.id JOIN lt_owner o ON o.note_id = n.id JOIN lt_users u USING (uid),
     LATERAL (SELECT random() + 0 * n.id AS x) z  -- коррелированный: иначе random() вычисляется один раз
WHERE n.start_at < now() AND n.is_active AND n.deleted_at IS NULL;
UPDATE scheduler_state SET last_scan_at = now();

\echo === индексы (те же определения, что в миграциях)
CREATE INDEX ix_notes_deleted_start ON notes (deleted_at, start_at);
CREATE INDEX ix_notes_updated_at ON notes (updated_at);
CREATE INDEX ix_note_tags_tag_id ON note_tags (tag_id);
CREATE INDEX ix_notes_title_trgm ON notes USING gin (title gin_trgm_ops);
CREATE INDEX ix_notes_body_trgm ON notes USING gin (body gin_trgm_ops);
VACUUM ANALYZE;

\echo === итог
SELECT (SELECT count(*) FROM notes) AS notes, (SELECT count(*) FROM note_tags) AS note_tags,
       (SELECT count(*) FROM note_reminders) AS reminders, (SELECT count(*) FROM reminder_deliveries) AS deliveries,
       (SELECT count(*) FROM occurrence_overrides) AS overrides,
       pg_size_pretty(pg_database_size(current_database())) AS db_size;
