CREATE TABLE "catalog_forum_posts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "forumId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_forum_posts_packId_fkey" FOREIGN KEY ("packId") REFERENCES "catalog_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "catalog_forum_posts_threadId_key" ON "catalog_forum_posts"("threadId");
CREATE UNIQUE INDEX "catalog_forum_posts_guildId_packId_key" ON "catalog_forum_posts"("guildId", "packId");
CREATE INDEX "catalog_forum_posts_guildId_forumId_idx" ON "catalog_forum_posts"("guildId", "forumId");
