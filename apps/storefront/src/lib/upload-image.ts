/** Widths the API resizes uploads to (RESIZE_WIDTHS in apps/api uploads.controller.ts). */
const API_WIDTHS = [160, 320, 480, 640, 960, 1280] as const;
type Width = (typeof API_WIDTHS)[number];

/**
 * `src`/`srcSet`/`sizes` for a photo the business uploaded to KORVA: the browser picks the
 * smallest WebP that fills its slot (`?w=`), instead of the 2 000 px original — the first screen
 * of a shop on 3G went from 16 s to a few. Any other address (an external URL) is left alone.
 */
export function uploadImage(
  url: string | undefined,
  widths: readonly Width[],
  sizes: string,
): { src?: string; srcSet?: string; sizes?: string } {
  if (!url || !url.includes("/api/v1/uploads/")) return { src: url };
  const at = (width: number) => `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
  return {
    src: at(widths[Math.min(1, widths.length - 1)]!),
    srcSet: widths.map((width) => `${at(width)} ${width}w`).join(", "),
    sizes,
  };
}
