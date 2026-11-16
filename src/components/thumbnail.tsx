"use client";

import * as React from "react";

import { Film, ImageIcon, Maximize2 } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Queue thumbnail: scales up on hover and opens a full-size preview on click.
 * Falls back to a neutral placeholder when no artwork is available.
 */
export function Thumbnail({
  src,
  alt,
  durationSec,
  kind = "video",
  className,
}: {
  src?: string | null;
  alt: string;
  durationSec?: number | null;
  kind?: "video" | "images" | "audio";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const Icon = kind === "images" ? ImageIcon : Film;

  return (
    <>
      <button
        type="button"
        onClick={() => src && setOpen(true)}
        className={cn(
          "group relative block aspect-video w-full overflow-hidden rounded-xl border border-border/70 bg-muted/40 text-left",
          className,
        )}
        aria-label={src ? `Preview ${alt}` : alt}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-primary/15 via-muted/30 to-background">
            <Icon className="size-7 text-muted-foreground/70" aria-hidden />
          </div>
        )}

        {durationSec ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
            {formatDuration(durationSec)}
          </span>
        ) : null}

        {src ? (
          <span className="absolute inset-0 hidden items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
              <Maximize2 className="size-3" aria-hidden />
              Enlarge
            </span>
          </span>
        ) : null}
      </button>

      {src ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl border-0 bg-black/95 p-2">
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="max-h-[85dvh] w-full rounded-xl object-contain" />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
