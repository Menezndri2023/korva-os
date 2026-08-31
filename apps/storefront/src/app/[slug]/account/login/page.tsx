import type { Metadata } from "next";
import LoginClient from "./login-client";

interface LoginPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LoginPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Se connecter",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/login` },
  };
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { slug } = await params;
  return <LoginClient slug={slug} />;
}
