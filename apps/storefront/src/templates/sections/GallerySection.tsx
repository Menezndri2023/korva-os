"use client";

import { useState } from "react";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";
import { SectionHeading } from "./SectionHeading";
import { useT } from "@/lib/storefront-locale";

export function GallerySection({ organization }: { organization: PublicOrganization }) {
  const t = useT();
  const images = organization.galleryImages;
  if (!images || images.length === 0) return null;

  return (
    <section className={`px-6 py-16 ${KT.surface}`}>
      <div className="mx-auto max-w-5xl">
        <SectionHeading eyebrow={t("En images", "In pictures")} title={t("Galerie", "Gallery")} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.map((image) => (
            <GalleryImage key={image.id} url={image.url} caption={image.caption} />
          ))}
        </div>
      </div>
    </section>
  );
}

function GalleryImage({ url, caption }: { url: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={caption ?? ""}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`h-40 w-full rounded-xl border object-cover shadow-sm transition-shadow duration-200 hover:shadow-lg ${KT.border}`}
    />
  );
}
