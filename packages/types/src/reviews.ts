export const REVIEW_ENTITIES = ["order", "booking"] as const;
export type ReviewEntity = (typeof REVIEW_ENTITIES)[number];

/** "hidden": the business took it off its site (abusive, wrong shop…). It still counts for
 *  nothing publicly — neither shown nor in the average — and can be put back. */
export const REVIEW_STATUSES = ["published", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewReply {
  body: string;
  repliedAt: string;
}

/** A customer's rating/comment on their own completed order or booking — see
 *  apps/api/src/reviews/schemas/review.schema.ts for the full rationale. */
export interface Review {
  id: string;
  organizationId: string;
  contactId: string;
  entity: ReviewEntity;
  entityId: string;
  offerId?: string;
  /** Resolved for the staff list; absent when the order mixed several offers. */
  offerName?: string;
  rating: number;
  comment?: string;
  /** Older reviews have no status: they are published. */
  status?: ReviewStatus;
  /** "Awa K." — only when the customer chose to sign with their first name. */
  authorName?: string;
  reply?: ReviewReply;
  createdAt: string;
  updatedAt: string;
}

/** A single review as shown on a public site. Anonymous ("Client vérifié") unless the customer
 *  chose to sign it with their first name and initial when writing it. */
export interface PublicReview {
  rating: number;
  comment?: string;
  createdAt: string;
  authorName?: string;
  reply?: ReviewReply;
  /** Site-wide lists only: what the review was about. */
  offerName?: string;
}

/** @deprecated kept for the offer page's existing imports — same shape as PublicReview. */
export type PublicOfferReview = PublicReview;

export interface PublicOfferReviewSummary {
  average: number | null;
  count: number;
  reviews: PublicReview[];
}

/** The business-wide rating carried by GET /public/:slug — the home page's "Avis clients". */
export interface PublicReviewSummary {
  average: number | null;
  count: number;
  latest: PublicReview[];
}

/** What a review invitation link opens on — GET /public/:slug/review-invitation. */
export interface PublicReviewInvitation {
  organizationName: string;
  entity: ReviewEntity;
  /** Offer names of the order's lines, or the booked offer. */
  items: string[];
  customerFirstName?: string;
  alreadyReviewed: boolean;
}

/** Dashboard header: everything, hidden reviews included, so the owner sees the whole picture. */
export interface ReviewStats {
  average: number | null;
  count: number;
  hidden: number;
  /** Index 0 = one star … index 4 = five stars. */
  distribution: [number, number, number, number, number];
  /** Whether a review request goes out after each delivered order / completed booking. */
  requestsEnabled: boolean;
}

/* ─── Reviews of KORVA OS itself, written by the businesses that use it ─── */

export const PLATFORM_REVIEW_STATUSES = ["pending", "published", "rejected"] as const;
export type PlatformReviewStatus = (typeof PLATFORM_REVIEW_STATUSES)[number];

export interface PlatformReview {
  id: string;
  organizationId: string;
  userId: string;
  rating: number;
  comment: string;
  /** The author agreed to show it on korvasuite.com with their first name and business name. */
  publicConsent: boolean;
  displayName: string;
  businessName: string;
  status: PlatformReviewStatus;
  /** Shown to the author when the administration declined to publish it. */
  rejectionReason?: string;
  moderatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Admin list row: the review plus who wrote it. */
export interface PlatformReviewAdminRow extends PlatformReview {
  authorEmail?: string;
  organizationSlug?: string;
}

export interface PublicPlatformReview {
  rating: number;
  comment: string;
  displayName: string;
  businessName: string;
  businessModel?: string;
  createdAt: string;
}

export interface PublicPlatformReviewSummary {
  /** Over every review received, published or not — the honest figure. */
  average: number | null;
  count: number;
  reviews: PublicPlatformReview[];
}

export interface PlatformReviewStats {
  average: number | null;
  count: number;
  pending: number;
  published: number;
  rejected: number;
  distribution: [number, number, number, number, number];
}
