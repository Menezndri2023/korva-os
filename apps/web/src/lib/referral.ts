/**
 * The parrainage code from a shared link (/register?ref=CODE), kept in this browser until the
 * business is created — the person may read the landing page, sign up, confirm their e-mail and
 * only then reach onboarding.
 */
const KEY = "korva-ref";

export function rememberReferral(code: string | null | undefined): void {
  const clean = code?.trim().toUpperCase();
  if (!clean || !/^[A-Z0-9]{4,20}$/.test(clean)) return;
  try {
    localStorage.setItem(KEY, clean);
  } catch {
    // Private browsing: the code is simply not carried over.
  }
}

export function readReferral(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function forgetReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
