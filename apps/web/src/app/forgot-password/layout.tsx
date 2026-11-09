import type { Metadata } from "next";

/** A step of the sign-in flow, not something anyone searches for: kept out of results. */
export const metadata: Metadata = {
  title: "Mot de passe oublié",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
