import type { AspectRatioMode, Prisma } from "@prisma/client";

import type { SourceMedia } from "@/lib/adapters/types";

export type VariantArtifact = {
  path: string;
  width: number;
  height: number;
  durationSec?: number;
  aspect: AspectRatioMode;
};

export type MediaArtifacts = {
  /** Downloaded originals (kept until retention cleanup). */
  sources: string[];
  /** Rendered video variants keyed by variant key (see variantKey()). */
  variants: Record<string, VariantArtifact>;
  /** Normalized carousel/photo files. */
  images: string[];
  audio?: string | null;
  thumbnail?: string | null;
};

export const EMPTY_ARTIFACTS: MediaArtifacts = { sources: [], variants: {}, images: [] };

export function variantKey(
  aspect: AspectRatioMode,
  fill: string,
  maxDurationSec?: number | null,
): string {
  return `${aspect}_${fill}_${maxDurationSec ?? "full"}`.toLowerCase();
}

export function parseArtifacts(value: Prisma.JsonValue | null | undefined): MediaArtifacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_ARTIFACTS };
  const record = value as Record<string, unknown>;
  const variantsRaw = record.variants;
  const variants: Record<string, VariantArtifact> = {};

  if (variantsRaw && typeof variantsRaw === "object" && !Array.isArray(variantsRaw)) {
    for (const [key, variant] of Object.entries(variantsRaw as Record<string, unknown>)) {
      if (variant && typeof variant === "object") {
        const v = variant as Record<string, unknown>;
        if (typeof v.path === "string") {
          variants[key] = {
            path: v.path,
            width: typeof v.width === "number" ? v.width : 0,
            height: typeof v.height === "number" ? v.height : 0,
            durationSec: typeof v.durationSec === "number" ? v.durationSec : undefined,
            aspect: (typeof v.aspect === "string" ? v.aspect : "SOURCE") as AspectRatioMode,
          };
        }
      }
    }
  }

  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : [];

  return {
    sources: strings(record.sources),
    variants,
    images: strings(record.images),
    audio: typeof record.audio === "string" ? record.audio : null,
    thumbnail: typeof record.thumbnail === "string" ? record.thumbnail : null,
  };
}

export function toJson(artifacts: MediaArtifacts): Prisma.InputJsonValue {
  return artifacts as unknown as Prisma.InputJsonValue;
}

export function parseSourceMedia(value: Prisma.JsonValue | null | undefined): SourceMedia[] {
  if (!Array.isArray(value)) return [];
  const media: SourceMedia[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string") continue;
    const kind = record.kind === "image" || record.kind === "audio" ? record.kind : "video";
    media.push({
      url: record.url,
      kind,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
    });
  }
  return media;
}
