import { zonedTimeToUtc } from '../../booking/availability/availability.service';

const LOCAL = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * A date-time as a model writes it, to the UTC instant the services expect. The model is asked
 * for the business's LOCAL time ("2026-10-26T14:00"), which it gets right far more reliably than
 * an offset; an explicit Z or offset is honoured too. Before this, the booking tool demanded the
 * strict UTC "Z" form, the model sent "+00:00", and every booking failed validation.
 */
export function localDateTimeToUtcIso(value: string, timeZone: string): string {
  const trimmed = value.trim();
  const local = LOCAL.exec(trimmed);
  if (local)
    return zonedTimeToUtc(local[1]!, local[2]!, timeZone).toISOString();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Date « ${value} » illisible : écris l'heure locale au format AAAA-MM-JJTHH:mm, par exemple 2026-10-26T14:00.`,
    );
  }
  return parsed.toISOString();
}

/** The same instant as the business reads it, for the model's confirmation. */
export function utcToLocalLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(instant);
}
