-- CreateTable
CREATE TABLE IF NOT EXISTS "FeedbackSubmission" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contact" TEXT,
    "userId" TEXT,
    "userLabel" TEXT,
    "emailConsent" BOOLEAN NOT NULL DEFAULT true,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FeedbackSubmission_createdAt_idx" ON "FeedbackSubmission"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FeedbackSubmission_userId_idx" ON "FeedbackSubmission"("userId");
