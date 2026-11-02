import type { Locale } from "./i18n.ts";

/**
 * "Comment avez-vous connu KORVA ?" — asked once, when the business is created. The answer is
 * what tells KORVA which channel of its marketing plan actually brings businesses.
 */
export const ACQUISITION_SOURCES = [
  "word_of_mouth",
  "referral",
  "whatsapp",
  "facebook_instagram",
  "tiktok",
  "google",
  "ai_assistant",
  "event",
  "other",
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

const ACQUISITION_SOURCE_LABELS: Record<AcquisitionSource, [string, string]> = {
  word_of_mouth: ["Bouche-à-oreille", "Word of mouth"],
  referral: ["Recommandé par un commerçant qui utilise KORVA", "Recommended by a business that uses KORVA"],
  whatsapp: ["WhatsApp", "WhatsApp"],
  facebook_instagram: ["Facebook ou Instagram", "Facebook or Instagram"],
  tiktok: ["TikTok", "TikTok"],
  google: ["Recherche Google", "Google search"],
  ai_assistant: ["Un assistant IA (ChatGPT, Gemini…)", "An AI assistant (ChatGPT, Gemini…)"],
  event: ["Salon, formation ou démonstration", "Trade fair, training or demo"],
  other: ["Autre", "Other"],
};

export function acquisitionSourceLabel(source: AcquisitionSource, locale: Locale): string {
  const [fr, en] = ACQUISITION_SOURCE_LABELS[source];
  return locale === "en" ? en : fr;
}

/**
 * Parrainage: a business shares its link; the business that signs up through it gets a longer
 * free trial of the Pro plan, and the one that shared it gets a month of Pro once the new
 * business pays its first KORVA invoice — never on signup alone, so a fake account earns nothing.
 * Both rewards are trial time, not money: nothing is ever paid out for a referral.
 */
export const REFERRAL_REWARD = {
  /** The referred business's signup trial, instead of SIGNUP_TRIAL.days. */
  refereeTrialDays: 30,
  /** Pro days added to the referring business once the referred one has paid. */
  referrerProDays: 30,
} as const;

/** GET /organizations/me/referral */
export interface ReferralSummary {
  code: string;
  /** Businesses that signed up with this code. */
  signedUp: number;
  /** Of those, the ones that paid — each one earned this business REFERRAL_REWARD.referrerProDays. */
  rewarded: number;
}
