#!/usr/bin/env node
/**
 * Fills a LOCAL demo database for the screenshot tour (apps/web/scripts/screenshots.mjs): one
 * business per kind of trade and plan, with offers, customers, sales, bookings and today's till.
 *
 * Runs against a running API (API_URL) for everything a business does itself, and writes straight
 * into MongoDB only for what an owner cannot do from the dashboard: the plan tier, and dated
 * history (sales last month, an overdue invoice).
 *
 * REFUSES any database whose name does not end in "_screens": it drops nothing, but it does write
 * demo businesses, and must never be pointed at a real one.
 *
 * Credentials (demo passwords, the demo administrator's password) are written to CREDENTIALS_FILE
 * with mode 0600 — never printed.
 *
 *   MONGODB_URI=…/korva_screens?… API_URL=http://localhost:4000/api/v1 \
 *   CREDENTIALS_FILE=/path/creds.json node scripts/seed-screenshots.mjs
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const MONGODB_URI = process.env.MONGODB_URI ?? '';
const CREDENTIALS_FILE = process.env.CREDENTIALS_FILE;
const ADMIN_EMAIL = process.env.SCREENSHOT_ADMIN_EMAIL ?? 'admin@screens.korva.test';

const dbName = new URL(MONGODB_URI.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.slice(1);
if (!dbName.endsWith('_screens')) {
  console.error(`Refusé : la base « ${dbName || '?'} » ne se termine pas par _screens.`);
  process.exit(1);
}
if (!CREDENTIALS_FILE) {
  console.error('CREDENTIALS_FILE est requis (les mots de passe y sont écrits, jamais affichés).');
  process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
const password = `Demo-${randomBytes(9).toString('base64url')}`;

async function api(method, path, { token, org, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(org ? { 'X-Organization-Id': org } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.success) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(payload.error)}`);
  }
  return payload.data;
}

const PERSONAS = [
  {
    key: 'salon',
    email: 'awa@salon.screens.korva.test',
    firstName: 'Awa',
    lastName: 'Koné',
    plan: 'pro',
    establishments: [{ name: 'Salon Awa Beauté', type: 'beauté', businessModel: 'appointments' }],
    modules: ['crm', 'catalog', 'booking', 'website', 'analytics', 'communication', 'finance', 'marketing'],
    offers: [
      { type: 'booking', name: 'Tresses africaines', amount: 15000, durationMinutes: 180 },
      { type: 'booking', name: 'Manucure', amount: 5000, durationMinutes: 45 },
      { type: 'booking', name: 'Soin du visage', amount: 12000, durationMinutes: 60 },
    ],
  },
  {
    key: 'boutique',
    email: 'mariam@boutique.screens.korva.test',
    firstName: 'Mariam',
    lastName: 'Diallo',
    plan: 'business',
    establishments: [
      { name: 'Wax & Co Cocody', type: 'commerce', businessModel: 'retail' },
      { name: 'Wax & Co Plateau', type: 'commerce', businessModel: 'retail' },
    ],
    modules: ['crm', 'catalog', 'commerce', 'website', 'analytics', 'communication', 'finance', 'marketing'],
    theme: { storefrontTemplate: 'boutique', storefrontPalette: 'jade', storefrontFontPairing: 'prestige' },
    offers: [
      { type: 'product', name: 'Pagne wax 6 yards', amount: 18000 },
      { type: 'product', name: 'Sac en raphia', amount: 9500 },
      { type: 'product', name: 'Chemise bogolan', amount: 14000 },
    ],
  },
  {
    key: 'restaurant',
    email: 'tanti@maquis.screens.korva.test',
    firstName: 'Fatou',
    lastName: 'Bamba',
    plan: 'starter',
    establishments: [{ name: 'Maquis Chez Tanti', type: 'restauration', businessModel: 'restaurant' }],
    modules: ['crm', 'catalog', 'commerce', 'booking', 'website', 'analytics', 'communication'],
    offers: [
      { type: 'product', name: 'Garba', amount: 1500 },
      { type: 'product', name: 'Poulet braisé', amount: 5000 },
      { type: 'product', name: 'Jus de bissap', amount: 1000 },
    ],
  },
  {
    key: 'conseil',
    email: 'kofi@conseil.screens.korva.test',
    firstName: 'Kofi',
    lastName: 'Mensah',
    plan: 'free',
    establishments: [{ name: 'Mensah Conseil', type: 'conseil', businessModel: 'quotes' }],
    modules: ['crm', 'catalog', 'website', 'analytics', 'communication'],
    offers: [{ type: 'service', name: 'Audit de gestion', amount: 250000 }],
  },
];

const CUSTOMERS = [
  ['Aminata', 'Touré', '+225 07 11 22 33 44'],
  ['Yao', 'Kouassi', '+225 05 22 33 44 55'],
  ['Fanta', 'Camara', '+225 01 33 44 55 66'],
  ['Ibrahim', 'Sangaré', '+225 07 44 55 66 77'],
  ['Akissi', "N'Guessan", '+225 05 55 66 77 88'],
];

await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;
const oid = (id) => new mongoose.Types.ObjectId(id);

async function putOnPlan(organizationId, planKey, currency) {
  const plan = await db.collection('plans').findOne({ key: planKey, priceCurrency: currency });
  if (!plan) throw new Error(`Pas de formule ${planKey} en ${currency}`);
  await db
    .collection('subscriptions')
    .updateOne(
      { organizationId: oid(organizationId) },
      { $set: { planId: plan._id, status: 'active', updatedAt: new Date() } },
    );
}

const credentials = { password, admin: null, personas: [] };

for (const persona of PERSONAS) {
  const auth = await api('POST', '/auth/register', {
    body: { email: persona.email, password, firstName: persona.firstName, lastName: persona.lastName },
  });
  const token = auth.accessToken;
  const userId = (await db.collection('users').findOne({ email: persona.email }))._id;
  const organizations = [];

  for (const [index, establishment] of persona.establishments.entries()) {
    const organization = await api('POST', '/organizations', {
      token,
      body: {
        ...establishment,
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      },
    });
    organizations.push(organization);
    const org = organization.id;
    // The first establishment is the persona's plan; a second one keeps its own (Free).
    await putOnPlan(org, index === 0 ? persona.plan : 'free', 'XOF');
    await api('PATCH', '/organizations/me', {
      token,
      org,
      body: {
        enabledModules: index === 0 ? persona.modules : persona.modules.filter((m) => !['finance', 'marketing'].includes(m)),
        tagline: 'Démonstration KORVA',
        contactPhone: '+225 07 00 00 00 00',
        ...(index === 0 && persona.theme ? persona.theme : {}),
      },
    });

    const offers = [];
    for (const offer of persona.offers) {
      offers.push(
        await api('POST', '/offers', {
          token,
          org,
          body: {
            type: offer.type,
            name: offer.name,
            status: 'active',
            pricing: { amount: offer.amount, currency: 'XOF' },
            ...(offer.durationMinutes ? { durationMinutes: offer.durationMinutes } : {}),
          },
        }),
      );
    }
    const contacts = [];
    for (const [firstName, lastName, phone] of CUSTOMERS) {
      contacts.push(
        await api('POST', '/contacts', { token, org, body: { type: 'person', firstName, lastName, phone } }),
      );
    }

    // History: sales this month and last month, so comparisons have something to say.
    const now = Date.now();
    const sales = [];
    for (let i = 0; i < (index === 0 ? 14 : 5); i += 1) {
      const offer = offers[i % offers.length];
      const contact = contacts[i % contacts.length];
      const ago = i < 9 ? (i * 3 + 1) * DAY : (i * 3 + 30) * DAY;
      const quantity = 1 + (i % 3);
      const total = offer.pricing.amount * quantity;
      sales.push({ offer, contact, ago, quantity, total, number: `CMD-${String(i + 1).padStart(4, '0')}` });
    }
    const usesOrders = ['retail', 'restaurant'].includes(establishment.businessModel);
    if (usesOrders) {
      await db.collection('orders').insertMany(
        sales.map((sale, i) => ({
          organizationId: oid(org),
          contactId: oid(sale.contact.id),
          number: sale.number,
          status: i % 5 === 4 ? 'pending' : 'fulfilled',
          source: 'storefront',
          items: [{ offerId: oid(sale.offer.id), description: sale.offer.name, quantity: sale.quantity, unitPrice: sale.offer.pricing.amount }],
          currency: 'XOF',
          subtotal: sale.total,
          taxTotal: 0,
          discountTotal: 0,
          shippingCost: 0,
          total: sale.total,
          createdAt: new Date(now - sale.ago),
          updatedAt: new Date(now - sale.ago),
        })),
      );
    } else if (establishment.businessModel === 'appointments') {
      const resource = (
        await db.collection('resources').insertOne({
          organizationId: oid(org),
          name: 'Awa',
          type: 'staff',
          capacity: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).insertedId;
      await db.collection('bookings').insertMany(
        sales.map((sale, i) => {
          const start = new Date(now - sale.ago + (i % 2 === 0 ? 10 : 14) * 60 * 60 * 1000);
          return {
            organizationId: oid(org),
            resourceId: resource,
            offerId: oid(sale.offer.id),
            contactId: oid(sale.contact.id),
            startAt: i < 3 ? new Date(now + (i + 1) * DAY) : start,
            endAt: new Date((i < 3 ? now + (i + 1) * DAY : start.getTime()) + 60 * 60 * 1000),
            status: i < 3 ? 'confirmed' : 'completed',
            pricing: { amount: sale.offer.pricing.amount, currency: 'XOF' },
            paymentStatus: i < 3 ? 'unpaid' : 'paid',
            createdAt: new Date(now - sale.ago),
            updatedAt: new Date(now - sale.ago),
          };
        }),
      );
    }

    // Today's till: cash and mobile money taken by the owner, and a QR shown but never paid.
    if (index === 0) {
      const invoiceId = new mongoose.Types.ObjectId();
      await db.collection('invoices').insertOne({
        _id: invoiceId,
        organizationId: oid(org),
        contactId: oid(contacts[0].id),
        number: 'FAC-0001',
        status: 'overdue',
        items: [{ description: persona.offers[0].name, quantity: 2, unitPrice: persona.offers[0].amount }],
        currency: 'XOF',
        subtotal: persona.offers[0].amount * 2,
        taxTotal: 0,
        discountTotal: 0,
        total: persona.offers[0].amount * 2,
        amountPaid: persona.offers[0].amount,
        dueDate: new Date(now - 5 * DAY),
        issuedAt: new Date(now - 20 * DAY),
        reminderSentAt: new Date(now - 4 * DAY),
        reminderChannel: 'whatsapp',
        createdAt: new Date(now - 20 * DAY),
        updatedAt: new Date(),
      });
      const payment = (amount, method, extra = {}) => ({
        organizationId: oid(org),
        invoiceId,
        amount,
        currency: 'XOF',
        status: 'completed',
        provider: method === 'online' ? 'geniuspay' : 'manual',
        method,
        refundedAmount: 0,
        recordedBy: userId,
        createdAt: new Date(now - 60 * 60 * 1000),
        updatedAt: new Date(),
        ...extra,
      });
      await db.collection('payments').insertMany([
        payment(persona.offers[0].amount, 'cash'),
        payment(persona.offers[1 % persona.offers.length].amount, 'cash'),
        payment(persona.offers[0].amount * 2, 'online', { idempotencyKey: `counter:demo-${org}-1` }),
        payment(3000, 'online', { status: 'pending', idempotencyKey: `counter:demo-${org}-2` }),
      ]);
    }
  }

  credentials.personas.push({
    key: persona.key,
    email: persona.email,
    plan: persona.plan,
    organizations: organizations.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
  });
  console.log(`✓ ${persona.establishments.map((e) => e.name).join(' + ')} (${persona.plan})`);
}

// The demo administrator, through the same CLI an operator uses — its output (the password) is
// parsed here and goes to the credentials file only.
const cli = execFileSync('node', ['dist/create-platform-admin.js', ADMIN_EMAIL], {
  env: { ...process.env, DISABLE_BACKGROUND_WORKERS: 'true' },
  encoding: 'utf8',
});
const adminPassword = /Mot de passe : (\S+)/.exec(cli)?.[1];
if (!adminPassword) throw new Error("Le mot de passe administrateur n'a pas pu être lu.");
credentials.admin = { email: ADMIN_EMAIL, password: adminPassword };

writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
console.log(`✓ administrateur ${ADMIN_EMAIL}`);
console.log(`Identifiants écrits dans ${CREDENTIALS_FILE} (lecture réservée au propriétaire).`);
await mongoose.disconnect();
