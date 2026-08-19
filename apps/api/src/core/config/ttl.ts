/** e.g. "15m", "30d" — matches the pattern parsed by AuthService.parseTtlToMs. */
export type TtlString = `${number}${'s' | 'm' | 'h' | 'd'}`;
