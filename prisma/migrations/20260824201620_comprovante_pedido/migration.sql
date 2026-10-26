-- CreateEnum
CREATE TYPE "ReceiptCheckStatus" AS ENUM ('MATCH', 'MISMATCH', 'UNREADABLE', 'SKIPPED');

-- CreateTable
CREATE TABLE "order_receipts" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "checkStatus" "ReceiptCheckStatus" NOT NULL,
    "detectedAmount" INTEGER,
    "detectedDate" TIMESTAMP(3),
    "checkNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_receipts_guildId_orderId_createdAt_idx" ON "order_receipts"("guildId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_receipts_guildId_createdAt_idx" ON "order_receipts"("guildId", "createdAt");

-- AddForeignKey
ALTER TABLE "order_receipts" ADD CONSTRAINT "order_receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
