import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import RegisterClient from "./register-client";

interface RegisterPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: RegisterPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Créer un compte", "Create an account"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/register` },
  };
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { slug } = await params;
  return <RegisterClient slug={slug} />;
}
