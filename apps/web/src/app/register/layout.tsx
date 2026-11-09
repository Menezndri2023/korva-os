import type { Metadata } from "next";

/** The page is a client component, so its metadata lives here (see login/layout.tsx). */
export const metadata: Metadata = {
  title: "Créer un compte gratuit",
  description:
    "Créez votre compte KORVA OS en deux minutes : choisissez votre métier, votre espace et votre site internet sont prêts. Gratuit, sans carte bancaire.",
  alternates: { canonical: "/register" },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
