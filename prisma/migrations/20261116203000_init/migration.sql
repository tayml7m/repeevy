-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('TIKTOK', 'YOUTUBE', 'INSTAGRAM', 'FACEBOOK', 'X', 'LINKEDIN', 'SNAPCHAT', 'GOOGLE_DRIVE', 'DROPBOX', 'PODCAST_RSS', 'GOOGLE');

-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('OAUTH', 'MANUAL', 'RSS');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('VIDEO', 'SHORT_VIDEO', 'STORY', 'PHOTO', 'CAROUSEL', 'AUDIO', 'ANY');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('AUTO_PUBLISH', 'MANUAL_APPROVAL');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DETECTED', 'DOWNLOADING', 'PROCESSING', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('PENDING', 'PROCESSING', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('IMMEDIATE', 'DRIP');

-- CreateEnum
CREATE TYPE "PrivacyStatus" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "AspectRatioMode" AS ENUM ('SOURCE', 'PORTRAIT_9_16', 'LANDSCAPE_16_9', 'SQUARE_1_1');

-- CreateEnum
CREATE TYPE "FillMode" AS ENUM ('BLUR', 'CROP', 'PAD');

-- CreateEnum
CREATE TYPE "SubtitleMode" AS ENUM ('NONE', 'BURN_IN', 'AUTO_TRANSCRIBE');

-- CreateEnum
CREATE TYPE "AudioMode" AS ENUM ('KEEP', 'EXTRACT_MP3', 'WAVEFORM_VIDEO');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('INTRO', 'OUTRO', 'SUBTITLE', 'THUMBNAIL', 'AUDIO', 'OUTPUT');

-- CreateEnum
CREATE TYPE "StorageDriver" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('RESERVED', 'USED', 'RELEASED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('SYSTEM', 'AUTH_REFRESH', 'POLL', 'DEDUPE', 'DOWNLOAD', 'TRANSFORM', 'CAPTION', 'UPLOAD', 'SCHEDULE', 'PUBLISH', 'CLEANUP');

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "label" TEXT NOT NULL,
    "authType" "AuthType" NOT NULL DEFAULT 'OAUTH',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accountId" TEXT,
    "accountName" TEXT,
    "username" TEXT,
    "avatarUrl" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "canSource" BOOLEAN NOT NULL DEFAULT true,
    "canDestination" BOOLEAN NOT NULL DEFAULT true,
    "autoRefresh" BOOLEAN NOT NULL DEFAULT true,
    "lastRefreshedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sourceConnectionId" TEXT NOT NULL,
    "sourceMediaType" "MediaType" NOT NULL DEFAULT 'ANY',
    "sourceCollection" TEXT,
    "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "lastPolledAt" TIMESTAMP(3),
    "lastPollError" TEXT,
    "includeHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minDurationSec" INTEGER,
    "maxDurationSec" INTEGER,
    "importBacklog" BOOLEAN NOT NULL DEFAULT false,
    "backlogImportedAt" TIMESTAMP(3),
    "backlogSince" TIMESTAMP(3),
    "captionTemplate" TEXT,
    "firstCommentTemplate" TEXT,
    "captionPrefix" TEXT,
    "captionSuffix" TEXT,
    "stripHashtags" BOOLEAN NOT NULL DEFAULT false,
    "replaceHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preserveMentions" BOOLEAN NOT NULL DEFAULT true,
    "repurposeFirstComment" BOOLEAN NOT NULL DEFAULT false,
    "aspectRatio" "AspectRatioMode" NOT NULL DEFAULT 'SOURCE',
    "fillMode" "FillMode" NOT NULL DEFAULT 'BLUR',
    "trimStartSec" DOUBLE PRECISION,
    "trimEndSec" DOUBLE PRECISION,
    "trimMaxDurationSec" INTEGER,
    "prependIntroAssetId" TEXT,
    "appendOutroAssetId" TEXT,
    "subtitleMode" "SubtitleMode" NOT NULL DEFAULT 'NONE',
    "subtitleAssetId" TEXT,
    "audioMode" "AudioMode" NOT NULL DEFAULT 'KEEP',
    "mode" "AutomationMode" NOT NULL DEFAULT 'MANUAL_APPROVAL',
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'IMMEDIATE',
    "dripMaxPerDay" INTEGER,
    "dripTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDestination" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "targetMediaType" "MediaType" NOT NULL DEFAULT 'SHORT_VIDEO',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "captionTemplate" TEXT,
    "firstCommentTemplate" TEXT,
    "titleTemplate" TEXT,
    "privacyStatus" "PrivacyStatus",
    "categoryId" TEXT,
    "playlistId" TEXT,
    "folderPath" TEXT,
    "aspectRatio" "AspectRatioMode",
    "fillMode" "FillMode",
    "maxDurationSec" INTEGER,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sourceConnectionId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceCollection" TEXT,
    "mediaType" "MediaType" NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "firstComment" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnailUrl" TEXT,
    "durationSec" INTEGER,
    "mediaCount" INTEGER NOT NULL DEFAULT 1,
    "sourceMedia" JSONB,
    "sourcePublishedAt" TIMESTAMP(3),
    "status" "ContentStatus" NOT NULL DEFAULT 'DETECTED',
    "mode" "AutomationMode" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "artifacts" JSONB,
    "metadata" JSONB,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishTarget" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "TargetStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT,
    "caption" TEXT,
    "firstComment" TEXT,
    "remotePostId" TEXT,
    "remoteUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "storageDriver" "StorageDriver" NOT NULL DEFAULT 'LOCAL',
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "stage" "JobStage" NOT NULL,
    "message" TEXT NOT NULL,
    "workflowId" TEXT,
    "contentItemId" TEXT,
    "connectionId" TEXT,
    "targetId" TEXT,
    "queueJobId" TEXT,
    "attempt" INTEGER,
    "durationMs" INTEGER,
    "data" JSONB,
    "stack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_key_key" ON "AppConfig"("key");

-- CreateIndex
CREATE INDEX "AppConfig_isSecret_idx" ON "AppConfig"("isSecret");

-- CreateIndex
CREATE INDEX "Connection_provider_status_idx" ON "Connection"("provider", "status");

-- CreateIndex
CREATE INDEX "Connection_status_autoRefresh_tokenExpiresAt_idx" ON "Connection"("status", "autoRefresh", "tokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_provider_accountId_key" ON "Connection"("provider", "accountId");

-- CreateIndex
CREATE INDEX "Workflow_isActive_mode_idx" ON "Workflow"("isActive", "mode");

-- CreateIndex
CREATE INDEX "Workflow_isActive_lastPolledAt_idx" ON "Workflow"("isActive", "lastPolledAt");

-- CreateIndex
CREATE INDEX "Workflow_sourceConnectionId_idx" ON "Workflow"("sourceConnectionId");

-- CreateIndex
CREATE INDEX "WorkflowDestination_connectionId_idx" ON "WorkflowDestination"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDestination_workflowId_connectionId_targetMediaType_key" ON "WorkflowDestination"("workflowId", "connectionId", "targetMediaType");

-- CreateIndex
CREATE INDEX "ContentItem_status_detectedAt_idx" ON "ContentItem"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "ContentItem_workflowId_status_idx" ON "ContentItem"("workflowId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_scheduledFor_idx" ON "ContentItem"("scheduledFor");

-- CreateIndex
CREATE INDEX "ContentItem_sourceConnectionId_idx" ON "ContentItem"("sourceConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_workflowId_sourcePostId_key" ON "ContentItem"("workflowId", "sourcePostId");

-- CreateIndex
CREATE INDEX "PublishTarget_status_idx" ON "PublishTarget"("status");

-- CreateIndex
CREATE INDEX "PublishTarget_connectionId_status_idx" ON "PublishTarget"("connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PublishTarget_contentItemId_destinationId_key" ON "PublishTarget"("contentItemId", "destinationId");

-- CreateIndex
CREATE INDEX "ScheduleSlot_status_scheduledFor_idx" ON "ScheduleSlot"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduleSlot_workflowId_localDate_idx" ON "ScheduleSlot"("workflowId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSlot_workflowId_scheduledFor_key" ON "ScheduleSlot"("workflowId", "scheduledFor");

-- CreateIndex
CREATE INDEX "MediaAsset_workflowId_kind_idx" ON "MediaAsset"("workflowId", "kind");

-- CreateIndex
CREATE INDEX "JobLog_createdAt_idx" ON "JobLog"("createdAt");

-- CreateIndex
CREATE INDEX "JobLog_level_createdAt_idx" ON "JobLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "JobLog_contentItemId_createdAt_idx" ON "JobLog"("contentItemId", "createdAt");

-- CreateIndex
CREATE INDEX "JobLog_workflowId_createdAt_idx" ON "JobLog"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "JobLog_stage_createdAt_idx" ON "JobLog"("stage", "createdAt");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_prependIntroAssetId_fkey" FOREIGN KEY ("prependIntroAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_appendOutroAssetId_fkey" FOREIGN KEY ("appendOutroAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_subtitleAssetId_fkey" FOREIGN KEY ("subtitleAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDestination" ADD CONSTRAINT "WorkflowDestination_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDestination" ADD CONSTRAINT "WorkflowDestination_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishTarget" ADD CONSTRAINT "PublishTarget_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishTarget" ADD CONSTRAINT "PublishTarget_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "WorkflowDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishTarget" ADD CONSTRAINT "PublishTarget_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

