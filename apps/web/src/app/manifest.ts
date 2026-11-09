import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/brand";

/**
 * The name and icon a phone shows when someone adds KORVA to their home screen, and one more
 * place search engines read the product's name. Colours are the icon's own (app/icon.svg).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: "KORVA",
    description: "Clients, rendez-vous, commandes, stock, caisse, factures et site internet dans un seul compte.",
    start_url: "/dashboard",
    display: "standalone",
    lang: "fr",
    background_color: "#0f3b42",
    theme_color: "#0f3b42",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
