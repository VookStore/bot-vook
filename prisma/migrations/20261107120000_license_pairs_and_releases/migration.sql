-- Additive only. Do NOT update, reissue or reset existing licenses.
BEGIN;
CREATE TABLE "ScriptLicenseIssuance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ScriptLicenseIssuance_guildId_ownerId_product_key" ON "ScriptLicenseIssuance"("guildId", "ownerId", "product");
ALTER TABLE "ScriptLicense" ADD COLUMN "environment" TEXT, ADD COLUMN "issuanceId" TEXT;
ALTER TABLE "ScriptLicense" ADD CONSTRAINT "ScriptLicense_issuanceId_fkey" FOREIGN KEY ("issuanceId") REFERENCES "ScriptLicenseIssuance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScriptLicense" ADD CONSTRAINT "ScriptLicense_environment_check" CHECK (
  ("issuanceId" IS NULL AND "environment" IS NULL) OR
  ("issuanceId" IS NOT NULL AND "environment" IS NOT NULL AND "environment" IN ('TEST', 'PRODUCTION'))
);
CREATE UNIQUE INDEX "ScriptLicense_issuanceId_environment_key" ON "ScriptLicense"("issuanceId", "environment");
CREATE TABLE "ScriptRelease" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "archive" BYTEA NOT NULL,
  "fileCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "publishedById" TEXT,
  "withdrawnById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  CONSTRAINT "ScriptRelease_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN'))
);
CREATE UNIQUE INDEX "ScriptRelease_guildId_product_resource_version_key" ON "ScriptRelease"("guildId", "product", "resource", "version");
CREATE INDEX "ScriptRelease_guildId_product_status_publishedAt_idx" ON "ScriptRelease"("guildId", "product", "status", "publishedAt");
CREATE TABLE "ScriptDownload" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "licenseId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScriptDownload_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "ScriptLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScriptDownload_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ScriptRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ScriptDownload_licenseId_createdAt_idx" ON "ScriptDownload"("licenseId", "createdAt");
COMMIT;
