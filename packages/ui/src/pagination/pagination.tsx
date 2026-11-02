"use client";

import { Button } from "../button/button.tsx";
import { useUiLocale } from "../ui-locale.tsx";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({ page, totalPages, onPageChange, disabled = false }: PaginationProps) {
  const en = useUiLocale() === "en";
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text-muted">
        {en ? `Page ${page} of ${Math.max(totalPages, 1)}` : `Page ${page} sur ${Math.max(totalPages, 1)}`}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {en ? "Previous" : "Précédent"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {en ? "Next" : "Suivant"}
        </Button>
      </div>
    </div>
  );
}
