import { redirect } from "next/navigation";

/** Renamed: /admin/entreprises/[id]. */
export default async function OldShopRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/entreprises/${id}`);
}
