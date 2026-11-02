"use client";

import { useRef, useState } from "react";
import { OFFER_MAX_IMAGES } from "@korva/validation";
import { Button } from "@korva/ui";
import { ApiError, uploadFile } from "@/lib/api-client";
import { useT } from "@/lib/dashboard-locale";

/** Mirrors ALLOWED_UPLOAD_MIME_TYPES / MAX_UPLOAD_BYTES in apps/api/src/shared/storage/
 *  storage.constants.ts. The API stays the authority; checking here only spares the owner a
 *  round trip to learn that a 12 MB HEIC photo will be refused. */
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Photos of one offer: upload (several at once), reorder, choose the main photo, remove.
 *
 * Controlled — it only edits the `images` array it is given; the parent decides when that array
 * is saved with the offer. Order is meaningful: `images[0]` is the main photo, which is what the
 * storefront cards and the catalogue list display.
 *
 * Removing a photo does not delete the uploaded file: until the offer is saved, the owner can
 * still cancel the edit and the old array — which references that file — comes back.
 */
export function OfferImagesEditor({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = OFFER_MAX_IMAGES - images.length;

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;
    setError(null);

    const accepted = files.filter(
      (file) => ACCEPTED_TYPES.includes(file.type) && file.size <= MAX_BYTES,
    );
    const problems: string[] = [];
    if (accepted.length < files.length) {
      problems.push(
        t(
          "Formats acceptés : JPG, PNG, WebP ou GIF, 5 Mo maximum par photo.",
          "Accepted formats: JPG, PNG, WebP or GIF, 5 MB maximum per photo.",
        ),
      );
    }
    const toUpload = accepted.slice(0, Math.max(remaining, 0));
    if (toUpload.length < accepted.length) {
      problems.push(t(`${OFFER_MAX_IMAGES} photos maximum par offre.`, `${OFFER_MAX_IMAGES} photos maximum per offer.`));
    }

    setUploading(true);
    const uploaded: string[] = [];
    try {
      // One at a time: a failure stops the batch with the photos already sent kept, rather than
      // leaving the owner unsure which of several parallel uploads went through.
      for (const file of toUpload) {
        const result = await uploadFile(file);
        uploaded.push(result.url);
      }
    } catch (uploadError) {
      problems.push(
        uploadError instanceof ApiError ? uploadError.message : t("Échec de l'envoi d'une photo.", "A photo could not be uploaded."),
      );
    } finally {
      setUploading(false);
    }

    if (uploaded.length > 0) onChange([...images, ...uploaded]);
    if (problems.length > 0) setError(problems.join(" "));
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function makeMain(index: number) {
    if (index === 0) return;
    onChange([images[index], ...images.filter((_, i) => i !== index)]);
  }

  function remove(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div className="col-span-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">
          {t("Photos", "Photos")}{" "}
          <span className="font-normal text-text-muted">
            ({images.length}/{OFFER_MAX_IMAGES})
          </span>
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          className="hidden"
          aria-label={t("Choisir des photos", "Choose photos")}
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          disabled={remaining <= 0}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? t("Envoi...", "Uploading...") : t("Ajouter des photos", "Add photos")}
        </Button>
      </div>

      {images.length === 0 ? (
        <p className="text-xs text-text-muted">
          {t(
            "Aucune photo. La première photo ajoutée devient la photo principale, affichée sur votre site et dans le catalogue.",
            "No photos. The first photo you add becomes the main photo, shown on your website and in the catalogue.",
          )}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {images.map((url, index) => (
            <li key={url} className="overflow-hidden rounded-md border border-border">
              <div className="relative aspect-square bg-surface-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset */}
                <img
                  src={url}
                  alt={t(`Photo ${index + 1}`, `Photo ${index + 1}`)}
                  className="h-full w-full object-cover"
                />
                {index === 0 && (
                  <span className="absolute left-1 top-1 rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text">
                    {t("Principale", "Main")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1 p-1 text-xs">
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={t(`Déplacer la photo ${index + 1} vers la gauche`, `Move photo ${index + 1} left`)}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded px-1.5 py-0.5 text-text-muted hover:bg-surface-muted disabled:opacity-40"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={t(`Déplacer la photo ${index + 1} vers la droite`, `Move photo ${index + 1} right`)}
                    disabled={index === images.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded px-1.5 py-0.5 text-text-muted hover:bg-surface-muted disabled:opacity-40"
                  >
                    →
                  </button>
                </div>
                <div className="flex gap-2">
                  {index !== 0 && (
                    <button
                      type="button"
                      onClick={() => makeMain(index)}
                      className="text-text hover:underline"
                    >
                      {t("Principale", "Main")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t(`Retirer la photo ${index + 1}`, `Remove photo ${index + 1}`)}
                    onClick={() => remove(index)}
                    className="text-destructive hover:underline"
                  >
                    {t("Retirer", "Remove")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
