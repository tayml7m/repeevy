/**
 * Platform catalogue: the single source of truth for the Connections UI, the
 * OAuth routes and the adapter registry. Slugs are stable and used as
 * AppConfig keys (`oauth.tiktok`), adapter folder names and URL params.
 */

export type PlatformCategory = "video" | "social" | "cloud" | "audio";
export type AuthKind = "oauth" | "manual" | "rss";
export type MediaKind = "video" | "short_video" | "story" | "photo" | "carousel" | "audio";

export type PlatformDefinition = {
  slug: string;
  /** Prisma `Provider` enum value. */
  provider: string;
  label: string;
  category: PlatformCategory;
  auth: AuthKind;
  /** Short description of what the connection can do. */
  blurb: string;
  /** Media kinds this platform can deliver as a source. */
  source: MediaKind[];
  /** Media kinds this platform can receive as a destination. */
  destination: MediaKind[];
  /** Env var names checked before falling back to DB-stored credentials. */
  env: {
    clientId?: string[];
    clientSecret?: string[];
  };
  /** Documented OAuth scopes requested by the connect flow. */
  scopes: string[];
  /** Route the provider sends the browser back to (relative to APP_URL). */
  callbackPath: string;
  docsUrl: string;
  notes?: string;
  accent: string;
};

export const PLATFORMS: PlatformDefinition[] = [
  {
    slug: "tiktok",
    provider: "TIKTOK",
    label: "TikTok",
    category: "video",
    auth: "oauth",
    blurb: "Pull your TikToks as a source and publish short video to your profile.",
    source: ["short_video", "video", "photo", "carousel"],
    destination: ["short_video"],
    env: { clientId: ["TIKTOK_CLIENT_KEY"], clientSecret: ["TIKTOK_CLIENT_SECRET"] },
    scopes: ["user.info.basic", "user.info.profile", "video.list", "video.publish", "video.upload"],
    callbackPath: "/api/oauth/tiktok/callback",
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    notes: "TikTok's Content Posting API requires an audited app before direct publish is enabled.",
    accent: "#25F4EE",
  },
  {
    slug: "youtube",
    provider: "YOUTUBE",
    label: "YouTube",
    category: "video",
    auth: "oauth",
    blurb: "Long-form uploads and Shorts, with title/privacy/category rules.",
    source: ["video", "short_video"],
    destination: ["video", "short_video"],
    env: { clientId: ["GOOGLE_CLIENT_ID", "YOUTUBE_CLIENT_ID"], clientSecret: ["GOOGLE_CLIENT_SECRET", "YOUTUBE_CLIENT_SECRET"] },
    scopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      // Needed to repurpose the source first comment onto the upload.
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ],
    callbackPath: "/api/oauth/google/callback",
    docsUrl: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
    notes: "Videos are uploaded resumable; 'Shorts' simply means a 9:16 upload under 3 minutes.",
    accent: "#FF0033",
  },
  {
    slug: "instagram",
    provider: "INSTAGRAM",
    label: "Instagram",
    category: "social",
    auth: "oauth",
    blurb: "Reels, Stories, photos and carousels via the Instagram Graph API.",
    source: ["short_video", "story", "photo", "carousel"],
    destination: ["short_video", "story", "photo", "carousel"],
    env: { clientId: ["INSTAGRAM_APP_ID", "META_APP_ID"], clientSecret: ["INSTAGRAM_APP_SECRET", "META_APP_SECRET"] },
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"],
    callbackPath: "/api/oauth/meta/callback",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    notes:
      "Requires a Business/Creator account linked to a Facebook Page. Reels and Stories upload straight from disk via Meta's resumable upload (Facebook Login for Business).",
    accent: "#E1306C",
  },
  {
    slug: "facebook",
    provider: "FACEBOOK",
    label: "Facebook Pages",
    category: "social",
    auth: "oauth",
    blurb: "Publish Reels, Stories and photos to the Pages you administer.",
    source: ["video", "story", "photo", "carousel"],
    destination: ["video", "story", "photo", "carousel"],
    env: { clientId: ["FACEBOOK_APP_ID", "META_APP_ID"], clientSecret: ["FACEBOOK_APP_SECRET", "META_APP_SECRET"] },
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "publish_video"],
    callbackPath: "/api/oauth/meta/callback",
    docsUrl: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
    notes: "Publishes Reels (3–90 s) to a Page you administer; needs the CREATE_CONTENT task on that Page.",
    accent: "#1877F2",
  },
  {
    slug: "x",
    provider: "X",
    label: "X (Twitter)",
    category: "social",
    auth: "oauth",
    blurb: "Post video, photos and threads through the X API v2.",
    source: ["video", "photo"],
    destination: ["video", "photo"],
    env: { clientId: ["X_CLIENT_ID", "TWITTER_CLIENT_ID"], clientSecret: ["X_CLIENT_SECRET", "TWITTER_CLIENT_SECRET"] },
    scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
    callbackPath: "/api/oauth/x/callback",
    docsUrl: "https://docs.x.com/x-api/media/quickstart/media-upload-chunked",
    notes: "OAuth 2.0 with PKCE; media upload is chunked for videos.",
    accent: "#E7E9EA",
  },
  {
    slug: "linkedin",
    provider: "LINKEDIN",
    label: "LinkedIn",
    category: "social",
    auth: "oauth",
    blurb: "Share native video or images to your profile or a company page.",
    source: ["video", "photo"],
    destination: ["video", "photo"],
    env: { clientId: ["LINKEDIN_CLIENT_ID"], clientSecret: ["LINKEDIN_CLIENT_SECRET"] },
    scopes: ["openid", "profile", "w_member_social"],
    callbackPath: "/api/oauth/linkedin/callback",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api",
    accent: "#0A66C2",
  },
  {
    slug: "snapchat",
    provider: "SNAPCHAT",
    label: "Snapchat",
    category: "social",
    auth: "oauth",
    blurb: "Publish Stories and Spotlight submissions via the Marketing API.",
    source: ["story", "short_video"],
    destination: ["story", "short_video"],
    env: { clientId: ["SNAPCHAT_CLIENT_ID"], clientSecret: ["SNAPCHAT_CLIENT_SECRET"] },
    scopes: ["snapchat-marketing-api"],
    callbackPath: "/api/oauth/snapchat/callback",
    docsUrl: "https://developers.snap.com/api/marketing-api/Ads-API/introduction",
    notes: "Creator/Story publishing needs access to the Snapchat Marketing API programme.",
    accent: "#FFFC00",
  },
  {
    slug: "google-drive",
    provider: "GOOGLE_DRIVE",
    label: "Google Drive",
    category: "cloud",
    auth: "oauth",
    blurb: "Back up every repurposed asset to a Drive folder (great as a destination).",
    source: ["video", "photo", "audio"],
    destination: ["video", "photo", "audio"],
    env: { clientId: ["GOOGLE_CLIENT_ID"], clientSecret: ["GOOGLE_CLIENT_SECRET"] },
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    callbackPath: "/api/oauth/google/callback",
    docsUrl: "https://developers.google.com/drive/api/guides/manage-uploads",
    notes: "Uses drive.file, so the app only sees files it created or the folder you pick.",
    accent: "#1FA463",
  },
  {
    slug: "dropbox",
    provider: "DROPBOX",
    label: "Dropbox",
    category: "cloud",
    auth: "oauth",
    blurb: "Back up masters and exports into a Dropbox folder.",
    source: ["video", "photo", "audio"],
    destination: ["video", "photo", "audio"],
    env: { clientId: ["DROPBOX_APP_KEY"], clientSecret: ["DROPBOX_APP_SECRET"] },
    scopes: ["files.content.write", "files.content.read", "account_info.read"],
    callbackPath: "/api/oauth/dropbox/callback",
    docsUrl: "https://developers.dropbox.com/oauth-guide",
    accent: "#0061FF",
  },
  {
    slug: "podcast-rss",
    provider: "PODCAST_RSS",
    label: "Podcast RSS",
    category: "audio",
    auth: "rss",
    blurb: "Any public RSS feed as an audio source — render episodes onto video.",
    source: ["audio"],
    destination: [],
    env: {},
    scopes: [],
    callbackPath: "",
    docsUrl: "https://podcasters.apple.com/support/823-podcast-requirements",
    notes: "No OAuth: paste the feed URL. Enclosures are downloaded with yt-dlp/HTTP.",
    accent: "#A855F7",
  },
];

export const PLATFORM_BY_SLUG: Record<string, PlatformDefinition> = Object.fromEntries(
  PLATFORMS.map((platform) => [platform.slug, platform]),
);

export function getPlatform(slug: string): PlatformDefinition {
  const platform = PLATFORM_BY_SLUG[slug];
  if (!platform) throw new Error(`Unknown platform slug: ${slug}`);
  return platform;
}

const SLUG_BY_PROVIDER: Record<string, string> = {
  TIKTOK: "tiktok",
  YOUTUBE: "youtube",
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
  X: "x",
  LINKEDIN: "linkedin",
  SNAPCHAT: "snapchat",
  GOOGLE_DRIVE: "google-drive",
  DROPBOX: "dropbox",
  PODCAST_RSS: "podcast-rss",
  GOOGLE: "youtube",
};

/** Resolve a platform definition from a Prisma Provider enum value. */
export function platformForProvider(provider: string): PlatformDefinition | undefined {
  const slug = SLUG_BY_PROVIDER[provider];
  return slug ? PLATFORM_BY_SLUG[slug] : undefined;
}

export function providerLabel(provider: string): string {
  return platformForProvider(provider)?.label ?? provider;
}

/** Human labels for Prisma enums, shared by the UI. */
export const MEDIA_LABELS: Record<string, string> = {
  VIDEO: "Long-form video",
  SHORT_VIDEO: "Short video",
  STORY: "Story",
  PHOTO: "Photo",
  CAROUSEL: "Carousel",
  AUDIO: "Audio",
  ANY: "Any media",
};

export const STATUS_LABELS: Record<string, string> = {
  DETECTED: "Detected",
  DOWNLOADING: "Downloading",
  PROCESSING: "Processing",
  READY: "Ready",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  PARTIAL: "Partial",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};
