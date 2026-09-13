import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type {
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

  /** Undefined means "cash only" (see PublicService's `?? ['cash']` fallback) — `default:
   *  undefined` opts out of Mongoose's array-path auto-`[]`-init, same reasoning as
   *  `storefrontSections` above; a real stored `[]` would otherwise be indistinguishable from
   *  "never configured" and silently accept no payment method at all. */
  @Prop({ type: [String], default: undefined })
  acceptedPaymentMethods?: PaymentMethod[];

  /** Long-form "about us" text for the public storefront — Pro plan and above, see
   *  EntitlementsService.assertContentSectionsAllowed. */
  @Prop()
  aboutText?: string;

  /** Org-configurable `<title>`/meta-description override for the public storefront page —
   *  available at every plan tier (unlike the content sections above), since basic SEO control
   *  isn't a premium feature. Undefined falls back to PublicService's auto-derived title/description
   *  (organization name + enabled-services summary) — see [slug]/page.tsx's generateMetadata. */
  @Prop()
  seoTitle?: string;

  @Prop()
  seoDescription?: string;

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
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
