import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combines class names like clsx, then resolves conflicting Tailwind utilities (e.g.
 *  cn("px-2", "px-4") => "px-4") so components can accept a caller-supplied `className`
 *  without producing two conflicting utilities in the same class list. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
