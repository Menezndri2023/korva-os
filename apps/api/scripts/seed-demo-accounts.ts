/**
 * Seeds 5 fully-populated demo organizations, one per KORVA OS vertical, so the product can be
 * shown off end-to-end (dashboard + storefront + customer portal) without starting from an empty
 * account. Each demo org gets a real owner login, realistic CRM/catalog data, and the specific
 * operational features that vertical's "vague 2" phase shipped (see
 * `docs`/memory: staff-linked booking + waitlist + prepaid packages for Salon, open tabs +
 * modifiers + tips for Restaurant, time tracking + commission for Services Pro, group bookings +
 * attendance for Formation, variants + discount codes + shipping + low-stock alerts for Commerce).
 *
 * Follows this repo's established standalone-script pattern (see scripts/backfill-enabled-
 * modules.ts): `NestFactory.createApplicationContext(AppModule)`, direct service calls that
 * bypass HTTP/guards entirely — an already-accepted pattern for scripts run via direct server
 * access. Idempotent by SKIPPING: if an organization with the target slug already exists, that
 * organization's seeding is skipped entirely rather than attempting to upsert every sub-record.
 *
 * Usage:
 *   pnpm --filter @korva/api exec ts-node -r tsconfig-paths/register scripts/seed-demo-accounts.ts            (dry run, default)
 *   pnpm --filter @korva/api exec ts-node -r tsconfig-paths/register scripts/seed-demo-accounts.ts --apply    (writes changes)
 *
 * If plain ts-node fails to resolve `@korva/types`/`@korva/validation`'s NodeNext-style
 * `./foo.js`-pointing-at-`.ts` relative imports in your environment (a classic ts-node/CJS
 * resolution gap, unrelated to this script), build first and run the compiled output instead —
 * verified working:
 *   pnpm --filter @korva/api build && node dist/scripts/seed-demo-accounts.js [--apply]
 * (or simply let `nest start --watch` compile it for you, then run `node dist/scripts/...` —
 * dist/ stays in sync automatically while the dev server's watcher is running).
 *
 * Async side effects (Decision Engine recommendations, booking reminders, webhook deliveries)
 * are queued via the real EventBus/BullMQ and only materialize once `apps/worker` is also
 * running — the synchronous data this script writes (contacts/offers/bookings/orders/invoices)
 * is visible immediately either way. See docs/DEMO_ACCOUNTS.md for the full account list.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/identity/users/users.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { RolesService } from '../src/identity/roles/roles.service';
import { MembershipsService } from '../src/identity/memberships/memberships.service';
import { ContactsService } from '../src/crm/contacts/contacts.service';
import { OffersService } from '../src/catalog/offers/offers.service';
import { ResourcesService } from '../src/booking/resources/resources.service';
import { BookingsService } from '../src/booking/bookings/bookings.service';
import { WaitlistService } from '../src/booking/waitlist/waitlist.service';
import { CreditBalancesService } from '../src/booking/credit-balances/credit-balances.service';
import { OrdersService } from '../src/commerce/orders/orders.service';
import { InvoicesService } from '../src/finance/invoices/invoices.service';
import { PaymentsService } from '../src/finance/payments/payments.service';
import { TimeEntriesService } from '../src/finance/time-entries/time-entries.service';
import { ExpensesService } from '../src/finance/expenses/expenses.service';
import { DiscountCodesService } from '../src/finance/discount-codes/discount-codes.service';
import { PublicService } from '../src/public/public.service';
import { CustomerAuthService } from '../src/customer-auth/customer-auth.service';
import { OrganizationDocument } from '../src/organizations/schemas/organization.schema';
import { ContactDocument } from '../src/crm/contacts/schemas/contact.schema';
import { OfferDocument } from '../src/catalog/offers/schemas/offer.schema';

const DEMO_PASSWORD = 'DemoKorva2026!';

interface Services {
  users: UsersService;
  organizations: OrganizationsService;
  roles: RolesService;
  memberships: MembershipsService;
  contacts: ContactsService;
  offers: OffersService;
  resources: ResourcesService;
  bookings: BookingsService;
  waitlist: WaitlistService;
  creditBalances: CreditBalancesService;
  orders: OrdersService;
  invoices: InvoicesService;
  payments: PaymentsService;
  timeEntries: TimeEntriesService;
  expenses: ExpensesService;
  discountCodes: DiscountCodesService;
  public: PublicService;
  customerAuth: CustomerAuthService;
}

interface AccountSummary {
  orgName: string;
  slug: string;
  ownerEmail: string;
  customerLoginEmail?: string;
}

// ---- small date helpers ---------------------------------------------------------------------

/** `hour` in UTC — kept well away from midnight so every booking safely sits inside a single
 *  weekday's window regardless of the known isWithinWeeklyWindows UTC-midnight edge case. */
function atHour(daysFromNow: number, hour: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

const FULL_WEEK_AVAILABILITY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '08:00',
  endTime: '20:00',
}));

// ---- shared org/owner/staff bootstrap --------------------------------------------------------

async function ensureOwner(
  services: Services,
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const existing = await services.users.findByEmail(email);
  if (existing) return existing.id as string;
  const user = await services.users.create(email, DEMO_PASSWORD, firstName, lastName);
  return user.id as string;
}

async function ensureOrganization(
  services: Services,
  ownerUserId: string,
  input: {
    name: string;
    type: string;
    tagline: string;
    brandColor: string;
    storefrontSections?: string[];
    shippingFlatRate?: number;
  },
): Promise<OrganizationDocument | null> {
  const slug = slugify(input.name);
  const existing = await findOrganizationBySlug(services, slug);
  if (existing) {
    console.log(`  SKIP  "${input.name}" (${slug}) already exists — leaving it untouched.`);
    return null;
  }

  const organization = await services.organizations.createForOwner(ownerUserId, {
    name: input.name,
    type: input.type,
    country: 'CI',
    currency: 'XOF',
    timezone: 'Africa/Abidjan',
    language: 'fr',
  });

  await services.organizations.update(organization.id as string, {
    tagline: input.tagline,
    brandColor: input.brandColor,
    storefrontSections: input.storefrontSections as never,
    shippingFlatRate: input.shippingFlatRate,
  });

  return organization;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function findOrganizationBySlug(
  services: Services,
  slug: string,
): Promise<OrganizationDocument | null> {
  try {
    return await services.organizations.getBySlug(slug);
  } catch {
    return null;
  }
}

/** Creates a second staff user + membership for an org, returning the membership id. */
async function ensureStaffMembership(
  services: Services,
  organizationId: string,
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const userId = await ensureOwner(services, email, firstName, lastName);
  const roles = await services.roles.listForOrganization(organizationId);
  const staffRole = roles.find((role) => role.systemKey === 'STAFF');
  if (!staffRole) {
    throw new Error(`No STAFF role found for organization ${organizationId}`);
  }
  const membership = await services.memberships.create(userId, organizationId, staffRole.id);
  return membership.id as string;
}

async function createContacts(
  services: Services,
  organizationId: string,
  people: { firstName: string; lastName: string; email: string; phone?: string; tags?: string[] }[],
): Promise<ContactDocument[]> {
  const contacts: ContactDocument[] = [];
  for (const person of people) {
    contacts.push(
      await services.contacts.create(organizationId, undefined, {
        type: 'person',
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        phone: person.phone,
        tags: person.tags ?? [],
      }),
    );
  }
  return contacts;
}

async function seedCustomerPortalLogin(
  services: Services,
  slug: string,
  contact: ContactDocument,
): Promise<string> {
  await services.customerAuth.register(slug, {
    email: contact.email as string,
    password: DEMO_PASSWORD,
    firstName: contact.firstName,
    lastName: contact.lastName,
  });
  return contact.email as string;
}

// ---- Vertical 1: Salon & bien-être -----------------------------------------------------------

async function seedSalon(services: Services, summaries: AccountSummary[]): Promise<void> {
  console.log('\n=== Salon Éclat (Salon & bien-être) ===');
  const ownerUserId = await ensureOwner(services, 'demo.salon@korva.app', 'Aïcha', 'Konaté');
  const organization = await ensureOrganization(services, ownerUserId, {
    name: 'Salon Éclat',
    type: 'beauté',
    tagline: 'Coiffure, soins et bien-être au cœur d’Abidjan',
    brandColor: '#d6336c',
    storefrontSections: ['catalog', 'booking'],
  });
  if (!organization) return;
  const organizationId = organization.id as string;
  const slug = organization.slug;

  const staffMembershipId = await ensureStaffMembership(
    services,
    organizationId,
    'sophie.staff@korva.app',
    'Sophie',
    'Bamba',
  );
  await services.memberships.updateCommissionRate(staffMembershipId, 1500);

  const contacts = await createContacts(services, organizationId, [
    { firstName: 'Marie', lastName: 'Yao', email: 'marie.yao@example.com', tags: ['VIP'] },
    { firstName: 'Fatou', lastName: 'Coulibaly', email: 'fatou.coulibaly@example.com', tags: ['Fidèle'] },
    { firstName: 'Nadège', lastName: 'Kouassi', email: 'nadege.kouassi@example.com' },
    { firstName: 'Aminata', lastName: 'Diarra', email: 'aminata.diarra@example.com', tags: ['Nouveau'] },
    { firstName: 'Chantal', lastName: 'N’Guessan', email: 'chantal.nguessan@example.com' },
    { firstName: 'Estelle', lastName: 'Kacou', email: 'estelle.kacou@example.com', tags: ['VIP'] },
    { firstName: 'Ines', lastName: 'Tanoh', email: 'ines.tanoh@example.com' },
    { firstName: 'Josiane', lastName: 'Adou', email: 'josiane.adou@example.com', tags: ['Fidèle'] },
  ]);

  const haircut = await services.offers.create(organizationId, ownerUserId, {
    type: 'booking',
    name: 'Coupe & Brushing',
    description: 'Coupe personnalisée et brushing.',
    images: [],
    categories: ['Coiffure'],
    pricing: { amount: 15000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  await services.offers.create(organizationId, ownerUserId, {
    type: 'booking',
    name: 'Coloration',
    images: [],
    categories: ['Coiffure'],
    pricing: { amount: 25000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  const facial = await services.offers.create(organizationId, ownerUserId, {
    type: 'booking',
    name: 'Soin du visage',
    images: [],
    categories: ['Bien-être'],
    pricing: { amount: 18000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  const packageOffer = await services.offers.create(organizationId, ownerUserId, {
    type: 'package',
    name: 'Forfait 5 séances soin du visage',
    images: [],
    categories: ['Bien-être'],
    pricing: { amount: 75000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  const shampoo = await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Shampoing réparateur',
    images: [],
    categories: ['Boutique'],
    pricing: { amount: 6000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: true,
    stockOnHand: 24,
  });
  void shampoo;

  const room = await services.resources.create(organizationId, {
    name: 'Salle 1',
    type: 'salle',
    capacity: 1,
    active: true,
    weeklyAvailability: FULL_WEEK_AVAILABILITY,
    membershipId: staffMembershipId,
  });

  const pastBooking = await services.bookings.create(organizationId, undefined, {
    resourceId: room.id as string,
    offerId: haircut.id as string,
    contactId: contacts[0]!.id as string,
    startAt: atHour(-3, 10),
    endAt: atHour(-3, 11),
  });
  await services.bookings.complete(organizationId, ownerUserId, pastBooking.id as string, {
    attended: true,
  });

  await services.bookings.create(organizationId, undefined, {
    resourceId: room.id as string,
    offerId: facial.id as string,
    contactId: contacts[1]!.id as string,
    startAt: atHour(2, 14),
    endAt: atHour(2, 15),
  });

  const fullSlotBooking = await services.bookings.create(organizationId, undefined, {
    resourceId: room.id as string,
    offerId: haircut.id as string,
    contactId: contacts[2]!.id as string,
    startAt: atHour(4, 16),
    endAt: atHour(4, 17),
  });
  void fullSlotBooking;
  await services.waitlist.create(organizationId, ownerUserId, {
    resourceId: room.id as string,
    offerId: haircut.id as string,
    contactId: contacts[3]!.id as string,
    startAt: atHour(4, 16),
    endAt: atHour(4, 17),
  });

  await services.creditBalances.topUp(organizationId, ownerUserId, {
    contactId: contacts[4]!.id as string,
    offerId: packageOffer.id as string,
    credits: 5,
  });

  const customerLoginEmail = await seedCustomerPortalLogin(services, slug, contacts[0]!);

  summaries.push({
    orgName: organization.name,
    slug,
    ownerEmail: 'demo.salon@korva.app',
    customerLoginEmail,
  });
}

// ---- Vertical 2: Restaurant -------------------------------------------------------------------

async function seedRestaurant(services: Services, summaries: AccountSummary[]): Promise<void> {
  console.log('\n=== Le Bistrot Marché (Restaurant) ===');
  const ownerUserId = await ensureOwner(services, 'demo.restaurant@korva.app', 'Kwame', 'Assi');
  const organization = await ensureOrganization(services, ownerUserId, {
    name: 'Le Bistrot Marché',
    type: 'restauration',
    tagline: 'Cuisine locale et grillades au feu de bois',
    brandColor: '#d9480f',
    storefrontSections: ['catalog'],
  });
  if (!organization) return;
  const organizationId = organization.id as string;
  const slug = organization.slug;

  const waiterMembershipId = await ensureStaffMembership(
    services,
    organizationId,
    'ibrahim.staff@korva.app',
    'Ibrahim',
    'Traoré',
  );

  const contacts = await createContacts(services, organizationId, [
    { firstName: 'Paul', lastName: 'Kone', email: 'paul.kone@example.com' },
    { firstName: 'Sarah', lastName: 'Diabate', email: 'sarah.diabate@example.com', tags: ['Habitué'] },
    { firstName: 'Emmanuel', lastName: 'Gnahore', email: 'emmanuel.gnahore@example.com' },
    { firstName: 'Léa', lastName: 'Brou', email: 'lea.brou@example.com' },
    { firstName: 'Yves', lastName: 'Ouattara', email: 'yves.ouattara@example.com' },
    { firstName: 'Carine', lastName: 'Zadi', email: 'carine.zadi@example.com' },
    { firstName: 'Didier', lastName: 'Kra', email: 'didier.kra@example.com' },
    { firstName: 'Rachel', lastName: 'Anoh', email: 'rachel.anoh@example.com' },
  ]);

  const starter = await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Salade avocat-crevettes',
    images: [],
    categories: ['Entrées'],
    pricing: { amount: 4500, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  const mainCourse = await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Poulet braisé & attiéké',
    images: [],
    categories: ['Plats'],
    pricing: { amount: 6000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Jus de bissap',
    images: [],
    categories: ['Boissons'],
    pricing: { amount: 1500, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  const soldOut = await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Poisson braisé du jour',
    images: [],
    categories: ['Plats'],
    pricing: { amount: 7000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: true,
    stockOnHand: 5,
  });
  await services.offers.adjustStock(organizationId, ownerUserId, soldOut.id as string, {
    stockOnHand: 0,
  });

  const tables = [];
  for (let i = 1; i <= 4; i++) {
    tables.push(
      await services.resources.create(organizationId, {
        name: `Table ${i}`,
        type: 'table',
        capacity: 4,
        active: true,
        weeklyAvailability: FULL_WEEK_AVAILABILITY,
      }),
    );
  }

  const openTab = await services.orders.createOpen(organizationId, ownerUserId, {
    contactId: contacts[0]!.id as string,
    currency: 'XOF',
    resourceId: tables[2]!.id as string,
  });
  await services.orders.addItem(organizationId, ownerUserId, openTab.id as string, {
    offerId: starter.id as string,
    quantity: 2,
  });
  await services.orders.addItem(organizationId, ownerUserId, openTab.id as string, {
    offerId: mainCourse.id as string,
    quantity: 2,
    modifiers: [{ name: 'Supplément fromage', priceDelta: 500 }],
  });

  const closedTab = await services.orders.createOpen(organizationId, ownerUserId, {
    contactId: contacts[1]!.id as string,
    currency: 'XOF',
    resourceId: tables[0]!.id as string,
  });
  await services.orders.addItem(organizationId, ownerUserId, closedTab.id as string, {
    offerId: mainCourse.id as string,
    quantity: 1,
  });
  await services.orders.close(organizationId, ownerUserId, closedTab.id as string);
  await services.orders.confirm(organizationId, ownerUserId, closedTab.id as string);
  const invoice = await services.orders.generateInvoice(
    organizationId,
    ownerUserId,
    closedTab.id as string,
  );
  await services.invoices.issue(organizationId, ownerUserId, invoice.id as string);
  await services.payments.create(organizationId, ownerUserId, {
    invoiceId: invoice.id as string,
    amount: invoice.total,
    method: 'cash',
    tipAmount: 1000,
    tipStaffMembershipId: waiterMembershipId,
  });

  summaries.push({ orgName: organization.name, slug, ownerEmail: 'demo.restaurant@korva.app' });
}

// ---- Vertical 3: Services professionnels -------------------------------------------------------

async function seedServicesPro(services: Services, summaries: AccountSummary[]): Promise<void> {
  console.log('\n=== Cabinet Dupont Conseil (Services professionnels) ===');
  const ownerUserId = await ensureOwner(services, 'demo.services@korva.app', 'Jean', 'Dupont');
  const organization = await ensureOrganization(services, ownerUserId, {
    name: 'Cabinet Dupont Conseil',
    type: 'services professionnels',
    tagline: 'Conseil stratégique et accompagnement pour PME',
    brandColor: '#1864ab',
  });
  if (!organization) return;
  const organizationId = organization.id as string;
  const slug = organization.slug;

  const consultantMembershipId = await ensureStaffMembership(
    services,
    organizationId,
    'lucie.staff@korva.app',
    'Lucie',
    'Martin',
  );
  await services.memberships.updateDefaultHourlyRate(consultantMembershipId, 40000);
  await services.memberships.updateCommissionRate(consultantMembershipId, 1000);

  const contacts = await createContacts(services, organizationId, [
    { firstName: 'Société', lastName: 'Ivoire Textile', email: 'contact@ivoiretextile.example.com' },
    { firstName: 'Bakary', lastName: 'Sanogo', email: 'bakary.sanogo@example.com' },
    { firstName: 'Société', lastName: 'Nova Logistique', email: 'contact@novalogistique.example.com' },
    { firstName: 'Aya', lastName: 'Kouadio', email: 'aya.kouadio@example.com' },
    { firstName: 'Société', lastName: 'Prime Immobilier', email: 'contact@primeimmobilier.example.com' },
    { firstName: 'Moussa', lastName: 'Diallo', email: 'moussa.diallo@example.com' },
  ]);

  await services.offers.create(organizationId, ownerUserId, {
    type: 'service',
    name: 'Audit stratégique',
    images: [],
    categories: ['Conseil'],
    pricing: { amount: 500000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  await services.offers.create(organizationId, ownerUserId, {
    type: 'service',
    name: 'Accompagnement mensuel',
    images: [],
    categories: ['Conseil'],
    pricing: { amount: 300000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });

  const billableContact = contacts[0]!;
  const entryIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const entry = await services.timeEntries.create(organizationId, ownerUserId, {
      contactId: billableContact.id as string,
      date: atHour(-7 + i * 2, 9),
      durationMinutes: 120,
      description: `Séance de conseil #${i + 1}`,
      billable: true,
      hourlyRate: 40000,
      currency: 'XOF',
    });
    entryIds.push(entry.id as string);
  }
  for (const id of entryIds.slice(0, 3)) {
    await services.timeEntries.approve(organizationId, ownerUserId, id);
  }
  const timeEntriesInvoice = await services.timeEntries.generateInvoice(
    organizationId,
    ownerUserId,
    { timeEntryIds: entryIds.slice(0, 3) },
  );
  await services.invoices.issue(organizationId, ownerUserId, timeEntriesInvoice.id as string);

  await services.expenses.create(organizationId, ownerUserId, {
    category: 'Déplacement',
    description: 'Déplacement chez le client Ivoire Textile',
    amount: 25000,
    currency: 'XOF',
    date: atHour(-5, 9),
    billable: true,
    contactId: billableContact.id as string,
  });
  await services.expenses.create(organizationId, ownerUserId, {
    category: 'Fournitures',
    description: 'Fournitures de bureau',
    amount: 15000,
    currency: 'XOF',
    date: atHour(-10, 9),
    billable: false,
  });

  summaries.push({ orgName: organization.name, slug, ownerEmail: 'demo.services@korva.app' });
}

// ---- Vertical 4: Formation --------------------------------------------------------------------

async function seedFormation(services: Services, summaries: AccountSummary[]): Promise<void> {
  console.log('\n=== Académie Skillup (Formation) ===');
  const ownerUserId = await ensureOwner(services, 'demo.formation@korva.app', 'Grace', 'Ehouman');
  const organization = await ensureOrganization(services, ownerUserId, {
    name: 'Académie Skillup',
    type: 'formation',
    tagline: 'Formations professionnelles certifiantes',
    brandColor: '#2f9e44',
    storefrontSections: ['catalog', 'booking'],
  });
  if (!organization) return;
  const organizationId = organization.id as string;
  const slug = organization.slug;

  const instructorMembershipId = await ensureStaffMembership(
    services,
    organizationId,
    'oumar.staff@korva.app',
    'Oumar',
    'Fofana',
  );

  const contacts = await createContacts(services, organizationId, [
    { firstName: 'Awa', lastName: 'Toure', email: 'awa.toure@example.com' },
    { firstName: 'Serge', lastName: 'Kouame', email: 'serge.kouame@example.com' },
    { firstName: 'Nina', lastName: 'Angoua', email: 'nina.angoua@example.com' },
    { firstName: 'David', lastName: 'Beugre', email: 'david.beugre@example.com' },
    { firstName: 'Sandrine', lastName: 'Yapi', email: 'sandrine.yapi@example.com' },
    { firstName: 'Franck', lastName: 'Aka', email: 'franck.aka@example.com' },
    { firstName: 'Michelle', lastName: 'Dosso', email: 'michelle.dosso@example.com' },
    { firstName: 'Patrick', lastName: 'Gbagbo', email: 'patrick.gbagbo.demo@example.com' },
  ]);

  const session = await services.offers.create(organizationId, ownerUserId, {
    type: 'booking',
    name: 'Formation Excel Avancé',
    images: [],
    categories: ['Bureautique'],
    pricing: { amount: 45000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });
  await services.offers.create(organizationId, ownerUserId, {
    type: 'booking',
    name: 'Formation Leadership',
    images: [],
    categories: ['Management'],
    pricing: { amount: 60000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: false,
  });

  const room = await services.resources.create(organizationId, {
    name: 'Salle de formation A',
    type: 'salle',
    capacity: 3,
    active: true,
    weeklyAvailability: FULL_WEEK_AVAILABILITY,
    membershipId: instructorMembershipId,
  });

  const sessionStart = atHour(5, 9);
  const sessionEnd = atHour(5, 12);
  const attendeeBookings = [];
  for (let i = 0; i < 3; i++) {
    attendeeBookings.push(
      await services.bookings.create(organizationId, undefined, {
        resourceId: room.id as string,
        offerId: session.id as string,
        contactId: contacts[i]!.id as string,
        startAt: sessionStart,
        endAt: sessionEnd,
      }),
    );
  }
  // Waitlist BEFORE completing any booking — assertSlotAvailable only counts active
  // (pending/confirmed) bookings toward capacity, so completing all 3 first would make the
  // slot look available again and this call would (correctly) reject as WAITLIST_SLOT_AVAILABLE.
  await services.waitlist.create(organizationId, ownerUserId, {
    resourceId: room.id as string,
    offerId: session.id as string,
    contactId: contacts[3]!.id as string,
    startAt: sessionStart,
    endAt: sessionEnd,
  });

  await services.bookings.complete(organizationId, ownerUserId, attendeeBookings[0]!.id as string, {
    attended: true,
  });
  await services.bookings.complete(organizationId, ownerUserId, attendeeBookings[1]!.id as string, {
    attended: true,
  });
  await services.bookings.complete(organizationId, ownerUserId, attendeeBookings[2]!.id as string, {
    attended: false,
  });

  const customerLoginEmail = await seedCustomerPortalLogin(services, slug, contacts[4]!);

  summaries.push({
    orgName: organization.name,
    slug,
    ownerEmail: 'demo.formation@korva.app',
    customerLoginEmail,
  });
}

// ---- Vertical 5: Commerce & e-commerce ----------------------------------------------------------

async function seedCommerce(services: Services, summaries: AccountSummary[]): Promise<void> {
  console.log('\n=== Boutique Nova (Commerce & e-commerce) ===');
  const ownerUserId = await ensureOwner(services, 'demo.commerce@korva.app', 'Nadia', 'Kone');
  const organization = await ensureOrganization(services, ownerUserId, {
    name: 'Boutique Nova',
    type: 'commerce',
    tagline: 'Mode et accessoires livrés partout en Côte d’Ivoire',
    brandColor: '#7048e8',
    storefrontSections: ['catalog'],
    shippingFlatRate: 2500,
  });
  if (!organization) return;
  const organizationId = organization.id as string;
  const slug = organization.slug;

  const contacts = await createContacts(services, organizationId, [
    { firstName: 'Grace', lastName: 'Amani', email: 'grace.amani@example.com' },
    { firstName: 'Steven', lastName: 'Kouassi', email: 'steven.kouassi@example.com' },
    { firstName: 'Prisca', lastName: 'Ble', email: 'prisca.ble@example.com' },
    { firstName: 'Junior', lastName: 'Dje', email: 'junior.dje@example.com' },
    { firstName: 'Clarisse', lastName: 'Yeo', email: 'clarisse.yeo@example.com' },
    { firstName: 'Herve', lastName: 'Kouassi', email: 'herve.kouassi@example.com' },
    { firstName: 'Ornella', lastName: 'Kadio', email: 'ornella.kadio@example.com' },
    { firstName: 'William', lastName: 'Assale', email: 'william.assale@example.com' },
  ]);

  const tshirt: OfferDocument = await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'T-shirt "Nova"',
    images: [],
    categories: ['Vêtements'],
    pricing: { amount: 8000, currency: 'XOF' },
    variants: [
      { name: 'S', priceOverride: 8000 },
      { name: 'M', priceOverride: 8000 },
      { name: 'L', priceOverride: 8500 },
    ],
    status: 'active',
    customFields: {},
    trackStock: true,
    stockOnHand: 40,
  });
  await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Sac à main artisanal',
    images: [],
    categories: ['Accessoires'],
    pricing: { amount: 22000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: true,
    stockOnHand: 15,
  });
  await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Sandales en cuir',
    images: [],
    categories: ['Chaussures'],
    pricing: { amount: 18000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: true,
    stockOnHand: 20,
  });
  const lowStockItem = await services.offers.create(organizationId, ownerUserId, {
    type: 'product',
    name: 'Casquette Édition Limitée',
    images: [],
    categories: ['Accessoires'],
    pricing: { amount: 5000, currency: 'XOF' },
    variants: [],
    status: 'active',
    customFields: {},
    trackStock: true,
    stockOnHand: 1,
  });

  await services.discountCodes.create(organizationId, {
    code: 'BIENVENUE10',
    type: 'percentage',
    value: 10,
    scope: 'all',
    offerIds: [],
    active: true,
  });

  // Storefront-shaped order (variants + discount code + shipping), via the exact same
  // PublicService#createOrder path apps/storefront and the embeddable widget both call —
  // realistic seed data, not a shortcut around the real checkout logic.
  await services.public.createOrder(slug, {
    items: [{ offerId: tshirt.id as string, variantId: variantId(tshirt, 'L'), quantity: 2 }],
    currency: 'XOF',
    contact: { email: contacts[0]!.email as string, firstName: contacts[0]!.firstName },
    discountCode: 'BIENVENUE10',
    shippingAddress: {
      line1: 'Rue des Jardins, Cocody',
      city: 'Abidjan',
      postalCode: '00225',
      country: 'CI',
    },
  });

  // Depletes the last unit through the real storefront order path — publishes
  // offer.stock_depleted for real, which the Decision Engine's LowStockAlertRule reacts to
  // (materializes as a Recommendation once apps/worker processes the event).
  await services.public.createOrder(slug, {
    items: [{ offerId: lowStockItem.id as string, quantity: 1 }],
    currency: 'XOF',
    contact: { email: contacts[1]!.email as string, firstName: contacts[1]!.firstName },
  });

  const customerLoginEmail = await seedCustomerPortalLogin(services, slug, contacts[2]!);

  summaries.push({
    orgName: organization.name,
    slug,
    ownerEmail: 'demo.commerce@korva.app',
    customerLoginEmail,
  });
}

/** OfferVariant subdocuments carry a Mongoose-assigned `_id` at runtime that the TS class never
 *  declares — same runtime-only access pattern PublicService#createOrder itself already uses. */
function variantId(offer: OfferDocument, name: string): string {
  const variant = offer.variants.find((v) => v.name === name);
  if (!variant) throw new Error(`Variant "${name}" not found on offer "${offer.name}"`);
  return String((variant as unknown as { _id: unknown })._id);
}

// ---- entry point ----------------------------------------------------------------------------

async function run() {
  const apply = process.argv.includes('--apply');
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run seed-demo-accounts.ts with NODE_ENV=production.');
    process.exit(1);
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — seeding demo accounts`);
  if (!apply) {
    console.log(
      'Dry run: this script only checks which demo organizations already exist. ' +
        'Pass --apply to actually create the missing ones (dry run cannot preview every ' +
        'sub-record individually — this is a demo seed script, not a production migration).',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const services: Services = {
      users: app.get(UsersService),
      organizations: app.get(OrganizationsService),
      roles: app.get(RolesService),
      memberships: app.get(MembershipsService),
      contacts: app.get(ContactsService),
      offers: app.get(OffersService),
      resources: app.get(ResourcesService),
      bookings: app.get(BookingsService),
      waitlist: app.get(WaitlistService),
      creditBalances: app.get(CreditBalancesService),
      orders: app.get(OrdersService),
      invoices: app.get(InvoicesService),
      payments: app.get(PaymentsService),
      timeEntries: app.get(TimeEntriesService),
      expenses: app.get(ExpensesService),
      discountCodes: app.get(DiscountCodesService),
      public: app.get(PublicService),
      customerAuth: app.get(CustomerAuthService),
    };

    if (!apply) {
      for (const [name, slug] of [
        ['Salon Éclat', 'salon-eclat'],
        ['Le Bistrot Marché', 'le-bistrot-marche'],
        ['Cabinet Dupont Conseil', 'cabinet-dupont-conseil'],
        ['Académie Skillup', 'academie-skillup'],
        ['Boutique Nova', 'boutique-nova'],
      ]) {
        const existing = await findOrganizationBySlug(services, slug as string);
        console.log(
          existing
            ? `  EXISTS  "${name}" (${slug}) — would be skipped`
            : `  MISSING "${name}" (${slug}) — would be created`,
        );
      }
      return;
    }

    const summaries: AccountSummary[] = [];
    await seedSalon(services, summaries);
    await seedRestaurant(services, summaries);
    await seedServicesPro(services, summaries);
    await seedFormation(services, summaries);
    await seedCommerce(services, summaries);

    console.log('\n=== Summary ===');
    if (summaries.length === 0) {
      console.log('Every demo organization already existed — nothing new was created.');
    }
    for (const summary of summaries) {
      console.log(`\n${summary.orgName} (${summary.slug})`);
      console.log(`  Dashboard login:  ${summary.ownerEmail} / ${DEMO_PASSWORD}`);
      if (summary.customerLoginEmail) {
        console.log(
          `  Storefront login: ${summary.customerLoginEmail} / ${DEMO_PASSWORD} (at /${summary.slug}/account/login)`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
