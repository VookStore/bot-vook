-- CreateTable
CREATE TABLE "ScriptLicense" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "keyHash" TEXT NOT NULL,
    "keyCipher" TEXT NOT NULL,
    "keySuffix" TEXT NOT NULL,
    "startsOnUse" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "installationHash" TEXT,
    "resource" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptLicenseEvent" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dedupe" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lockToken" TEXT,

    CONSTRAINT "ScriptLicenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScriptLicense_keyHash_key" ON "ScriptLicense"("keyHash");

-- CreateIndex
CREATE INDEX "ScriptLicense_guildId_ownerId_createdAt_idx" ON "ScriptLicense"("guildId", "ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptLicense_state_expiresAt_idx" ON "ScriptLicense"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptLicenseEvent_dedupe_key" ON "ScriptLicenseEvent"("dedupe");

-- CreateIndex
CREATE INDEX "ScriptLicenseEvent_deliveredAt_failedAt_lockedUntil_idx" ON "ScriptLicenseEvent"("deliveredAt", "failedAt", "lockedUntil");

-- AddForeignKey
ALTER TABLE "ScriptLicenseEvent" ADD CONSTRAINT "ScriptLicenseEvent_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "ScriptLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
