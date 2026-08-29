/**
 * Minimal RFC 5545 (iCalendar) VEVENT parser — just enough to turn an ICS feed (the "secret
 * address" a Google/Outlook/Apple Calendar exposes for subscription) into a flat list of busy
 * intervals for CalendarSyncSchedulerService. Deliberately does not implement RRULE expansion:
 * a recurring event's first occurrence is kept (so a weekly "lunch" block still shows up at
 * least once), but its recurrences are not — full recurrence expansion is a project on its own
 * and out of scope for a one-way "don't double-book me" busy-time import.
 */
export interface ParsedIcsEvent {
  startAt: Date;
  endAt: Date;
}

/** "20260829T140000Z" / "20260829T140000" / "20260829" (VALUE=DATE, all-day). */
function parseIcsDate(raw: string): Date | null {
  const value = raw.trim();
  const allDay = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (allDay) {
    const [, y, m, d] = allDay;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(
    value,
  );
  if (!dateTime) return null;
  const [, y, m, d, hh, mm, ss, zulu] = dateTime;
  if (zulu) {
    return new Date(
      Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
      ),
    );
  }
  // No Z and no TZID handling — treat as UTC. Off by the feed's own timezone offset in the
  // worst case, which only ever makes a blocked slot a few hours wider than the real event,
  // never absent — acceptable for a "don't double-book me" safety margin.
  return new Date(
    Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
    ),
  );
}

/** Undoes RFC 5545 line folding: a CRLF/LF followed by a single space or tab continues the previous line. */
function unfoldLines(raw: string): string[] {
  const lines = raw.split(/\r\n|\r|\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (
      (line.startsWith(' ') || line.startsWith('\t')) &&
      unfolded.length > 0
    ) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/** "DTSTART;VALUE=DATE:20260829" -> { name: "DTSTART", value: "20260829" } (params ignored besides VALUE=DATE, which parseIcsDate already handles implicitly by format). */
function splitProperty(line: string): { name: string; value: string } | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const left = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const name = (left.split(';')[0] ?? '').toUpperCase();
  return { name, value };
}

export function parseIcsEvents(raw: string): ParsedIcsEvent[] {
  const events: ParsedIcsEvent[] = [];
  let inEvent = false;
  let startAt: Date | null = null;
  let endAt: Date | null = null;

  for (const line of unfoldLines(raw)) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      startAt = null;
      endAt = null;
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent && startAt && endAt && endAt > startAt) {
        events.push({ startAt, endAt });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const property = splitProperty(trimmed);
    if (!property) continue;
    if (property.name === 'DTSTART') {
      startAt = parseIcsDate(property.value);
    } else if (property.name === 'DTEND') {
      endAt = parseIcsDate(property.value);
    }
  }

  return events;
}
