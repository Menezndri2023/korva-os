import { parseIcsEvents } from './ics';

describe('parseIcsEvents', () => {
  it('parses a basic VEVENT with UTC date-times', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:1@example.com',
      'DTSTART:20260829T140000Z',
      'DTEND:20260829T150000Z',
      'SUMMARY:Dentist',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcsEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0]?.startAt.toISOString()).toBe('2026-08-29T14:00:00.000Z');
    expect(events[0]?.endAt.toISOString()).toBe('2026-08-29T15:00:00.000Z');
  });

  it('parses multiple VEVENTs', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260829T090000Z',
      'DTEND:20260829T100000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260830T090000Z',
      'DTEND:20260830T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcsEvents(raw)).toHaveLength(2);
  });

  it('parses all-day (VALUE=DATE) events', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260829',
      'DTEND;VALUE=DATE:20260830',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcsEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0]?.startAt.toISOString()).toBe('2026-08-29T00:00:00.000Z');
    expect(events[0]?.endAt.toISOString()).toBe('2026-08-30T00:00:00.000Z');
  });

  it('handles RFC 5545 line folding', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:A long summary that wraps across\r\n a folded continuation line',
      'DTSTART:20260829T090000Z',
      'DTEND:20260829T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcsEvents(raw)).toHaveLength(1);
  });

  it('drops events missing DTSTART or DTEND', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260829T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcsEvents(raw)).toHaveLength(0);
  });

  it('drops events where DTEND is not after DTSTART', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260829T100000Z',
      'DTEND:20260829T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcsEvents(raw)).toHaveLength(0);
  });

  it('returns an empty array for malformed input', () => {
    expect(parseIcsEvents('not an ics file')).toHaveLength(0);
  });
});
