import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Page introuvable</h1>
        <p className="text-sm text-zinc-500">
          Cette page n&apos;existe pas ou a été déplacée.
        </p>
        <Link
          href="/"
          className="inline-block text-sm font-medium text-zinc-900 underline"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
