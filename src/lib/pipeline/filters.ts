/**
 * Content filters: media type, hashtags, keywords, duration and date window.
 * Pure functions so the same rules can be previewed in the UI later.
 */
import type { Workflow } from "@prisma/client";

import { mediaKindToType, type SourcePost } from "@/lib/adapters/types";
import { extractHashtags, normalizeHashtags } from "@/lib/pipeline/captions";

export type FilterVerdict = { pass: boolean; reason?: string };

function textOf(post: SourcePost): string {
  return `${post.title ?? ""}\n${post.caption ?? ""}`.toLowerCase();
}

function matchesAny(haystack: string[], needles: string[]): string | null {
  for (const needle of needles) {
    const value = needle.trim().toLowerCase().replace(/^#/, "");
    if (!value) continue;
    if (haystack.some((entry) => entry.replace(/^#/, "").toLowerCase() === value)) return needle;
  }
  return null;
}

export function evaluateSourcePost(
  workflow: Workflow,
  post: SourcePost,
  since?: Date | null,
): FilterVerdict {
  // Media type
  if (workflow.sourceMediaType !== "ANY" && workflow.sourceMediaType !== mediaKindToType(post.mediaType)) {
    return { pass: false, reason: `media type ${post.mediaType} does not match ${workflow.sourceMediaType}` };
  }

  // Date window (backlog imports pass since = null or the backlog cutoff)
  if (since && post.publishedAt && post.publishedAt < since) {
    return { pass: false, reason: "published before the workflow window" };
  }

  const hashtags = normalizeHashtags(post.hashtags ?? extractHashtags(post.caption));
  const text = textOf(post);

  if (workflow.includeHashtags.length > 0) {
    const hit = matchesAny(hashtags, workflow.includeHashtags);
    if (!hit) {
      return { pass: false, reason: `missing required hashtag (${workflow.includeHashtags.join(", ")})` };
    }
  }

  const excludedTag = matchesAny(hashtags, workflow.excludeHashtags);
  if (excludedTag) return { pass: false, reason: `excluded hashtag ${excludedTag}` };

  if (workflow.includeKeywords.length > 0) {
    const keywords = workflow.includeKeywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
    if (!keywords.some((keyword) => text.includes(keyword))) {
      return { pass: false, reason: "no include keyword matched" };
    }
  }

  for (const keyword of workflow.excludeKeywords) {
    const value = keyword.trim().toLowerCase();
    if (value && text.includes(value)) return { pass: false, reason: `excluded keyword "${value}"` };
  }

  if (post.durationSec != null) {
    if (workflow.minDurationSec != null && post.durationSec < workflow.minDurationSec) {
      return { pass: false, reason: `duration ${post.durationSec}s is below ${workflow.minDurationSec}s` };
    }
    if (workflow.maxDurationSec != null && post.durationSec > workflow.maxDurationSec) {
      return { pass: false, reason: `duration ${post.durationSec}s exceeds ${workflow.maxDurationSec}s` };
    }
  }

  return { pass: true };
}
