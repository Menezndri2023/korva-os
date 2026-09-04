"use client";

import { useState } from "react";
import type { PublicOrganization } from "@/lib/public-types";
import { KT } from "../kt-classes";

export function GallerySection({ organization }: { organization: PublicOrganization }) {
  const images = organization.galleryImages;
  if (!images || images.length === 0) return null;

  return (
    <section className={`px-6 py-14 ${KT.surface}`}>
      <div className="mx-auto max-w-5xl">
        <h2 className={`text-xl font-semibold ${KT.headingFont}`}>Galerie</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
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
      className={`h-40 w-full rounded-md border object-cover ${KT.border}`}
    />
  );
}
