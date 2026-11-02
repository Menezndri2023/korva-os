"use client";

import { useRef } from "react";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

const LABELS = {
  fr: ["Décevant", "Moyen", "Bien", "Très bien", "Excellent"],
  en: ["Disappointing", "Average", "Good", "Very good", "Excellent"],
} as const;

/**
 * Five stars as a radio group: arrows move the choice, as with any radio group, and the chosen
 * level is named in words so the rating means the same thing to everyone.
 */
export function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const locale = useStorefrontLocale();
  const t = useT();
  const labels = LABELS[locale];

  function move(next: number) {
    const clamped = Math.min(5, Math.max(1, next));
    onChange(clamped);
    refs.current[clamped - 1]?.focus();
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label={t("Votre note", "Your rating")}
        className="flex gap-1"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            move(value + 1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            move(value - 1);
          }
        }}
      >
        {labels.map((label, index) => {
          const star = index + 1;
          return (
            <button
              key={star}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={t(`${star} sur 5 — ${label}`, `${star} out of 5 — ${label}`)}
              tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
              onClick={() => onChange(star)}
              className={`rounded-md px-0.5 text-4xl leading-none transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-90 ${
                star <= value ? "text-amber-500" : "text-border"
              }`}
            >
              ★
            </button>
          );
        })}
      </div>
      <p className="mt-1 h-5 text-sm font-medium text-text" aria-live="polite">
        {value > 0 ? labels[value - 1] : ""}
      </p>
    </div>
  );
}
