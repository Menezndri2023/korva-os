"use client";

import { useState } from "react";
import type { PublicOffer } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { uploadImage } from "@/lib/upload-image";

/**
 * An offer's first photo, in a box whose shape the caller sets (`className` carries the aspect
 * ratio or size), so the grid never jumps while images arrive.
 *
 * Lazy and asynchronously decoded: on the mobile data these sites are mostly visited on, a
 * catalogue of twenty photos must not hold back the first screen. `priority` is for the one or
 * two images that ARE the first screen.
 *
 * With no photo (or a broken link) it shows the offer's initial on a wash of the accent rather
 * than "Pas d'image": the card still looks deliberate, and in the shop's own colours.
 * `fallback="none"` renders nothing instead, for layouts where a placeholder would only be noise
 * (a restaurant menu row).
 */
export function OfferImage({
  offer,
  className = "",
  priority = false,
  fallback = "monogram",
  zoomOnHover = false,
}: {
  offer: PublicOffer;
  className?: string;
  priority?: boolean;
  fallback?: "monogram" | "none";
  zoomOnHover?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = offer.images[0];

  if (!src || failed) {
    if (fallback === "none") return null;
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center overflow-hidden ${KT.accentSoftBg} ${KT.accentText} ${className}`}
      >
        <span className={`text-4xl font-semibold opacity-70 ${KT.headingFont}`}>
          {offer.name.trim().charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden ${KT.accentSoftBg} ${className}`}>
      {/* Arbitrary tenant-supplied host, not one of Next's configured image domains (see
          middleware.ts img-src comment). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...uploadImage(src, [320, 480, 640, 960], "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw")}
        alt={offer.name}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${zoomOnHover ? "transition-transform duration-500 group-hover:scale-105" : ""}`}
      />
    </div>
  );
}
