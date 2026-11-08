import {
  tradeVocabulary,
  type BusinessModel,
  type BusinessModelDefinition,
  type TradeTool,
  type TradeVocabulary,
} from "./business-models.ts";
import type { PlanFeature } from "./plan-tiers.ts";
import type { ResourceKind } from "./booking.ts";
import type { PayoutStatus, WalletEntryKind } from "./wallet.ts";
import type { FulfillmentMode } from "./commerce.ts";
import { PLAN_NAMES, type PlanKey } from "./plan-tiers.ts";
import type { VerticalTemplate } from "./verticals.ts";

/**
 * KORVA's languages. French is the default and the source text everywhere; English was added on
 * 2026-11-01 to open KORVA to anglophone countries. Every text that reaches a user exists in both
 * — the English tables below are typed against the French ones, so a missing translation is a
 * compile error, not an untranslated screen.
 */
export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** "en-GB", "en", "EN" → "en"; anything else → French. */
export function localeFrom(value: string | null | undefined): Locale {
  const base = (value ?? "").trim().slice(0, 2).toLowerCase();
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

type BusinessModelText = Pick<BusinessModelDefinition, "label" | "description" | "siteKind"> & {
  vocabulary: TradeVocabulary;
};

const BUSINESS_MODEL_EN: Record<BusinessModel, BusinessModelText> = {
  retail: {
    label: "Shop",
    description: "You sell products, in store or online.",
    siteKind: "Online shop",
    vocabulary: { catalog: "Products", bookings: "Bookings", crm: "Customers" },
  },
  restaurant: {
    label: "Restaurant",
    description: "Restaurant, caterer, takeaway or delivery.",
    siteKind: "Online menu and ordering",
    vocabulary: { catalog: "Menu", bookings: "Table bookings", crm: "Customers" },
  },
  appointments: {
    label: "Appointments",
    description: "Your customers book a service: salon, beauty, sport, home services.",
    siteKind: "Website with online booking",
    vocabulary: { catalog: "Services", bookings: "Appointments", crm: "Customers" },
  },
  lodging: {
    label: "Lodging",
    description: "Guesthouses, B&Bs, hotels: your guests book stays.",
    siteKind: "Website with stay booking",
    vocabulary: { catalog: "Rooms and stays", bookings: "Bookings", crm: "Guests" },
  },
  training: {
    label: "Training",
    description: "Courses, workshops, classes: your customers enrol in sessions.",
    siteKind: "Online academy",
    vocabulary: { catalog: "Courses and offers", bookings: "Enrolments", crm: "Learners" },
  },
  quotes: {
    label: "Services on quote",
    description: "Consulting, crafts, agencies, events: you work on quotes.",
    siteKind: "Website with quote requests",
    vocabulary: { catalog: "Services", bookings: "Appointments", crm: "Leads and customers" },
  },
  real_estate: {
    label: "Real estate",
    description: "Agencies, property management: you present properties.",
    siteKind: "Property listings site",
    vocabulary: { catalog: "Properties", bookings: "Viewings", crm: "Leads and customers" },
  },
  association: {
    label: "Association",
    description: "Associations, NGOs: memberships, donations and members.",
    siteKind: "Website with memberships and donations",
    vocabulary: { catalog: "Memberships and donations", bookings: "Events", crm: "Members" },
  },
};

const DEFAULT_TRADE_VOCABULARY_EN: TradeVocabulary = { catalog: "Catalogue", bookings: "Bookings", crm: "CRM" };

/** The words of a type of activity's screens in a language; no type of activity → the generic ones. */
export function tradeVocabularyIn(businessModel: BusinessModel | undefined, locale: Locale): TradeVocabulary {
  if (locale === "fr") return tradeVocabulary(businessModel);
  return businessModel ? BUSINESS_MODEL_EN[businessModel].vocabulary : DEFAULT_TRADE_VOCABULARY_EN;
}

/** A type of activity's words in a language (French comes from BUSINESS_MODEL_DEFINITIONS). */
export function businessModelText(definition: BusinessModelDefinition, locale: Locale): BusinessModelText {
  return locale === "en" ? BUSINESS_MODEL_EN[definition.key] : definition;
}

const VERTICAL_EN: Record<string, { label: string; description: string; offers?: Record<string, string> }> = {
  beauty_wellness: {
    label: "Salon & wellness",
    description: "Hair, beauty, spa — bookings and customer follow-up.",
    offers: {
      "Coupe femme": "Women's haircut",
      "Coupe homme": "Men's haircut",
      Coloration: "Colouring",
      Brushing: "Blow-dry",
      "Soin du visage": "Facial",
      Manucure: "Manicure",
    },
  },
  restaurant: {
    label: "Restaurant",
    description: "Orders, kitchen and customer follow-up.",
    offers: {
      "Plat du jour": "Dish of the day",
      Entrée: "Starter",
      Dessert: "Dessert",
      "Menu midi": "Lunch menu",
      Boisson: "Drink",
    },
  },
  professional_services: {
    label: "Professional services",
    description: "Consulting, coaching, agencies — sales follow-up and invoicing.",
    offers: {
      "Premier rendez-vous": "First meeting",
      Audit: "Audit",
      "Accompagnement mensuel": "Monthly support",
      "Formation sur mesure": "Custom training",
    },
  },
  training: {
    label: "Training",
    description: "Sessions, workshops and courses — seat booking.",
    offers: {
      "Séance découverte": "Taster session",
      "Atelier d'une journée": "One-day workshop",
      "Formation complète": "Full course",
      "Accompagnement individuel": "One-to-one coaching",
    },
  },
  commerce: { label: "Retail & e-commerce", description: "Selling products, in store or online." },
  health_practice: {
    label: "Health & wellbeing (non-medical)",
    description: "Physiotherapy, osteopathy, health coaching, nutrition — appointments and follow-up.",
    offers: {
      "Première consultation": "First consultation",
      "Séance de suivi": "Follow-up session",
      "Bilan complet": "Full assessment",
    },
  },
  trades_construction: {
    label: "Trades & construction",
    description: "Plumbing, electrics, carpentry, painting — quotes and call-outs.",
    offers: {
      "Visite technique et devis": "Site visit and quote",
      "Dépannage urgent": "Emergency call-out",
      "Intervention à l'heure": "Hourly work",
    },
  },
  real_estate: {
    label: "Real estate",
    description: "Estate agencies, property management — case follow-up.",
  },
  hospitality: {
    label: "Hospitality & tourism",
    description: "Guesthouses, B&Bs, lodgings — stay bookings.",
    offers: { Nuitée: "Night", "Petit-déjeuner": "Breakfast", "Séjour deux nuits": "Two-night stay" },
  },
  fashion_retail: {
    label: "Fashion & clothing",
    description: "Ready-to-wear, accessories, shoes — sold in store or online.",
  },
  food_retail: {
    label: "Grocery & food",
    description: "Groceries, greengrocers, bakeries — retail and made-to-order.",
    offers: {
      "Panier de saison": "Seasonal box",
      "Vente au kilo": "Sold by the kilo",
      "Commande sur mesure": "Custom order",
    },
  },
  fitness_sport: {
    label: "Sport & fitness",
    description: "Gyms, personal trainers, group classes — session booking.",
    offers: {
      "Séance d'essai": "Trial session",
      "Cours collectif": "Group class",
      "Coaching individuel": "Personal training",
      "Abonnement mensuel": "Monthly membership",
    },
  },
  digital_agency: {
    label: "IT & digital agency",
    description: "Development, marketing, design — sales follow-up and project invoicing.",
    offers: {
      "Audit et cadrage": "Audit and scoping",
      "Site vitrine": "Showcase website",
      "Maintenance mensuelle": "Monthly maintenance",
    },
  },
  events_creative: {
    label: "Events & creative",
    description: "Photographers, event caterers, DJs, decorators — quotes and services.",
    offers: {
      "Reportage photo": "Photo shoot",
      "Prestation sur événement": "Event service",
      "Forfait mariage": "Wedding package",
    },
  },
  nonprofit_association: {
    label: "Association & NGO",
    description: "Associations, NGOs — memberships, donations and member follow-up.",
    offers: { "Adhésion annuelle": "Annual membership", "Don libre": "Donation" },
  },
  childcare_personal_services: {
    label: "Childcare & personal services",
    description: "Childcare, home help, cleaning — scheduling visits.",
    offers: {
      "Garde à l'heure": "Hourly childcare",
      "Ménage deux heures": "Two-hour cleaning",
      "Aide aux devoirs": "Homework help",
    },
  },
  agriculture_direct_sale: {
    label: "Farming & direct sales",
    description: "Producers, farms, direct sales — orders and boxes.",
    offers: {
      "Panier hebdomadaire": "Weekly box",
      "Vente au kilo": "Sold by the kilo",
      "Commande groupée": "Group order",
    },
  },
};

/** A trade's label, description and suggested offers in a language. */
export function verticalText(
  template: VerticalTemplate,
  locale: Locale,
): { label: string; description: string; offerName: (name: string) => string } {
  if (locale === "fr") {
    return { label: template.label, description: template.description, offerName: (name) => name };
  }
  const en = VERTICAL_EN[template.key];
  return {
    label: en?.label ?? template.label,
    description: en?.description ?? template.description,
    offerName: (name) => en?.offers?.[name] ?? name,
  };
}

export const PLAN_FEATURE_LABELS_EN: Record<PlanFeature, string> = {
  online_payment: "Online payment",
  no_korva_branding: "Website without the “Powered by KORVA” mention",
  customer_accounts: "Customer accounts on your website",
  kitchen_display: "Kitchen display",
  offer_variants: "Product variants",
  compare_at_price: "Strike-through prices (promotions)",
  both_channels: "Bookings and orders at the same time",
  site_about_faq: "“About us” and FAQ pages on your website",
  site_announcement: "Announcement bar at the top of your website (offer, opening hours, news)",
  site_showcase: "Team, photo gallery and testimonials on your website",
  featured_offers: "Your favourites showcased at the top of your website",
  site_tracking: "Audience and ad tracking on your website: Google Analytics and Meta Pixel, with a consent banner",
  warehouses: "Several warehouses",
  suppliers: "Suppliers and purchase orders",
  advanced_analytics: "Advanced statistics: comparisons, best customers and sales",
  data_export: "Excel export of your sales, bookings and customers",
  cash_closing: "Daily till report and closing, per employee",
  payment_reminders: "Automatic reminders for unpaid invoices, by WhatsApp or e-mail",
  network_overview: "Overview of all your locations",
  accounting_export: "Accounting exports: sales journal and VAT",
  custom_roles: "Custom roles and permissions for your team",
  hero_slideshow: "Photo slideshow on your website's home page (up to 5 photos)",
};

export const TRADE_TOOL_LABELS_EN: Record<TradeTool, string> = {
  orders: "Orders",
  returns: "Returns",
  bookings: "Bookings",
};

/** A plan's name in a language: only the free plan's changes ("Gratuit" / "Free"). */
export function planName(plan: PlanKey, locale: Locale): string {
  return locale === "en" && plan === "free" ? "Free" : PLAN_NAMES[plan];
}

export const FULFILLMENT_MODE_LABELS_EN: Record<FulfillmentMode, string> = {
  delivery: "Delivery",
  pickup: "Collection",
  dine_in: "Eat in",
};

export const WALLET_ENTRY_LABELS_EN: Record<WalletEntryKind, string> = {
  sale: "Sale paid online",
  provider_fee: "Payment fee (GeniusPay)",
  conversion_fee: "Currency conversion (GeniusPay)",
  commission: "KORVA commission",
  payout: "Withdrawal",
  payout_fee: "Withdrawal fee",
  payout_reversal: "Withdrawal cancelled — amount returned",
  refund: "Customer refund",
  refund_reversal: "Refund cancelled — amount returned",
  subscription: "KORVA plan paid from the balance",
  subscription_reversal: "KORVA plan — amount returned",
  adjustment: "Correction by KORVA",
};

export const PAYOUT_STATUS_LABELS_EN: Record<PayoutStatus, string> = {
  requested: "Requested",
  processing: "Being sent",
  completed: "Paid out",
  failed: "Failed — amount returned",
  rejected: "Rejected — amount returned",
};

export const RESOURCE_KIND_LABELS_EN: Record<ResourceKind, string> = {
  person: "Team member",
  room: "Place (room, booth, table, bedroom)",
  equipment: "Equipment",
};

/** Sunday-first short weekday names, as the API's dayOfWeek (0 = Sunday). */
export const WEEKDAY_SHORT: Record<Locale, readonly string[]> = {
  fr: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

const STARTER_WORKFLOW_NAMES_EN: Record<string, string> = {
  "Confirmation de réservation": "Booking confirmation",
  "Nouvelle commande": "New order",
  "Qualifier un nouveau prospect": "Qualify a new lead",
  "Nouvelle inscription": "New enrolment",
  "Confirmation de rendez-vous": "Appointment confirmation",
  "Qualifier une nouvelle demande": "Qualify a new request",
  "Qualifier un nouveau contact": "Qualify a new contact",
  "Confirmation de séjour": "Stay confirmation",
  "Confirmation de séance": "Session confirmation",
  "Nouvelle adhésion": "New membership",
  "Confirmation d'intervention": "Visit confirmation",
};

/** A trade's starter automation name in a language. */
export function starterWorkflowName(name: string, locale: Locale): string {
  return locale === "en" ? (STARTER_WORKFLOW_NAMES_EN[name] ?? name) : name;
}
