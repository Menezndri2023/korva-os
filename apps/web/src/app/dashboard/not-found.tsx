import Link from "next/link";
import { Card } from "@korva/ui";

export default function DashboardNotFound() {
  return (
    <Card className="p-6 text-center">
      <h1 className="text-lg font-semibold">Page introuvable</h1>
      <p className="mt-1 text-sm text-text-muted">
        Cette page n&apos;existe pas ou a été déplacée.
      </p>
      <Link
        href="/dashboard"
        className="mt-3 inline-block text-sm font-medium text-text underline"
      >
        Retour au tableau de bord
      </Link>
    </Card>
  );
}
