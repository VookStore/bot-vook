-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('CREATING', 'OPEN', 'CLAIMED', 'CLOSING', 'CLOSED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT', 'VIP');

-- CreateEnum
CREATE TYPE "TicketAuditAction" AS ENUM ('CREATED', 'CLAIMED', 'UNCLAIMED', 'TRANSFERRED', 'RENAMED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'CLIENT_NOTIFIED', 'CLOSED', 'ORPHANED', 'RECOVERED', 'PRIORITY_CHANGED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentAuditAction" AS ENUM ('CREATED', 'COUPON_APPLIED', 'COUPON_CHANGED', 'COUPON_REMOVED', 'AMOUNT_CHANGED', 'APPROVED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PixKeyType" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "CouponAuditAction" AS ENUM ('CREATED', 'UPDATED', 'ENABLED', 'DISABLED', 'DELETED', 'RESTORED', 'APPLIED_TO_PAYMENT', 'REMOVED_FROM_PAYMENT', 'USED');

-- CreateEnum
CREATE TYPE "SystemLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "guild_configs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "storeName" TEXT NOT NULL DEFAULT 'Vook Store',
    "ticketPanelChannelId" TEXT,
    "ticketPanelMessageId" TEXT,
    "ticketLogChannelId" TEXT,
    "welcomeChannelId" TEXT,
    "reviewChannelId" TEXT,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeBannerUrl" TEXT,
    "autoRoleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRoleId" TEXT,
    "panelTitle" TEXT NOT NULL DEFAULT 'VOOK STORE - CENTRAL DE ATENDIMENTO',
    "panelDescription" TEXT NOT NULL DEFAULT 'Bem-vindo a nossa central de atendimento.',
    "panelThumbnailUrl" TEXT,
    "panelBannerUrl" TEXT,
    "panelNotice" TEXT,
    "maxOpenTicketsPerUser" INTEGER NOT NULL DEFAULT 2,
    "maxOpenTicketsGuild" INTEGER NOT NULL DEFAULT 100,
    "ticketCreateCooldownSeconds" INTEGER NOT NULL DEFAULT 60,
    "clientNotifyCooldownSeconds" INTEGER NOT NULL DEFAULT 300,
    "renameCooldownSeconds" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_counters" (
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_counters_pkey" PRIMARY KEY ("guildId","name")
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "discordCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_team_roles" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ticket_team_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "channelId" TEXT,
    "channelName" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'CREATING',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "panelMessageId" TEXT,
    "lastClientNotifyAt" TIMESTAMP(3),
    "lastRenamedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_participants" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_transfers" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStaffId" TEXT,
    "toStaffId" TEXT NOT NULL,
    "transferredById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "action" "TicketAuditAction" NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_reviews" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "staffId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewChannelId" TEXT,
    "reviewMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "description" TEXT,
    "receiverName" TEXT NOT NULL,
    "pixKey" TEXT NOT NULL,
    "pixKeyType" "PixKeyType" NOT NULL,
    "city" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultExpirationMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "finalAmount" INTEGER NOT NULL,
    "couponId" TEXT,
    "couponCodeSnapshot" TEXT,
    "couponTypeSnapshot" "CouponType",
    "couponValueSnapshot" INTEGER,
    "pixPayload" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "channelId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "action" "PaymentAuditAction" NOT NULL,
    "actorId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minimumAmount" INTEGER,
    "maximumDiscount" INTEGER,
    "maxUses" INTEGER,
    "maxUsesPerCustomer" INTEGER,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usages" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "action" "CouponAuditAction" NOT NULL,
    "actorId" TEXT,
    "paymentId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_error_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "level" "SystemLogLevel" NOT NULL,
    "module" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "system_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_configs_guildId_key" ON "guild_configs"("guildId");

-- CreateIndex
CREATE INDEX "ticket_categories_guildId_enabled_position_idx" ON "ticket_categories"("guildId", "enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_categories_guildId_identifier_key" ON "ticket_categories"("guildId", "identifier");

-- CreateIndex
CREATE INDEX "ticket_team_roles_guildId_idx" ON "ticket_team_roles"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_team_roles_categoryId_roleId_key" ON "ticket_team_roles"("categoryId", "roleId");

-- CreateIndex
CREATE INDEX "tickets_guildId_categoryId_status_claimedById_priority_tick_idx" ON "tickets"("guildId", "categoryId", "status", "claimedById", "priority", "ticketNumber");

-- CreateIndex
CREATE INDEX "tickets_guildId_status_idx" ON "tickets"("guildId", "status");

-- CreateIndex
CREATE INDEX "tickets_guildId_ownerId_status_idx" ON "tickets"("guildId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "tickets_guildId_claimedById_status_idx" ON "tickets"("guildId", "claimedById", "status");

-- CreateIndex
CREATE INDEX "tickets_guildId_createdAt_idx" ON "tickets"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_guildId_ticketNumber_key" ON "tickets"("guildId", "ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_channelId_key" ON "tickets"("channelId");

-- CreateIndex
CREATE INDEX "ticket_participants_guildId_userId_idx" ON "ticket_participants"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_participants_ticketId_userId_key" ON "ticket_participants"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "ticket_transfers_guildId_ticketId_idx" ON "ticket_transfers"("guildId", "ticketId");

-- CreateIndex
CREATE INDEX "ticket_audit_logs_guildId_ticketId_createdAt_idx" ON "ticket_audit_logs"("guildId", "ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_audit_logs_guildId_action_createdAt_idx" ON "ticket_audit_logs"("guildId", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reviews_ticketId_key" ON "ticket_reviews"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_reviews_guildId_createdAt_idx" ON "ticket_reviews"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_reviews_guildId_staffId_idx" ON "ticket_reviews"("guildId", "staffId");

-- CreateIndex
CREATE INDEX "ticket_reviews_guildId_rating_idx" ON "ticket_reviews"("guildId", "rating");

-- CreateIndex
CREATE INDEX "payment_accounts_guildId_enabled_idx" ON "payment_accounts"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_guildId_identifier_key" ON "payment_accounts"("guildId", "identifier");

-- CreateIndex
CREATE INDEX "payments_guildId_status_expiresAt_idx" ON "payments"("guildId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "payments_guildId_customerId_status_idx" ON "payments"("guildId", "customerId", "status");

-- CreateIndex
CREATE INDEX "payments_guildId_createdAt_idx" ON "payments"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_couponId_idx" ON "payments"("couponId");

-- CreateIndex
CREATE INDEX "payment_audit_logs_guildId_paymentId_createdAt_idx" ON "payment_audit_logs"("guildId", "paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_audit_logs_guildId_action_createdAt_idx" ON "payment_audit_logs"("guildId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "coupons_guildId_enabled_deletedAt_idx" ON "coupons"("guildId", "enabled", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_guildId_code_key" ON "coupons"("guildId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_usages_paymentId_key" ON "coupon_usages"("paymentId");

-- CreateIndex
CREATE INDEX "coupon_usages_couponId_customerId_idx" ON "coupon_usages"("couponId", "customerId");

-- CreateIndex
CREATE INDEX "coupon_usages_guildId_usedAt_idx" ON "coupon_usages"("guildId", "usedAt");

-- CreateIndex
CREATE INDEX "coupon_audit_logs_guildId_couponId_createdAt_idx" ON "coupon_audit_logs"("guildId", "couponId", "createdAt");

-- CreateIndex
CREATE INDEX "coupon_audit_logs_guildId_action_createdAt_idx" ON "coupon_audit_logs"("guildId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "system_error_logs_level_createdAt_idx" ON "system_error_logs"("level", "createdAt");

-- CreateIndex
CREATE INDEX "system_error_logs_guildId_createdAt_idx" ON "system_error_logs"("guildId", "createdAt");

-- AddForeignKey
ALTER TABLE "ticket_team_roles" ADD CONSTRAINT "ticket_team_roles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_audit_logs" ADD CONSTRAINT "ticket_audit_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_reviews" ADD CONSTRAINT "ticket_reviews_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usages" ADD CONSTRAINT "coupon_usages_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_audit_logs" ADD CONSTRAINT "coupon_audit_logs_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

