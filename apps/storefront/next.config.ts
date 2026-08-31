import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Static headers only — Content-Security-Policy needs a per-request nonce and is set in
// middleware.ts instead (see docs there for why).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Belt-and-braces alongside CSP's frame-ancestors 'none' (middleware.ts) for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  ...(isProduction
    ? [
        {
          // 180 days. No includeSubDomains/preload: the production domain topology isn't
          // provisioned yet, so subdomain HTTPS coverage can't be verified — see
          // docs/PRODUCTION_READINESS.md.
          key: "Strict-Transport-Security",
          value: "max-age=15552000",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Hides the on-screen dev-mode route indicator badge — compile/runtime errors still surface
  // normally, this only removes the corner badge itself.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
