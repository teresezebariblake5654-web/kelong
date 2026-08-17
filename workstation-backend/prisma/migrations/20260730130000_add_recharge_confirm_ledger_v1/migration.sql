-- AlterEnum (safe if already present)
DO $$ BEGIN
  ALTER TYPE "CreditLedgerType" ADD VALUE 'RECHARGE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable CreditAccount
ALTER TABLE "CreditAccount" ADD COLUMN IF NOT EXISTS "totalRecharged" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CreditAccount" ADD COLUMN IF NOT EXISTS "totalConsumed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable CreditLedger
ALTER TABLE "CreditLedger" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "CreditLedger" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedger_sourceType_sourceId_key" ON "CreditLedger"("sourceType", "sourceId");
