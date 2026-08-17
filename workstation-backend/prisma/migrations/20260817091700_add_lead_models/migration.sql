-- CreateEnum
CREATE TYPE "LeadSearchTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "LeadSearchTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "LeadSearchTaskStatus" NOT NULL DEFAULT 'PENDING',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "searchResultsCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueDomainsCount" INTEGER NOT NULL DEFAULT 0,
    "researchedCount" INTEGER NOT NULL DEFAULT 0,
    "successfulCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCompany" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "normalizedName" TEXT,
    "domain" TEXT NOT NULL,
    "normalizedDomain" TEXT NOT NULL,
    "website" TEXT,
    "country" TEXT,
    "city" TEXT,
    "industry" TEXT,
    "description" TEXT,
    "linkedinUrl" TEXT,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT,
    "jobTitle" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "emailVerificationStatus" TEXT,
    "emailVerificationScore" INTEGER,
    "phone" TEXT,
    "whatsapp" TEXT,
    "linkedinUrl" TEXT,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSourceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "searchTaskId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "provider" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "rawData" JSONB,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSearchTask_organizationId_createdAt_idx" ON "LeadSearchTask"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadSearchTask_organizationId_status_idx" ON "LeadSearchTask"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LeadCompany_organizationId_idx" ON "LeadCompany"("organizationId");

-- CreateIndex
CREATE INDEX "LeadCompany_normalizedDomain_idx" ON "LeadCompany"("normalizedDomain");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCompany_organizationId_normalizedDomain_key" ON "LeadCompany"("organizationId", "normalizedDomain");

-- CreateIndex
CREATE INDEX "LeadContact_organizationId_idx" ON "LeadContact"("organizationId");

-- CreateIndex
CREATE INDEX "LeadContact_companyId_idx" ON "LeadContact"("companyId");

-- CreateIndex
CREATE INDEX "LeadContact_organizationId_emailNormalized_idx" ON "LeadContact"("organizationId", "emailNormalized");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_organizationId_retrievedAt_idx" ON "LeadSourceRecord"("organizationId", "retrievedAt");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_searchTaskId_idx" ON "LeadSourceRecord"("searchTaskId");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_companyId_idx" ON "LeadSourceRecord"("companyId");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_contactId_idx" ON "LeadSourceRecord"("contactId");

-- CreateIndex
CREATE INDEX "LeadSourceRecord_provider_sourceType_idx" ON "LeadSourceRecord"("provider", "sourceType");

-- AddForeignKey
ALTER TABLE "LeadSearchTask" ADD CONSTRAINT "LeadSearchTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCompany" ADD CONSTRAINT "LeadCompany_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "LeadCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceRecord" ADD CONSTRAINT "LeadSourceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceRecord" ADD CONSTRAINT "LeadSourceRecord_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "LeadSearchTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceRecord" ADD CONSTRAINT "LeadSourceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "LeadCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSourceRecord" ADD CONSTRAINT "LeadSourceRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
