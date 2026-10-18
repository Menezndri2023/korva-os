import Link from "next/link";

/**
 * Rendered when page.tsx calls notFound() — that is, when the API confirmed no public storefront
 * exists at this slug (ORGANIZATION_NOT_FOUND, or the organization has not enabled `website`).
 *
 * It must NOT be reached for a transient failure. Those go through StorefrontClient's
 * "momentanément indisponible" state instead, because a shop whose API is down has not stopped
 * existing and telling its customers otherwise costs the business. See fetchOrganization in
 * page.tsx for the distinction.
 *
 * Next injects `<meta name="robots" content="noindex" />` for notFound() automatically, so this
 * file does not repeat it.
 */
export default function StorefrontNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">Boutique introuvable</h1>
      <p className="max-w-sm text-sm text-zinc-600">
        Cette adresse ne correspond à aucune boutique. Vérifiez le lien, ou demandez-le à
        nouveau au commerçant.
      </p>
      <Link href="/" className="mt-2 text-sm font-medium text-zinc-900 underline">
        Accueil
      </Link>
    </main>
  );
}
