import type { Metadata } from "next";
import RegisterClient from "./register-client";

interface RegisterPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: RegisterPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Créer un compte",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/register` },
  };
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { slug } = await params;
  return <RegisterClient slug={slug} />;
}
