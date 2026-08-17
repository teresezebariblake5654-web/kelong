-- CreateEnum
CREATE TYPE "LeadScoreGrade" AS ENUM ('A', 'B', 'C', 'D');

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "searchTaskId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "grade" "LeadScoreGrade" NOT NULL,
    "industryScore" INTEGER NOT NULL,
    "locationScore" INTEGER NOT NULL,
    "businessTypeScore" INTEGER NOT NULL,
    "productFitScore" INTEGER NOT NULL,
    "companyFitScore" INTEGER NOT NULL,
    "contactabilityScore" INTEGER NOT NULL,
    "reasoning" JSONB,
    "evidence" JSONB,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "scoringVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadScore_organizationId_idx" ON "LeadScore"("organizationId");

-- CreateIndex
CREATE INDEX "LeadScore_searchTaskId_idx" ON "LeadScore"("searchTaskId");

-- CreateIndex
CREATE INDEX "LeadScore_companyId_idx" ON "LeadScore"("companyId");

-- CreateIndex
CREATE INDEX "LeadScore_overallScore_idx" ON "LeadScore"("overallScore");

-- CreateIndex
CREATE INDEX "LeadScore_grade_idx" ON "LeadScore"("grade");

-- CreateIndex
CREATE INDEX "LeadScore_searchTaskId_grade_overallScore_idx" ON "LeadScore"("searchTaskId", "grade", "overallScore");

-- CreateIndex
CREATE UNIQUE INDEX "LeadScore_searchTaskId_companyId_key" ON "LeadScore"("searchTaskId", "companyId");

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "LeadSearchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "LeadCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
