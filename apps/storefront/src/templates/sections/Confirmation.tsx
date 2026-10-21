import { CircleCheck } from "lucide-react";

/** "Votre réservation a bien été enregistrée" — the one moment a visitor must not miss. */
export function Confirmation({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm font-medium text-success"
    >
      <CircleCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
