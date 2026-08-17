-- Legacy SQLite migration intentionally no-op on PostgreSQL.
-- Real schema is created by 20260710090000_init_postgresql.
-- If a local DB previously failed this migration, run once:
--   npx prisma migrate resolve --rolled-back 20260703023341_init
-- then: npx prisma migrate deploy
SELECT 1;
