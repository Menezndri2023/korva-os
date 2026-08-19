export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 text-center dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        KORVA OS — Storefront
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Application publique par organisation. Le contenu (catalogue,
        réservation, checkout) sera construit en Phase 11 à partir de l&apos;API
        publique.
      </p>
    </div>
  );
}
