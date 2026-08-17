ALTER TABLE "AiUsage"
  ALTER COLUMN "templateVersion" TYPE TEXT
  USING "templateVersion"::TEXT,
  ADD COLUMN "result" JSONB;

ALTER TABLE "TaskTemplate"
  ALTER COLUMN "version" TYPE TEXT
  USING "version"::TEXT;
