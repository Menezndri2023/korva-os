import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BUSINESS_MODELS, FULFILLMENT_MODES, TRADE_TOOLS } from '@korva/types';
import type {
  BusinessModel,
  DeliveryZone,
  FulfillmentMode,
  FaqItem,
  GalleryImage,
  KorvaModule,
  OrganizationSettings,
  PaymentMethod,
  StorefrontFontPairingKey,
  StorefrontPaletteKey,
  StorefrontSection,
  StorefrontTemplateKey,
  TeamMember,
  Testimonial,
  TradeTool,
} from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ timestamps: true, collection: 'organizations', toJSON: idToJson })
export class Organization {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  slug!: string;

  @Prop()
  legalName?: string;

  /** Free-form on purpose — organizations must not be limited to a fixed set of business types. */
  @Prop({ required: true })
  type!: string;

  /** See BUSINESS_MODELS in @korva/types. Stored so the type of activity no longer depends on
   *  the free-text `type` above matching a trade. */
  @Prop({ type: String, enum: BUSINESS_MODELS })
  businessModel?: BusinessModel;

  @Prop({ required: true })
  country!: string;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true })
  timezone!: string;

  @Prop({ default: 'fr' })
  language!: string;

  @Prop()
  logo?: string;

  /** Hex color (e.g. "#1a73e8"), used as a single storefront accent — see storefront-client.tsx. */
  @Prop()
  brandColor?: string;

  /** Short pitch shown under the org name in the storefront hero — see storefront-client.tsx. */
  @Prop()
  tagline?: string;

  /** Public contact details on the site (footer, WhatsApp button) — every plan. */
  @Prop()
  contactPhone?: string;

  /** International format ("+225 07…"); the storefront turns it into a wa.me link. */
  @Prop()
  whatsappNumber?: string;

  @Prop()
  contactAddress?: string;

  /** Undefined = on. See ReviewRequestsService. */
  @Prop()
  reviewRequestsEnabled?: boolean;

  /** When the "your site has no offer online yet" reminder went out — at most once per
   *  organization. See activation/activation-nudge.service.ts. */
  @Prop()
  activationNudgeSentAt?: Date;

  /** Set by KORVA's administration (PlatformAdminService.suspend): the dashboard refuses every
   *  request in this organization's context (TenantGuard) and the public site answers as if
   *  offline (PublicService.assertModuleEnabled). Cleared on reactivation; no data is touched. */
  @Prop()
  suspendedAt?: Date;

  @Prop()
  suspensionReason?: string;

  /** Wide banner image for the storefront hero, distinct from `logo` (which stays small, in the header). */
  @Prop()
  heroImage?: string;

  /**
   * Undefined means "show every section enabledModules allows" — see STOREFRONT_SECTIONS
   * (@korva/types). `default: undefined` opts out of Mongoose's usual array-path behavior of
   * auto-initializing an unset array to `[]` — that default empty array would be indistinguishable
   * from "the org explicitly chose to show nothing," which PublicService#computeVisibleSections
   * must tell apart from "never configured."
   */
  @Prop({ type: [String], default: undefined })
  storefrontSections?: StorefrontSection[];

  /** Explicit storefront visual template choice — see @korva/types storefront-themes.ts.
   *  Undefined falls back to the org's vertical default, or "essentiel" — see
   *  PublicService#resolveStorefrontTheme. Enforced against the org's plan by
   *  EntitlementsService.assertStorefrontThemeAllowed. */
  @Prop()
  storefrontTemplate?: StorefrontTemplateKey;

  /** Undefined means "deterministically derived from the organization id" — see PublicService. */
  @Prop()
  storefrontPalette?: StorefrontPaletteKey;

  @Prop()
  storefrontFontPairing?: StorefrontFontPairingKey;

  /** Flat shipping rate applied to every storefront order at checkout — undefined means no
   *  shipping cost is charged. Simplest of the "tarif fixe ou par méthode" options the plan
   *  allowed; a per-method rate table is a fast-follow if a real need for it comes up. */
  @Prop()
  shippingFlatRate?: number;

  /** See Organization.fulfillmentModes in @korva/types. `default: undefined` keeps "never
   *  configured" distinguishable from an empty array — Mongoose otherwise fills array paths. */
  @Prop({ type: [String], enum: FULFILLMENT_MODES, default: undefined })
  fulfillmentModes?: FulfillmentMode[];

  @Prop({ type: [Object], default: undefined })
  deliveryZones?: DeliveryZone[];

  @Prop()
  pickupInstructions?: string;

  @Prop({ min: 0 })
  orderLeadTimeMinutes?: number;

  /** See Organization.checkInTime / checkOutTime in @korva/types ("HH:mm"). */
  @Prop()
  checkInTime?: string;

  @Prop()
  checkOutTime?: string;

  /** Undefined means "cash only" (see PublicService's `?? ['cash']` fallback) — `default:
   *  undefined` opts out of Mongoose's array-path auto-`[]`-init, same reasoning as
   *  `storefrontSections` above; a real stored `[]` would otherwise be indistinguishable from
   *  "never configured" and silently accept no payment method at all. */
  @Prop({ type: [String], default: undefined })
  acceptedPaymentMethods?: PaymentMethod[];

  /** See Organization.loyalty in @korva/types. */
  @Prop({
    type: {
      enabled: Boolean,
      stampsRequired: Number,
      reward: String,
      _id: false,
    },
    default: undefined,
  })
  loyalty?: { enabled: boolean; stampsRequired: number; reward: string };

  /** See Organization.onlinePaymentTerms in @korva/types. */
  @Prop({
    type: {
      version: String,
      acceptedAt: Date,
      acceptedByUserId: { type: Types.ObjectId, ref: 'User' },
      _id: false,
    },
    default: undefined,
  })
  onlinePaymentTerms?: {
    version: string;
    acceptedAt: Date;
    acceptedByUserId: Types.ObjectId;
  };

  /** Long-form "about us" text for the public storefront — Starter plan and above, see
   *  OrganizationsService.update (site_about_faq / site_showcase). */
  @Prop()
  aboutText?: string;

  /** The public site's announcement band — Starter and above (site_announcement). */
  @Prop()
  announcement?: string;

  /** Org-configurable `<title>`/meta-description override for the public storefront page —
   *  available at every plan tier (unlike the content sections above), since basic SEO control
   *  isn't a premium feature. Undefined falls back to PublicService's auto-derived title/description
   *  (organization name + enabled-services summary) — see [slug]/page.tsx's generateMetadata. */
  @Prop()
  seoTitle?: string;

  @Prop()
  seoDescription?: string;

  /** Phase E3 (docs/KORVA_OS_V2_AUDIT.md §2.6) — v1 custom domain: a bare hostname (no scheme,
   *  no path, e.g. "www.masociete.com") the owner points at the storefront via CNAME. `sparse:
   *  true` lets every org without one omit the field entirely rather than colliding on a shared
   *  `null` under the unique index — the same reasoning as `slug`'s own uniqueness, just
   *  optional. Resolution (domain -> slug) happens in apps/storefront's own middleware via
   *  PublicSitesController#resolveDomain, never client-side. */
  @Prop({ unique: true, sparse: true, lowercase: true, trim: true })
  customDomain?: string;

  /** `default: undefined` — same reasoning as `storefrontSections` above: an unset array must
   *  stay distinguishable from "explicitly cleared to empty" is not a concern here (there's no
   *  meaningful difference for content sections), but the auto-`[]`-init would still make every
   *  organization "have" an (empty) array, which is harmless but pointless to store. */
  @Prop({ type: [Object], default: undefined })
  testimonials?: Testimonial[];

  @Prop({ type: [Object], default: undefined })
  teamMembers?: TeamMember[];

  @Prop({ type: [Object], default: undefined })
  galleryImages?: GalleryImage[];

  @Prop({ type: [Object], default: undefined })
  faqItems?: FaqItem[];

  @Prop({ type: Object, default: { onboardingCompleted: false } })
  settings!: OrganizationSettings;

  @Prop({ type: [String], default: [] })
  enabledModules!: KorvaModule[];

  /**
   * Trade tools the owner brought back into the menu although their type of activity does not
   * use them (BusinessModelDefinition.tools). Menu only — never a permission. `default:
   * undefined` so existing documents are not filled with `[]`.
   */
  @Prop({ type: [String], enum: TRADE_TOOLS, default: undefined })
  extraTools?: TradeTool[];

  /**
   * AI autonomy level 4 (docs/KORVA_OS_V2_AUDIT.md §2.3): tool names from this list skip the
   * `AiPendingAction` human-confirmation step even though `AiTool.sensitive` is true for them —
   * an explicit, per-org, per-tool opt-in layered over the existing binary gate, not a
   * replacement for it. The calling user must still hold `ai.execute_sensitive_actions`; this
   * only removes the separate confirm click, never the underlying permission requirement. See
   * AiOrchestratorService.executeToolCall. `default: undefined`, same array-default reasoning as
   * `storefrontSections` above.
   */
  @Prop({ type: [String], default: undefined })
  aiAutoApprovedTools?: string[];

  /** "Comment avez-vous connu KORVA ?" at creation (@korva/types growth.ts). */
  @Prop()
  acquisitionSource?: string;

  /** This business's parrainage code, created the first time it opens its referral page. */
  @Prop()
  referralCode?: string;

  /** The business whose parrainage link this one signed up with. */
  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  referredByOrganizationId?: Types.ObjectId;

  /** When the referring business got its reward for this one — once, on its first payment. */
  @Prop({ type: Date })
  referralRewardedAt?: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
// Created by migration 0016 in production (autoIndex is off there).
OrganizationSchema.index({ referralCode: 1 }, { unique: true, sparse: true });
OrganizationSchema.index({ referredByOrganizationId: 1 }, { sparse: true });
