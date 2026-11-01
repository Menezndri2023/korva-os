import { ImageResponse } from "next/og";

export const alt = "KORVA OS, la gestion de votre entreprise au même endroit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The picture shown when a KORVA link is shared on WhatsApp, Facebook, LinkedIn or X. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b2a2f",
          color: "#ffffff",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="88" height="88" viewBox="0 0 48 48">
            <ellipse cx="24" cy="24" rx="14" ry="19" fill="#f2a33a" />
            <path d="M24 8.5c-2.4 5-2.4 26 0 31" fill="none" stroke="#0b2a2f" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 56, fontWeight: 800, display: "flex" }}>
            KORVA<span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 14 }}>OS</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
            La gestion de votre entreprise au même endroit
          </div>
          <div style={{ fontSize: 30, color: "#b9d3d0", maxWidth: 1000 }}>
            Clients, rendez-vous, caisse, factures et site internet. Paiement Wave, Orange Money et carte.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#f2a33a", fontWeight: 600 }}>
          Gratuit pour commencer · app.korvasuite.com
        </div>
      </div>
    ),
    size,
  );
}
