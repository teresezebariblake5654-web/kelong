-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('UNACTIVATED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');
CREATE TYPE "ProductType" AS ENUM ('HR_AGENT', 'PRODUCTION_AGENT', 'LOGISTICS_AGENT', 'UNIVERSAL_AGENT');
CREATE TYPE "PlanType" AS ENUM ('DEVICE_PRODUCT', 'PRO_MONTHLY', 'PRO_YEARLY', 'CREDIT_PACK');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CLOSED', 'REFUNDED', 'FAILED');
CREATE TYPE "AiUsageStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');
CREATE TYPE "CreditTransactionType" AS ENUM (
  'PURCHASE',
  'SUBSCRIPTION_GRANT',
  'CONSUME',
  'REFUND',
  'ADMIN_ADJUSTMENT',
  'PROMOTION',
  'RESERVE',
  'RELEASE'
);

-- CreateTable
CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PlanType" NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "billingCycle" TEXT NOT NULL,
  "includedCredits" INTEGER NOT NULL DEFAULT 0,
  "allowedProductTypes" "ProductType"[],
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "License" (
  "id" TEXT NOT NULL,
  "licenseCodeHash" TEXT NOT NULL,
  "productType" "ProductType" NOT NULL,
  "status" "LicenseStatus" NOT NULL DEFAULT 'UNACTIVATED',
  "planId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceBinding" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "usbFingerprintHash" TEXT NOT NULL,
  "deviceFingerprintHash" TEXT NOT NULL,
  "deviceName" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditWallet" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "reservedBalance" INTEGER NOT NULL DEFAULT 0,
  "totalPurchased" INTEGER NOT NULL DEFAULT 0,
  "totalGranted" INTEGER NOT NULL DEFAULT 0,
  "totalConsumed" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "currentPeriodStart" TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "orderType" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "paymentProvider" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerTransactionId" TEXT NOT NULL,
  "webhookEventId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "rawPayloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiUsage" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "providerCostMicros" BIGINT NOT NULL DEFAULT 0,
  "creditsReserved" INTEGER NOT NULL DEFAULT 0,
  "creditsCharged" INTEGER NOT NULL DEFAULT 0,
  "status" "AiUsageStatus" NOT NULL DEFAULT 'PENDING',
  "requestId" TEXT NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "agentType" "ProductType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "creditCost" INTEGER NOT NULL,
  "modelConfig" JSONB NOT NULL,
  "promptTemplate" TEXT NOT NULL,
  "inputSchema" JSONB NOT NULL,
  "outputSchema" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- Extend the existing ledger without replacing legacy relations.
ALTER TABLE "CreditTransaction"
  ADD COLUMN "licenseId" TEXT,
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "usageId" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "idempotencyKey" TEXT;

UPDATE "CreditTransaction"
SET
  "description" = "reason",
  "idempotencyKey" = 'legacy:' || "id";

ALTER TABLE "CreditTransaction"
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "CreditTransaction"
  ALTER COLUMN "type" TYPE "CreditTransactionType"
  USING (
    CASE lower("type")
      WHEN 'consume' THEN 'CONSUME'
      WHEN 'recharge' THEN 'ADMIN_ADJUSTMENT'
      WHEN 'purchase' THEN 'PURCHASE'
      WHEN 'refund' THEN 'REFUND'
      WHEN 'promotion' THEN 'PROMOTION'
      WHEN 'reserve' THEN 'RESERVE'
      WHEN 'release' THEN 'RELEASE'
      ELSE 'ADMIN_ADJUSTMENT'
    END
  )::"CreditTransactionType";

ALTER TABLE "CreditTransaction" DROP CONSTRAINT "CreditTransaction_userId_fkey";
ALTER TABLE "CreditTransaction"
  ADD CONSTRAINT "CreditTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique indexes
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE UNIQUE INDEX "License_licenseCodeHash_key" ON "License"("licenseCodeHash");
CREATE UNIQUE INDEX "DeviceBinding_licenseId_usbFingerprintHash_deviceFingerprintHash_key"
  ON "DeviceBinding"("licenseId", "usbFingerprintHash", "deviceFingerprintHash");
CREATE UNIQUE INDEX "CreditWallet_licenseId_key" ON "CreditWallet"("licenseId");
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "PaymentTransaction_providerTransactionId_key"
  ON "PaymentTransaction"("providerTransactionId");
CREATE UNIQUE INDEX "PaymentTransaction_webhookEventId_key"
  ON "PaymentTransaction"("webhookEventId");
CREATE UNIQUE INDEX "AiUsage_requestId_key" ON "AiUsage"("requestId");
CREATE UNIQUE INDEX "TaskTemplate_code_version_key" ON "TaskTemplate"("code", "version");
CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key"
  ON "CreditTransaction"("idempotencyKey");

-- Query indexes
CREATE INDEX "Plan_type_status_idx" ON "Plan"("type", "status");
CREATE INDEX "License_status_idx" ON "License"("status");
CREATE INDEX "License_planId_idx" ON "License"("planId");
CREATE INDEX "License_expiresAt_idx" ON "License"("expiresAt");
CREATE INDEX "DeviceBinding_licenseId_revokedAt_idx" ON "DeviceBinding"("licenseId", "revokedAt");
CREATE INDEX "Subscription_licenseId_status_idx" ON "Subscription"("licenseId", "status");
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");
CREATE INDEX "Order_licenseId_createdAt_idx" ON "Order"("licenseId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "PaymentTransaction_orderId_idx" ON "PaymentTransaction"("orderId");
CREATE INDEX "PaymentTransaction_provider_status_idx" ON "PaymentTransaction"("provider", "status");
CREATE INDEX "AiUsage_licenseId_createdAt_idx" ON "AiUsage"("licenseId", "createdAt");
CREATE INDEX "AiUsage_status_createdAt_idx" ON "AiUsage"("status", "createdAt");
CREATE INDEX "TaskTemplate_agentType_enabled_idx" ON "TaskTemplate"("agentType", "enabled");
CREATE INDEX "TaskTemplate_code_enabled_idx" ON "TaskTemplate"("code", "enabled");
CREATE INDEX "CreditTransaction_licenseId_createdAt_idx" ON "CreditTransaction"("licenseId", "createdAt");
CREATE INDEX "CreditTransaction_orderId_idx" ON "CreditTransaction"("orderId");
CREATE INDEX "CreditTransaction_usageId_idx" ON "CreditTransaction"("usageId");

-- Foreign keys
ALTER TABLE "License"
  ADD CONSTRAINT "License_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceBinding"
  ADD CONSTRAINT "DeviceBinding_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditWallet"
  ADD CONSTRAINT "CreditWallet_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiUsage"
  ADD CONSTRAINT "AiUsage_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction"
  ADD CONSTRAINT "CreditTransaction_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction"
  ADD CONSTRAINT "CreditTransaction_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction"
  ADD CONSTRAINT "CreditTransaction_usageId_fkey"
  FOREIGN KEY ("usageId") REFERENCES "AiUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
