import type { Metadata } from "next";

/**
 * The page is a client component, so its metadata lives here. People search "korva connexion"
 * to find their way back in: this page answers that, with its own title instead of the home
 * page's (two pages sharing a title and description is what search engines collapse).
 */
export const metadata: Metadata = {
  title: "Connexion à votre espace",
  description: "Connectez-vous à votre espace KORVA OS : clients, rendez-vous, commandes, caisse et site internet.",
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
