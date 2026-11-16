-- Per-item trim overrides from the queue UI.
ALTER TABLE "ContentItem"
  ADD COLUMN "trimStartSec" DOUBLE PRECISION,
  ADD COLUMN "trimEndSec" DOUBLE PRECISION;
