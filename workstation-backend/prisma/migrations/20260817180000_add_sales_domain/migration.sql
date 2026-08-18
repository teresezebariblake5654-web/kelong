-- CreateEnum
CREATE TYPE "SalesProspectStatus" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP', 'HANDOFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SalesMessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SalesMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "SalesActivityType" AS ENUM ('PROSPECT_CREATED', 'MESSAGE_QUEUED', 'MESSAGE_SENT', 'MESSAGE_FAILED', 'MESSAGE_RECEIVED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "SalesProspect" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadCompanyId" TEXT NOT NULL,
    "leadContactId" TEXT,
    "status" "SalesProspectStatus" NOT NULL DEFAULT 'NEW',
    "preferredChannel" "SalesChannel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "externalThreadId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "SalesMessageDirection" NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "status" "SalesMessageStatus" NOT NULL,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "providerMetadata" JSONB,
    "idempotencyKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" "SalesActivityType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesProspect_organizationId_leadCompanyId_key" ON "SalesProspect"("organizationId", "leadCompanyId");

-- CreateIndex
CREATE INDEX "SalesProspect_organizationId_status_idx" ON "SalesProspect"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SalesProspect_leadContactId_idx" ON "SalesProspect"("leadContactId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesConversation_organizationId_prospectId_channel_key" ON "SalesConversation"("organizationId", "prospectId", "channel");

-- CreateIndex
CREATE INDEX "SalesConversation_organizationId_channel_externalThreadId_idx" ON "SalesConversation"("organizationId", "channel", "externalThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesMessage_organizationId_channel_providerMessageId_key" ON "SalesMessage"("organizationId", "channel", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesMessage_organizationId_idempotencyKey_key" ON "SalesMessage"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SalesMessage_organizationId_conversationId_createdAt_idx" ON "SalesMessage"("organizationId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesActivity_organizationId_prospectId_createdAt_idx" ON "SalesActivity"("organizationId", "prospectId", "createdAt");

-- AddForeignKey
ALTER TABLE "SalesProspect" ADD CONSTRAINT "SalesProspect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesProspect" ADD CONSTRAINT "SalesProspect_leadCompanyId_fkey" FOREIGN KEY ("leadCompanyId") REFERENCES "LeadCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesProspect" ADD CONSTRAINT "SalesProspect_leadContactId_fkey" FOREIGN KEY ("leadContactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesConversation" ADD CONSTRAINT "SalesConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesConversation" ADD CONSTRAINT "SalesConversation_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "SalesProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SalesConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "SalesProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
