"use client";

import { useEffect, useState } from "react";
import type { PublicOrganization } from "@/lib/public-types";
import { useT } from "@/lib/storefront-locale";
import { uploadImage } from "@/lib/upload-image";

const SLIDE_MS = 5000;

/** The home page photos: the main one, then the Business slideshow (`heroSlides`) when sent. */
export function heroImagesOf(organization: Pick<PublicOrganization, "heroImage" | "heroSlides">): string[] {
  return [organization.heroImage, ...(organization.heroSlides ?? [])].filter(
    (src): src is string => Boolean(src),
  );
}

/**
 * The hero photo, or a slideshow when there are several (hero_slideshow, Business): photos
 * cross-fade every five seconds, with dots to choose one. Still for visitors who asked for less
 * motion. A photo that fails to load drops out; when none is left it renders nothing, so the
 * caller's layout behaves as before for a broken link. `className` sizes the frame.
 */
export function HeroSlides({
  images,
  className = "",
  fill = false,
}: {
  images: string[];
  className?: string;
  /** Covers the positioned parent (absolute inset-0) instead of sizing its own frame. */
  fill?: boolean;
}) {
  const t = useT();
  const [failed, setFailed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const shown = images.filter((src) => !failed.includes(src));
  const count = shown.length;
  const current = count > 0 ? index % count : 0;

  useEffect(() => {
    if (count < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => i + 1), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  if (count === 0) return null;

  return (
    <div className={`${fill ? "absolute inset-0" : "relative"} overflow-hidden ${className}`}>
      {shown.map((src, i) => (
        // Arbitrary tenant-supplied host — same rationale as OfferImage.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          {...uploadImage(src, [640, 960, 1280], "100vw")}
          alt=""
          fetchPriority={i === 0 ? "high" : "auto"}
          loading={i === 0 ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed((list) => [...list, src])}
          aria-hidden={i !== current}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
            i === current ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
      {count > 1 && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {shown.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t(`Photo ${i + 1} sur ${count}`, `Photo ${i + 1} of ${count}`)}
              aria-current={i === current}
              className={`h-2 rounded-full bg-white shadow transition-all ${i === current ? "w-5" : "w-2 opacity-60"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
