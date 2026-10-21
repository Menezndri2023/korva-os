"use client";

import dynamic from "next/dynamic";

/**
 * The booking and checkout dialogs, loaded only when a visitor opens one.
 *
 * They carry the forms' validation (zod, react-hook-form) and the whole order flow — about 43 KB
 * of compressed JavaScript that every visitor downloaded before seeing the first offer, although
 * most only browse. On the metered mobile data the tenant sites are mostly visited on, that is
 * the first screen arriving later for nothing. `ssr: false`: they are dialogs, never part of the
 * server-rendered page.
 */
export const BookingPanel = dynamic(
  () => import("./commerce-panels").then((mod) => mod.BookingPanel),
  { ssr: false },
);

export const CheckoutPanel = dynamic(
  () => import("./commerce-panels").then((mod) => mod.CheckoutPanel),
  { ssr: false },
);
