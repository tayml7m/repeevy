import type { Connection } from "@prisma/client";

import { GoogleDriveDestination } from "@/lib/adapters/google-drive";
import { TikTokSourceAdapter } from "@/lib/adapters/tiktok";
import type { DestinationAdapter, SourceAdapter } from "@/lib/adapters/types";
import { UnsupportedProviderError } from "@/lib/adapters/types";
import { YouTubeDestination } from "@/lib/adapters/youtube";

/**
 * Adapter registry. Adding a platform means: implement the adapter class,
 * register it here, and describe it in src/lib/platforms.ts. Nothing in the
 * pipeline changes.
 */
export function sourceAdapterFor(connection: Connection): SourceAdapter {
  switch (connection.provider) {
    case "TIKTOK":
      return new TikTokSourceAdapter(connection);
    default:
      throw new UnsupportedProviderError(connection.provider, "source");
  }
}

export function destinationAdapterFor(connection: Connection): DestinationAdapter {
  switch (connection.provider) {
    case "YOUTUBE":
      return new YouTubeDestination(connection);
    case "GOOGLE_DRIVE":
      return new GoogleDriveDestination(connection);
    default:
      throw new UnsupportedProviderError(connection.provider, "destination");
  }
}

export const IMPLEMENTED = {
  sources: ["TIKTOK"],
  destinations: ["YOUTUBE", "GOOGLE_DRIVE"],
} as const;

export function isSourceImplemented(provider: string): boolean {
  return (IMPLEMENTED.sources as readonly string[]).includes(provider);
}

export function isDestinationImplemented(provider: string): boolean {
  return (IMPLEMENTED.destinations as readonly string[]).includes(provider);
}
