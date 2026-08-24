import { Button } from "../button/button.tsx";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({ page, totalPages, onPageChange, disabled = false }: PaginationProps) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-text-muted">
        Page {page} sur {Math.max(totalPages, 1)}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Précédent
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Suivant
        </Button>
      </div>
    </div>
  );
}
