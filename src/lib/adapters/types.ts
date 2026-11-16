/**
 * Platform adapter contracts. Adapters are the only place that knows a
 * provider's HTTP API; the pipeline only sees SourcePost / PublishRequest.
 */
import type {
  AspectRatioMode,
  Connection,
  ContentItem,
  FillMode,
  MediaType,
  WorkflowDestination,
} from "@prisma/client";

export type MediaKind = "video" | "short_video" | "story" | "photo" | "carousel" | "audio";

export type SourceMedia = {
  url: string;
  kind: "video" | "image" | "audio";
  mimeType?: string;
};

export type SourcePost = {
  /** Stable provider id — the dedupe key. */
  id: string;
  url?: string;
  mediaType: MediaKind;
  title?: string;
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  thumbnailUrl?: string;
  durationSec?: number;
  publishedAt?: Date;
  media: SourceMedia[];
  raw?: unknown;
};

export type SourceListOptions = {
  /** Only return posts published at/after this instant (null = full backlog). */
  since?: Date | null;
  limit?: number;
  /** Provider collection hint: folder id, playlist id, feed url… */
  collection?: string | null;
};

export type AdapterCheck = { ok: boolean; detail: string };

export interface SourceAdapter {
  readonly provider: string;
  listRecent(options?: SourceListOptions): Promise<SourcePost[]>;
  testConnection(): Promise<AdapterCheck>;
}

export type RenderedMedia = {
  videoPath?: string;
  imagePaths?: string[];
  audioPath?: string;
  thumbnailPath?: string;
  aspectRatio?: AspectRatioMode;
  fillMode?: FillMode;
};

export type PublishRequest = {
  connection: Connection;
  destination: WorkflowDestination;
  contentItem: ContentItem;
  media: RenderedMedia;
  title: string;
  caption: string;
  firstComment?: string;
};

export type PublishResult = {
  remotePostId: string;
  remoteUrl?: string;
  metadata?: Record<string, unknown>;
};

export interface DestinationAdapter {
  readonly provider: string;
  publish(request: PublishRequest): Promise<PublishResult>;
  testConnection(): Promise<AdapterCheck>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export class UnsupportedProviderError extends AdapterError {
  constructor(provider: string, role: "source" | "destination") {
    super(
      `${provider} is not available as a ${role} yet. This build ships complete TikTok (source), YouTube and Google Drive (destination) adapters.`,
      provider,
    );
    this.name = "UnsupportedProviderError";
  }
}

const KIND_TO_MEDIA_TYPE: Record<MediaKind, MediaType> = {
  video: "VIDEO",
  short_video: "SHORT_VIDEO",
  story: "STORY",
  photo: "PHOTO",
  carousel: "CAROUSEL",
  audio: "AUDIO",
};

const MEDIA_TYPE_TO_KIND: Partial<Record<MediaType, MediaKind>> = {
  VIDEO: "video",
  SHORT_VIDEO: "short_video",
  STORY: "story",
  PHOTO: "photo",
  CAROUSEL: "carousel",
  AUDIO: "audio",
};

export function mediaKindToType(kind: MediaKind): MediaType {
  return KIND_TO_MEDIA_TYPE[kind];
}

export function mediaTypeToKind(type: MediaType): MediaKind | null {
  return MEDIA_TYPE_TO_KIND[type] ?? null;
}

/**
 * Provider HTTP helpers — every failure carries provider + response body so
 * /logs shows something actionable instead of "fetch failed".
 */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit,
  context: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new AdapterError(
      `${provider}: ${context} request failed`,
      provider,
      error instanceof Error ? error.message : String(error),
    );
  }
  return response;
}

export async function readJson<T>(provider: string, response: Response, context: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new AdapterError(
      `${provider}: ${context} failed with HTTP ${response.status}`,
      provider,
      text.slice(0, 2000),
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdapterError(`${provider}: ${context} returned non-JSON`, provider, text.slice(0, 500));
  }
}
