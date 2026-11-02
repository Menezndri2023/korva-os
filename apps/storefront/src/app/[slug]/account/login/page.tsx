import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import LoginClient from "./login-client";

interface LoginPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LoginPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Se connecter", "Sign in"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/login` },
  };
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { slug } = await params;
  return <LoginClient slug={slug} />;
}
