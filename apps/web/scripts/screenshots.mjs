#!/usr/bin/env node
/**
 * The screenshot tour: every main screen of the dashboard, the administration and a public site,
 * in light, dark and phone size, for the demo businesses of apps/api/scripts/seed-screenshots.mjs.
 *
 * Also a crawl: it reports every page that logged a browser error or answered with an error
 * screen, and it reaches one public page by CLICKING, not only by loading it — the storefront's
 * CSP once broke only on client-side navigation.
 *
 *   WEB_URL=http://localhost:3000 STOREFRONT_URL=http://localhost:3001 \
 *   CREDENTIALS_FILE=/path/creds.json OUT_DIR=/path/out node scripts/screenshots.mjs
 *
 * Writes OUT_DIR/<variant>/<persona>-<page>.jpg, OUT_DIR/index.html (a contact sheet) and
 * OUT_DIR/report.json. Never prints a password.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const STOREFRONT_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? path.resolve("screenshots");
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS_FILE ?? "", "utf8"));

const VARIANTS = [
  { key: "clair", label: "Clair, ordinateur", viewport: { width: 1440, height: 900 }, colorScheme: "light" },
  { key: "sombre", label: "Sombre, ordinateur", viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  {
    key: "mobile",
    label: "Téléphone",
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
  },
];

/** What each demo business shows. Paths are dashboard routes. */
const TOURS = {
  salon: [
    ["accueil", "/dashboard"],
    ["rendez-vous", "/dashboard/bookings"],
    ["prestations", "/dashboard/catalog"],
    ["statistiques", "/dashboard/analytics"],
    ["caisse", "/dashboard/caisse"],
    ["factures", "/dashboard/finance/invoices"],
    ["parametres-modules", "/dashboard/settings#abonnement"],
  ],
  boutique: [
    ["accueil", "/dashboard"],
    ["commandes", "/dashboard/orders"],
    ["produits", "/dashboard/catalog"],
    ["statistiques", "/dashboard/analytics"],
    ["etablissements", "/dashboard/etablissements"],
    ["caisse", "/dashboard/caisse"],
  ],
  restaurant: [
    ["accueil", "/dashboard"],
    ["commandes", "/dashboard/orders"],
    ["menu", "/dashboard/catalog"],
    ["statistiques", "/dashboard/analytics"],
    ["caisse", "/dashboard/caisse"],
  ],
  conseil: [
    ["accueil", "/dashboard"],
    ["statistiques", "/dashboard/analytics"],
    ["caisse", "/dashboard/caisse"],
  ],
};
const ADMIN_TOUR = [
  ["vue-ensemble", "/admin"],
  ["entreprises", "/admin/entreprises"],
  ["finances", "/admin/finances"],
  ["paiements", "/admin/paiements"],
  ["reversements", "/admin/reversements"],
];

const shots = [];
const problems = [];

/** Lets queries settle: no "Chargement…" left, then a short pause for fonts and charts. */
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction(() => !/Chargement/.test(document.body.innerText), null, { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

/** Pages that met the API's rate limit (120 requests a minute from one address) since they loaded. */
const throttled = new WeakSet();

async function shoot(page, variant, name, label) {
  await settle(page);
  // The tour is one visitor clicking far faster than a person: when the API says "too many
  // requests", wait out its one-minute window and load the page again, rather than photograph
  // an error the real product would not show.
  for (let attempt = 0; throttled.has(page) && attempt < 3; attempt += 1) {
    throttled.delete(page);
    await page.waitForTimeout(61_000);
    await page.reload();
    await settle(page);
  }
  const file = path.join(variant.key, `${name}.jpg`);
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true, type: "jpeg", quality: 70 });
  if (/\/login$|\/admin\/connexion$/.test(new URL(page.url()).pathname)) {
    problems.push({ variant: variant.key, page: name, url: page.url(), problem: "session perdue : renvoyé à la connexion" });
  }
  const text = await page.locator("body").innerText();
  if (/Impossible de charger|Une erreur est survenue|Application error/i.test(text)) {
    problems.push({ variant: variant.key, page: name, url: page.url(), problem: "écran d'erreur affiché" });
  }
  shots.push({ variant: variant.key, name, label, file });
}

function watchErrors(page, variant, where) {
  page.on("response", (response) => {
    if (response.status() === 429) throttled.add(page);
  });
  page.on("pageerror", (error) =>
    problems.push({ variant: variant.key, page: where(), url: page.url(), problem: `exception : ${error.message}` }),
  );
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/favicon|Download the React DevTools|status of 429/i.test(message.text())
    ) {
      problems.push({ variant: variant.key, page: where(), url: page.url(), problem: `console : ${message.text().slice(0, 300)}` });
    }
  });
}

const browser = await chromium.launch();
try {
  for (const variant of VARIANTS) {
    mkdirSync(path.join(OUT_DIR, variant.key), { recursive: true });
    const options = {
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      isMobile: variant.isMobile ?? false,
      hasTouch: variant.hasTouch ?? false,
      locale: "fr-FR",
      timezoneId: "Africa/Abidjan",
    };

    for (const persona of credentials.personas) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      let current = "connexion";
      watchErrors(page, variant, () => `${persona.key}-${current}`);
      await page.goto(`${WEB_URL}/login`);
      await page.fill("#email", persona.email);
      await page.fill("#password", credentials.password);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
      for (const [name, route] of TOURS[persona.key] ?? []) {
        current = name;
        try {
          await page.goto(`${WEB_URL}${route}`);
          await shoot(page, variant, `${persona.key}-${name}`, `${persona.organizations[0].name} — ${name}`);
        } catch (error) {
          problems.push({ variant: variant.key, page: `${persona.key}-${name}`, url: page.url(), problem: `étape échouée : ${error.message.split("\n")[0]}` });
        }
      }
      if (variant.isMobile) {
        current = "menu-mobile";
        await page.goto(`${WEB_URL}/dashboard`);
        await settle(page);
        try {
          await page.getByRole("button", { name: "Ouvrir le menu" }).click({ timeout: 15_000 });
          await shoot(page, variant, `${persona.key}-menu-mobile`, `${persona.organizations[0].name} — menu`);
        } catch (error) {
          // One step that fails is a finding, not the end of the tour.
          problems.push({ variant: variant.key, page: `${persona.key}-menu-mobile`, url: page.url(), problem: `menu introuvable : ${error.message.split("\n")[0]}` });
        }
      }
      await context.close();
    }

    // The administration.
    {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      let current = "connexion";
      watchErrors(page, variant, () => `admin-${current}`);
      await page.goto(`${WEB_URL}/admin/connexion`);
      await page.fill("#admin-email", credentials.admin.email);
      await page.fill("#admin-password", credentials.admin.password);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.endsWith("/connexion"), { timeout: 30_000 });
      for (const [name, route] of ADMIN_TOUR) {
        current = name;
        await page.goto(`${WEB_URL}${route}`);
        await shoot(page, variant, `admin-${name}`, `Administration — ${name}`);
      }
      const salon = credentials.personas.find((p) => p.key === "salon");
      current = "fiche-entreprise";
      await page.goto(`${WEB_URL}/admin/entreprises/${salon.organizations[0].id}`);
      await shoot(page, variant, "admin-fiche-entreprise", "Administration — fiche entreprise");
      await context.close();
    }

    // A public site with a premium theme: loaded, then reached again by a click.
    {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      let current = "site";
      watchErrors(page, variant, () => `site-${current}`);
      const boutique = credentials.personas.find((p) => p.key === "boutique");
      await page.goto(`${STOREFRONT_URL}/${boutique.organizations[0].slug}`);
      await shoot(page, variant, "site-boutique", "Site public — boutique, thème premium Jade + Prestige");
      current = "offre-par-clic";
      const offerLink = page.locator('a[href*="/offers/"]').first();
      if ((await offerLink.count()) > 0) {
        await offerLink.click();
        await page.waitForURL(/\/offers\//, { timeout: 15_000 });
        await shoot(page, variant, "site-boutique-offre", "Site public — une offre, ouverte par un clic");
      } else {
        problems.push({ variant: variant.key, page: "site-offre", url: page.url(), problem: "aucun lien vers une offre" });
      }
      const salon = credentials.personas.find((p) => p.key === "salon");
      current = "salon";
      await page.goto(`${STOREFRONT_URL}/${salon.organizations[0].slug}`);
      await shoot(page, variant, "site-salon", "Site public — salon");
      await context.close();
    }
    console.log(`✓ ${variant.label}`);
  }
} finally {
  await browser.close();
}

const sections = VARIANTS.map(
  (variant) => `<section><h2>${variant.label}</h2><div class="grid">${shots
    .filter((shot) => shot.variant === variant.key)
    .map((shot) => `<figure><a href="${shot.file}"><img loading="lazy" src="${shot.file}" alt="${shot.label}"></a><figcaption>${shot.label}</figcaption></figure>`)
    .join("")}</div></section>`,
).join("");
writeFileSync(
  path.join(OUT_DIR, "index.html"),
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Captures KORVA</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;background:#f4f7f6;color:#14282b}h2{margin-top:32px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #d9e3e1;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:220px;object-fit:cover;object-position:top}figcaption{padding:8px 12px;font-size:13px}</style></head><body><h1>Captures KORVA</h1><p>${shots.length} captures, ${problems.length} problème(s) relevé(s) — voir report.json.</p>${sections}</body></html>`,
);
writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify({ shots: shots.length, problems }, null, 2));
console.log(`${shots.length} captures, ${problems.length} problème(s). Voir ${path.join(OUT_DIR, "index.html")}`);
