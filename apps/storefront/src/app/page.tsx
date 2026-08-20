export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 text-center dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        KORVA OS — Storefront
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Chaque organisation a sa propre boutique publique, accessible sur{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-900">
          /votre-organisation
        </code>{" "}
        (domaines personnalisés à venir).
      </p>
    </div>
  );
}
