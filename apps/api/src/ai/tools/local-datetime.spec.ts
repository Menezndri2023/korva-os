import { localDateTimeToUtcIso } from './local-datetime';

describe('localDateTimeToUtcIso', () => {
  it("reads a local time in the business's timezone", () => {
    expect(localDateTimeToUtcIso('2026-10-26T14:00', 'Africa/Abidjan')).toBe(
      '2026-10-26T14:00:00.000Z',
    );
    expect(localDateTimeToUtcIso('2026-10-26T14:00', 'Europe/Paris')).toBe(
      '2026-10-26T13:00:00.000Z',
    );
    expect(
      localDateTimeToUtcIso('2026-10-26 14:00:00', 'Africa/Casablanca'),
    ).toMatch(/^2026-10-26T1[34]:00:00.000Z$/);
  });

  it('honours an explicit offset or Z — the form that used to be refused', () => {
    expect(
      localDateTimeToUtcIso('2026-10-26T14:00:00+00:00', 'Europe/Paris'),
    ).toBe('2026-10-26T14:00:00.000Z');
    expect(localDateTimeToUtcIso('2026-10-26T14:00:00Z', 'Europe/Paris')).toBe(
      '2026-10-26T14:00:00.000Z',
    );
  });

  it('explains an unreadable date in words the model can act on', () => {
    expect(() => localDateTimeToUtcIso('lundi 14h', 'Africa/Abidjan')).toThrow(
      /AAAA-MM-JJTHH:mm/,
    );
  });
});
