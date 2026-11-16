/**
 * Google Drive destination adapter — backups and cloud hand-off.
 *
 * Uses the drive.file scope, so it can only see files this app created or
 * folders it was explicitly pointed at. `destination.folderPath` accepts a
 * folder id, a Drive folder URL, or "root".
 */
import { stat } from "node:fs/promises";
import { extname } from "node:path";

import type { Connection } from "@prisma/client";

import {
  AdapterError,
  readJson,
  type AdapterCheck,
  type DestinationAdapter,
  type PublishRequest,
  type PublishResult,
} from "@/lib/adapters/types";
import { uploadFileStream, uploadTextBody } from "@/lib/adapters/upload";
import { getValidAccessToken } from "@/lib/oauth/refresh";
import { slugify } from "@/lib/utils";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

type DriveFile = { id?: string; name?: string; webViewLink?: string };

/** Accepts a raw id, a folder URL, or falls back to My Drive root. */
export function resolveFolderId(folderPath?: string | null): string {
  if (!folderPath) return "root";
  const urlMatch = folderPath.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  return folderPath.trim() || "root";
}

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".srt": "text/plain",
  ".txt": "text/plain",
};

function mimeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export class GoogleDriveDestination implements DestinationAdapter {
  readonly provider = "GOOGLE_DRIVE";

  constructor(private readonly connection: Connection) {}

  private async uploadFile(
    accessToken: string,
    path: string,
    name: string,
    folderId: string,
  ): Promise<DriveFile> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new AdapterError("Google Drive: file is missing or empty", "GOOGLE_DRIVE", path);
    }
    const mimeType = mimeFor(path);

    const initResponse = await fetch(
      `${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(info.size),
          "x-upload-content-type": mimeType,
        },
        body: JSON.stringify({ name, parents: [folderId], mimeType }),
      },
    );

    if (!initResponse.ok) {
      throw new AdapterError(
        `Google Drive: upload session rejected (HTTP ${initResponse.status})`,
        "GOOGLE_DRIVE",
        (await initResponse.text()).slice(0, 2000),
      );
    }

    const location = initResponse.headers.get("location");
    if (!location) {
      throw new AdapterError("Google Drive: no resumable Location header", "GOOGLE_DRIVE");
    }

    const { response } = await uploadFileStream({
      url: location,
      filePath: path,
      provider: "GOOGLE_DRIVE",
      mimeType,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    return readJson<DriveFile>("GOOGLE_DRIVE", response, "file upload");
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const { media, destination, contentItem } = request;
    const accessToken = await getValidAccessToken(this.connection.id);
    const folderId = resolveFolderId(destination.folderPath);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const baseName = `${stamp}-${slugify(request.title || contentItem.title || "repurpose").slice(0, 60) || "repurpose"}`;

    const paths: string[] = [];
    if (media.videoPath) paths.push(media.videoPath);
    if (media.audioPath) paths.push(media.audioPath);
    if (media.imagePaths?.length) paths.push(...media.imagePaths);

    if (paths.length === 0) {
      throw new AdapterError("Google Drive: nothing to upload for this item", "GOOGLE_DRIVE");
    }

    const uploaded: DriveFile[] = [];
    for (const [index, path] of paths.entries()) {
      const suffix = paths.length > 1 ? `-${index + 1}` : "";
      const name = `${baseName}${suffix}${extname(path) || ".mp4"}`;
      uploaded.push(await this.uploadFile(accessToken, path, name, folderId));
    }

    // Caption + first comment sidecar so the backup is self-describing.
    const sidecar = [
      request.caption,
      request.firstComment ? `\n---\nFirst comment:\n${request.firstComment}` : "",
      contentItem.sourceUrl ? `\nSource: ${contentItem.sourceUrl}` : "",
      contentItem.hashtags.length ? `\nHashtags: ${contentItem.hashtags.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    let sidecarId: string | undefined;
    try {
      const response = await uploadTextBody(
        `${UPLOAD}?uploadType=media&supportsAllDrives=true&fields=id,name`,
        sidecar,
        { provider: "GOOGLE_DRIVE", headers: { authorization: `Bearer ${accessToken}` } },
      );
      const text = await response.text();
      if (response.ok) {
        sidecarId = (JSON.parse(text) as DriveFile).id;
      }
    } catch {
      // Sidecar is best effort; the media backup already succeeded.
    }

    const first = uploaded[0];
    return {
      remotePostId: first?.id ?? `drive-folder-${folderId}`,
      remoteUrl:
        uploaded.find((file) => file.webViewLink)?.webViewLink ??
        `https://drive.google.com/drive/folders/${folderId}`,
      metadata: {
        folderId,
        files: uploaded.map((file) => ({ id: file.id, name: file.name })),
        sidecarId: sidecarId ?? null,
      },
    };
  }

  async testConnection(): Promise<AdapterCheck> {
    try {
      const accessToken = await getValidAccessToken(this.connection.id);
      const response = await fetch(`${DRIVE}/about?fields=user(displayName,emailAddress)`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const payload = await readJson<{
        user?: { displayName?: string; emailAddress?: string };
      }>("GOOGLE_DRIVE", response, "account lookup");
      const user = payload.user;
      return {
        ok: true,
        detail: user?.emailAddress
          ? `Drive: ${user.displayName ?? user.emailAddress}`
          : "Drive token accepted",
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "Google Drive check failed",
      };
    }
  }
}
