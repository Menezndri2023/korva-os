import type { Metadata } from "next";
import ProfileClient from "./profile-client";

interface AccountPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mon compte",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account` },
  };
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { slug } = await params;
  return <ProfileClient slug={slug} />;
}
