#!/usr/bin/env node
/**
 * Plays a customer's own journey on every demo business's public site (seed-screenshots.mjs):
 * find "Se connecter" in the header (desktop and phone), create an account, open every section
 * of the customer area, sign out, sign back in, ask for a new password. A Free site must not
 * offer an account it cannot create.
 *
 *   STOREFRONT_URL=http://localhost:3001 CREDENTIALS_FILE=/path/creds.json \
 *   OUT_DIR=/path/out node scripts/customer-journeys.mjs
 *
 * Writes OUT_DIR/report.json and a screenshot of each customer-area page. Exit code 1 when a
 * step failed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const STOREFRONT_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? path.resolve("journeys");
const credentials = JSON.parse(readFileSync(process.env.CREDENTIALS_FILE ?? "", "utf8"));
mkdirSync(OUT_DIR, { recursive: true });

/** Plans that let a visitor create an account (PLAN_FEATURE_MIN_PLAN.customer_accounts). */
const ACCOUNTS_OPEN = new Set(["starter", "pro", "business"]);

const results = [];

async function step(record, name, fn) {
  try {
    const detail = await fn();
    record.steps.push({ name, ok: true, ...(detail ? { detail } : {}) });
    return true;
  } catch (error) {
    record.steps.push({ name, ok: false, error: String(error.message ?? error).split("\n")[0] });
    return false;
  }
}

const browser = await chromium.launch();
try {
  // ONLY=hotel,formation replays just those businesses.
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  for (const persona of credentials.personas.filter((p) => !only || only.has(p.key))) {
    // Locally every request comes from one address, and the API allows 120 a minute: leave the
    // window room between two businesses, or the later ones meet the limit, not a real bug.
    if (results.length > 0) await new Promise((resolve) => setTimeout(resolve, Number(process.env.PAUSE_MS ?? 20_000)));
    const organization = persona.organizations[0];
    const site = `${STOREFRONT_URL}/${organization.slug}`;
    const open = ACCOUNTS_OPEN.has(persona.plan);
    const record = { business: organization.name, plan: persona.plan, accountsOpen: open, steps: [] };
    results.push(record);
    const email = `client.${persona.key}.${Date.now()}@clients.korva.test`;
    const password = `Client-${Math.random().toString(36).slice(2, 10)}`;

    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-FR" });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await step(record, "site public ouvert", async () => {
      await page.goto(site);
      await page.waitForLoadState("networkidle");
    });

    const headerLink = page.getByRole("navigation", { name: "Navigation du site" }).getByRole("link", { name: /Se connecter/ });
    // The account link appears once the site knows whether a customer is signed in.
    const hasHeaderLink = open
      ? await headerLink.first().waitFor({ timeout: 10_000 }).then(() => true, () => false)
      : await page.waitForTimeout(3_000).then(() => headerLink.count()).then((n) => n > 0);
    record.headerSignIn = hasHeaderLink;
    if (!open) {
      // A Free site cannot create accounts: offering "Se connecter" leads to a page with no way in.
      await step(record, "pas d'invitation à un compte impossible à créer", async () => {
        if (hasHeaderLink) throw new Error("l'en-tête propose « Se connecter » alors que la création de compte est fermée");
      });
      await step(record, "page d'inscription : explique la fermeture", async () => {
        await page.goto(`${site}/account/register`);
        await page.waitForLoadState("networkidle");
        const text = await page.locator("main").innerText();
        if (/Créer mon compte/.test(text)) throw new Error("le formulaire d'inscription est proposé");
        return text.slice(0, 140).replace(/\s+/g, " ");
      });
      await context.close();
      continue;
    }

    await step(record, "« Se connecter » dans l'en-tête", async () => {
      if (!hasHeaderLink) throw new Error("lien absent de l'en-tête");
      await headerLink.first().click();
      await page.waitForURL(/\/account\/login/);
    });
    await step(record, "lien « Créer un compte » depuis la connexion", async () => {
      await page.getByRole("link", { name: "Créer un compte" }).click();
      await page.waitForURL(/\/account\/register/);
    });
    await step(record, "inscription", async () => {
      await page.getByLabel("Prénom (optionnel)").fill("Aminata");
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.getByLabel("Mot de passe").fill(password);
      await page.getByRole("button", { name: "Créer mon compte" }).click();
      await page.waitForURL((url) => url.pathname.endsWith("/account"), { timeout: 15_000 });
    });

    let sections = [];
    await step(record, "espace client : rubriques", async () => {
      const nav = page.getByRole("navigation", { name: "Mon espace client" });
      await nav.waitFor();
      sections = await nav.getByRole("link").evaluateAll((links) =>
        links.map((link) => ({ label: link.textContent.replace("→", "").trim(), href: link.getAttribute("href") })),
      );
      await page.screenshot({ path: path.join(OUT_DIR, `${persona.key}-compte.jpg`), type: "jpeg", quality: 70, fullPage: true });
      return sections.map((section) => section.label).join(", ");
    });
    record.sections = sections.map((section) => section.label);
    for (const section of sections) {
      await step(record, `rubrique « ${section.label} »`, async () => {
        await page.goto(`${STOREFRONT_URL}${section.href}`);
        await page.waitForLoadState("networkidle");
        if (/\/account\/login/.test(page.url())) throw new Error("renvoyé à la connexion");
        const text = await page.locator("body").innerText();
        if (/Impossible de charger|erreur est survenue|Application error/i.test(text)) throw new Error("écran d'erreur");
        const slug = section.href.split("/").pop();
        await page.screenshot({ path: path.join(OUT_DIR, `${persona.key}-${slug}.jpg`), type: "jpeg", quality: 70, fullPage: true });
      });
    }

    await step(record, "l'en-tête montre le client connecté", async () => {
      await page.goto(site);
      await page.waitForLoadState("networkidle");
      const link = page.getByRole("navigation", { name: "Navigation du site" }).getByRole("link", { name: "Aminata" });
      if ((await link.count()) === 0) throw new Error("le prénom du client n'apparaît pas");
    });
    await step(record, "déconnexion", async () => {
      await page.goto(`${site}/account`);
      await page.getByRole("button", { name: "Se déconnecter" }).click();
      await page.waitForURL((url) => !url.pathname.includes("/account"));
    });
    await step(record, "reconnexion", async () => {
      await page.goto(`${site}/account/login`);
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.getByLabel("Mot de passe").fill(password);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForURL((url) => url.pathname.endsWith("/account"), { timeout: 15_000 });
    });
    await step(record, "mot de passe oublié", async () => {
      await page.goto(`${site}/account`);
      await page.getByRole("button", { name: "Se déconnecter" }).click();
      await page.waitForURL((url) => !url.pathname.includes("/account"));
      await page.goto(`${site}/account/login`);
      await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.getByRole("button", { name: /Envoyer|Recevoir|lien/i }).click();
      await page.getByText(/lien de réinitialisation vient de lui être envoyé/).waitFor();
    });
    await context.close();

    // Phone: the account link lives in the header menu.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
    const phonePage = await phone.newPage();
    await step(record, "téléphone : « Se connecter » dans le menu", async () => {
      await phonePage.goto(site);
      await phonePage.waitForLoadState("networkidle");
      await phonePage.waitForTimeout(1_500);
      await phonePage.getByLabel("Menu").click();
      await phonePage.getByRole("link", { name: /Se connecter/ }).click();
      await phonePage.waitForURL(/\/account\/login/);
    });
    await phone.close();
    if (consoleErrors.length) record.steps.push({ name: "erreurs du navigateur", ok: false, error: consoleErrors.join(" | ").slice(0, 300) });
  }
} finally {
  await browser.close();
}

writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(results, null, 2));
let failed = 0;
for (const record of results) {
  const bad = record.steps.filter((s) => !s.ok);
  failed += bad.length;
  console.log(`${bad.length ? "✗" : "✓"} ${record.business} (${record.plan}) — ${record.sections ? record.sections.join(", ") : record.accountsOpen ? "" : "comptes fermés"}`);
  for (const s of bad) console.log(`    ✗ ${s.name} : ${s.error}`);
}
process.exit(failed ? 1 : 0);
