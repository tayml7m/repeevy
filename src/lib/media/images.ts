/** Photo/carousel + thumbnail formatting with sharp. */
import sharp from "sharp";

import { MediaError } from "@/lib/media/ffmpeg";

/** Exact-cover resize, used to make every slideshow frame identical in size. */
export async function resizeImageCover(
  input: string,
  output: string,
  width: number,
  height: number,
): Promise<void> {
  try {
    await sharp(input)
      .rotate()
      .resize({ width, height, fit: "cover", position: "centre" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(output);
  } catch (error) {
    throw new MediaError(
      "Slideshow frame resize failed",
      error instanceof Error ? error.message : undefined,
    );
  }
}

/** Normalizes a source photo to a platform-friendly JPEG (max edge 1440). */
export async function normalizeImage(input: string, output: string, maxEdge = 1440): Promise<void> {
  try {
    await sharp(input)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(output);
  } catch (error) {
    throw new MediaError(
      "Image normalization failed",
      error instanceof Error ? error.message : undefined,
    );
  }
}

/** 16:9 cover crop for queue cards and video thumbnails. */
export async function makeThumbnail(input: string, output: string, width = 720): Promise<void> {
  try {
    await sharp(input)
      .rotate()
      .resize({ width, height: Math.round((width * 9) / 16), fit: "cover", position: "centre" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(output);
  } catch (error) {
    throw new MediaError(
      "Thumbnail generation failed",
      error instanceof Error ? error.message : undefined,
    );
  }
}
