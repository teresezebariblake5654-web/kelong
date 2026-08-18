-- AlterEnum
ALTER TYPE "LeadSearchTaskStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "LeadSearchTask" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "LeadSearchTask" ADD COLUMN "cancelledAt" TIMESTAMP(3);
