import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import ResetPasswordClient from "./reset-password-client";

interface ResetPasswordPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ResetPasswordPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Réinitialiser le mot de passe", "Reset the password"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/reset-password` },
  };
}

export default async function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { slug } = await params;
  return <ResetPasswordClient slug={slug} />;
}
