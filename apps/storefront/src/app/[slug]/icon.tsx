import { ImageResponse } from "next/og";
import { serverApi } from "@/lib/server-api";
import type { PublicOrganization } from "@/lib/public-types";
import { resolveStorefrontStyle } from "@/templates/palette";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * Each business's own browser-tab icon: its logo when it has one, otherwise its initial on its
 * site's accent colour — the same monogram as the site's header. Never KORVA's cowrie: the
 * customer is on the business's site.
 */
export default async function Icon({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let organization: PublicOrganization | null = null;
  try {
    organization = await serverApi.get<PublicOrganization>(`/public/${slug}`);
  } catch {
    // Unknown or offline site: a neutral tile, never an error for a tab icon.
  }
  const style = organization ? resolveStorefrontStyle(organization.storefrontTheme, organization.brandColor) : null;
  const background = style?.accent ?? "#4e666a";
  const color = style?.accentContrast ?? "#ffffff";
  const initial = (organization?.name ?? "·").trim().charAt(0).toUpperCase();

  return new ImageResponse(
    organization?.logo ? (
      <img src={organization.logo} alt="" width={64} height={64} style={{ borderRadius: 14, objectFit: "cover" }} />
    ) : (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background,
          color,
          borderRadius: 14,
          fontSize: 40,
          fontWeight: 700,
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
