import type { Metadata } from "next";
import ResetPasswordClient from "./reset-password-client";

interface ResetPasswordPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ResetPasswordPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Réinitialiser le mot de passe",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/reset-password` },
  };
}

export default async function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { slug } = await params;
  return <ResetPasswordClient slug={slug} />;
}
