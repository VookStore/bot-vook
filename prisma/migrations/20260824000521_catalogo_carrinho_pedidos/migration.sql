-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL_COMMAND', 'CATALOG_ORDER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'PAID', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OrderAuditAction" AS ENUM ('CART_CHECKOUT_STARTED', 'ORDER_CREATED', 'ORDER_COUPON_APPLIED', 'ORDER_COUPON_REMOVED', 'ORDER_PAYMENT_CREATED', 'ORDER_PAYMENT_EXPIRED', 'ORDER_PAYMENT_CANCELLED', 'ORDER_PAID', 'ORDER_IN_PROGRESS', 'ORDER_DELIVERED', 'ORDER_COMPLETED', 'ORDER_CANCELLED');

-- CreateEnum
CREATE TYPE "CatalogAuditAction" AS ENUM ('PACK_CREATED', 'PACK_UPDATED', 'PACK_ENABLED', 'PACK_DISABLED', 'PACK_FEATURED', 'PACK_UNFEATURED', 'PACK_DELETED', 'PACK_IMAGE_ADDED', 'PACK_IMAGE_REMOVED', 'PACK_IMAGE_REORDERED', 'PACK_COVER_CHANGED', 'PACK_DETAILS_UPDATED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_ENABLED', 'CATEGORY_DISABLED', 'CATEGORY_REORDERED', 'CATEGORY_DELETED');

-- AlterTable
ALTER TABLE "guild_configs" ADD COLUMN     "catalogBannerUrl" TEXT,
ADD COLUMN     "catalogChannelId" TEXT,
ADD COLUMN     "catalogDescription" TEXT NOT NULL DEFAULT 'Explore os packs disponíveis na **Vook Store**. Escolha uma categoria, navegue pelas imagens e adicione ao carrinho.',
ADD COLUMN     "catalogMessageId" TEXT,
ADD COLUMN     "catalogTitle" TEXT NOT NULL DEFAULT '🛍️ VOOK STORE — CATÁLOGO',
ADD COLUMN     "orderChannelId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" "PaymentSource" NOT NULL DEFAULT 'MANUAL_COMMAND';

-- CreateTable
CREATE TABLE "catalog_categories" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_packs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT,
    "shortDescription" TEXT,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "catalog_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_pack_details" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_pack_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_images" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pack_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "finalAmount" INTEGER NOT NULL,
    "couponId" TEXT,
    "couponCodeSnapshot" TEXT,
    "couponTypeSnapshot" "CouponType",
    "couponValueSnapshot" INTEGER,
    "paymentId" TEXT,
    "channelId" TEXT,
    "panelChannelId" TEXT,
    "panelMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "priceSnapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" "OrderAuditAction" NOT NULL,
    "performedById" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_audit_logs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "action" "CatalogAuditAction" NOT NULL,
    "packId" TEXT,
    "categoryId" TEXT,
    "imageId" TEXT,
    "actorId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_categories_guildId_enabled_position_idx" ON "catalog_categories"("guildId", "enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_categories_guildId_identifier_key" ON "catalog_categories"("guildId", "identifier");

-- CreateIndex
CREATE INDEX "catalog_packs_guildId_enabled_featured_position_idx" ON "catalog_packs"("guildId", "enabled", "featured", "position");

-- CreateIndex
CREATE INDEX "catalog_packs_guildId_categoryId_enabled_position_idx" ON "catalog_packs"("guildId", "categoryId", "enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_packs_guildId_slug_key" ON "catalog_packs"("guildId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_packs_guildId_sku_key" ON "catalog_packs"("guildId", "sku");

-- CreateIndex
CREATE INDEX "catalog_pack_details_packId_position_idx" ON "catalog_pack_details"("packId", "position");

-- CreateIndex
CREATE INDEX "pack_images_packId_position_idx" ON "pack_images"("packId", "position");

-- CreateIndex
CREATE INDEX "carts_guildId_customerId_status_idx" ON "carts"("guildId", "customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "carts_guildId_activeCustomerId_key" ON "carts"("guildId", "activeCustomerId");

-- CreateIndex
CREATE INDEX "cart_items_packId_idx" ON "cart_items"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_packId_key" ON "cart_items"("cartId", "packId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paymentId_key" ON "orders"("paymentId");

-- CreateIndex
CREATE INDEX "orders_guildId_status_createdAt_idx" ON "orders"("guildId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_guildId_customerId_createdAt_idx" ON "orders"("guildId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_guildId_createdAt_idx" ON "orders"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_couponId_idx" ON "orders"("couponId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_guildId_orderNumber_key" ON "orders"("guildId", "orderNumber");

-- CreateIndex
CREATE INDEX "order_items_packId_idx" ON "order_items"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_packId_key" ON "order_items"("orderId", "packId");

-- CreateIndex
CREATE INDEX "order_audit_logs_guildId_orderId_createdAt_idx" ON "order_audit_logs"("guildId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_audit_logs_guildId_action_createdAt_idx" ON "order_audit_logs"("guildId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "catalog_audit_logs_guildId_action_createdAt_idx" ON "catalog_audit_logs"("guildId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "catalog_audit_logs_guildId_packId_createdAt_idx" ON "catalog_audit_logs"("guildId", "packId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_sourceType_sourceId_idx" ON "payments"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "catalog_packs" ADD CONSTRAINT "catalog_packs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "catalog_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_pack_details" ADD CONSTRAINT "catalog_pack_details_packId_fkey" FOREIGN KEY ("packId") REFERENCES "catalog_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_images" ADD CONSTRAINT "pack_images_packId_fkey" FOREIGN KEY ("packId") REFERENCES "catalog_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_packId_fkey" FOREIGN KEY ("packId") REFERENCES "catalog_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_packId_fkey" FOREIGN KEY ("packId") REFERENCES "catalog_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_audit_logs" ADD CONSTRAINT "order_audit_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
