import {
  DISABLE_BACKGROUND_WORKERS_ENV,
  backgroundWorkersDisabled,
} from './background-workers';

function config(value: string | undefined) {
  return {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === DISABLE_BACKGROUND_WORKERS_ENV ? value : undefined,
      ),
  };
}

describe('backgroundWorkersDisabled', () => {
  it('disables only on the exact string "true"', () => {
    expect(backgroundWorkersDisabled(config('true'))).toBe(true);
  });

  it('leaves background work running for every other value, including unset', () => {
    // Fail OPEN, deliberately: the running application must never be one typo in an
    // environment variable away from silently processing nothing at all. A deployment that
    // means to stop background work has to say so exactly.
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      expect(backgroundWorkersDisabled(config(value))).toBe(false);
    }
  });

  it('reads the variable name the CLI scripts set', () => {
    // The scripts set process.env[DISABLE_BACKGROUND_WORKERS_ENV] before building their
    // application context; a rename on one side only would silently stop protecting them.
    expect(DISABLE_BACKGROUND_WORKERS_ENV).toBe('DISABLE_BACKGROUND_WORKERS');
  });
});
