-- CreateEnum
CREATE TYPE "SalesAgentRunTrigger" AS ENUM ('INITIAL_OUTREACH', 'INBOUND_REPLY', 'SCHEDULED_FOLLOWUP', 'MANUAL');

-- CreateEnum
CREATE TYPE "SalesAgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "SalesActivityType" ADD VALUE 'AGENT_DECISION';
ALTER TYPE "SalesActivityType" ADD VALUE 'HANDOFF';

-- AlterTable
ALTER TABLE "SalesProspect" ADD COLUMN "nextFollowUpAt" TIMESTAMP(3),
ADD COLUMN "handoff" JSONB,
ADD COLUMN "lastOutboundAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SalesAgentProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Sales Representative',
    "companyDescription" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "targetCustomerDescription" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "language" TEXT NOT NULL DEFAULT 'en',
    "salesInstructions" TEXT,
    "handoffInstructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "profileId" TEXT,
    "trigger" "SalesAgentRunTrigger" NOT NULL,
    "triggerInboundMessageId" TEXT,
    "decision" JSONB,
    "inputRefs" JSONB,
    "model" TEXT,
    "status" "SalesAgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SalesAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesAgentProfile_organizationId_isActive_idx" ON "SalesAgentProfile"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAgentRun_organizationId_triggerInboundMessageId_key" ON "SalesAgentRun"("organizationId", "triggerInboundMessageId");

-- CreateIndex
CREATE INDEX "SalesAgentRun_organizationId_prospectId_createdAt_idx" ON "SalesAgentRun"("organizationId", "prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesAgentRun_organizationId_status_idx" ON "SalesAgentRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SalesProspect_organizationId_nextFollowUpAt_idx" ON "SalesProspect"("organizationId", "nextFollowUpAt");

-- AddForeignKey
ALTER TABLE "SalesAgentProfile" ADD CONSTRAINT "SalesAgentProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAgentRun" ADD CONSTRAINT "SalesAgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAgentRun" ADD CONSTRAINT "SalesAgentRun_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "SalesProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAgentRun" ADD CONSTRAINT "SalesAgentRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "SalesAgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
