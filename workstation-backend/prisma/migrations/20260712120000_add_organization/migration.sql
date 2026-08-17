-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");

ALTER TABLE "OrganizationMember"
  ADD CONSTRAINT "OrganizationMember_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationMember"
  ADD CONSTRAINT "OrganizationMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add nullable organizationId columns first
ALTER TABLE "File" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Report" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "CreditTransaction" ADD COLUMN "organizationId" TEXT;

-- Backfill: one default org per existing user (by userId order)
INSERT INTO "Organization" ("id", "name", "slug", "status", "plan", "createdAt", "updatedAt")
SELECT
  'org_' || u."id",
  u."username" || ' Org',
  'org-' || lower(regexp_replace(u."username", '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(u."id"), 1, 8),
  'active',
  COALESCE(u."vipLevel", 'free'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT DO NOTHING;

INSERT INTO "OrganizationMember" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT
  'mem_' || u."id",
  'org_' || u."id",
  u."id",
  'owner',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT DO NOTHING;

UPDATE "File" f
SET "organizationId" = 'org_' || f."userId"
WHERE f."organizationId" IS NULL;

UPDATE "Report" r
SET "organizationId" = 'org_' || r."userId"
WHERE r."organizationId" IS NULL;

UPDATE "UsageLog" l
SET "organizationId" = 'org_' || l."userId"
WHERE l."organizationId" IS NULL;

UPDATE "CreditTransaction" c
SET "organizationId" = 'org_' || c."userId"
WHERE c."organizationId" IS NULL;

-- Enforce NOT NULL on core business tables
ALTER TABLE "File" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Report" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "UsageLog" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "File_organizationId_idx" ON "File"("organizationId");
CREATE INDEX "Report_organizationId_idx" ON "Report"("organizationId");
CREATE INDEX "UsageLog_organizationId_idx" ON "UsageLog"("organizationId");
CREATE INDEX "CreditTransaction_organizationId_idx" ON "CreditTransaction"("organizationId");

ALTER TABLE "File"
  ADD CONSTRAINT "File_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Report"
  ADD CONSTRAINT "Report_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsageLog"
  ADD CONSTRAINT "UsageLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreditTransaction"
  ADD CONSTRAINT "CreditTransaction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
