import { getRequestId, runWithRequestContext } from './request-context';

describe('request-context (AsyncLocalStorage)', () => {
  it('TEST 1 — returns undefined outside any request context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('TEST 2 — exposes the bound requestId inside runWithRequestContext', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      expect(getRequestId()).toBe('req-1');
    });
  });

  it('TEST 3 — survives an async/await chain several hops deep', async () => {
    async function threeHopsDeep() {
      async function secondHop() {
        async function thirdHop() {
          await Promise.resolve();
          return getRequestId();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        return thirdHop();
      }
      return secondHop();
    }

    const result = await runWithRequestContext({ requestId: 'req-deep' }, () =>
      threeHopsDeep(),
    );
    expect(result).toBe('req-deep');
  });

  it('TEST 4 — two concurrent contexts never leak into each other', async () => {
    const results = await Promise.all([
      runWithRequestContext({ requestId: 'req-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getRequestId();
      }),
      runWithRequestContext({ requestId: 'req-b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getRequestId();
      }),
    ]);
    expect(results).toEqual(['req-a', 'req-b']);
  });

  it('TEST 5 — context does not leak after runWithRequestContext returns', () => {
    runWithRequestContext({ requestId: 'req-scoped' }, () => {
      /* no-op */
    });
    expect(getRequestId()).toBeUndefined();
  });
});
