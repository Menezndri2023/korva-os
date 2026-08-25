import { createHmac } from 'node:crypto';
import { verifySvixSignature } from './verify-svix-signature';

/**
 * Signs independently of the implementation under test, using nothing but the documented Svix
 * algorithm (see verify-svix-signature.ts's header comment) — if this test file's `sign` helper
 * and the implementation's `computeExpectedSignature` disagreed, that would BE the bug this test
 * exists to catch, so they're deliberately not shared code.
 */
function sign(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  payload: string,
): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const digest = createHmac('sha256', secretBytes)
    .update(signedContent, 'utf8')
    .digest('base64');
  return `v1,${digest}`;
}

describe('verifySvixSignature', () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const payload = JSON.stringify({
    type: 'email.delivered',
    data: { email_id: 'abc-123' },
  });
  const svixId = 'msg_2abcXYZ';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const svixTimestamp = String(nowSeconds);
  const now = () => nowSeconds * 1000;

  it('TEST 1 — accepts a correctly-signed payload', () => {
    const svixSignature = sign(secret, svixId, svixTimestamp, payload);
    const ok = verifySvixSignature(
      payload,
      { svixId, svixTimestamp, svixSignature },
      secret,
      { now },
    );
    expect(ok).toBe(true);
  });

  it('TEST 2 — rejects a tampered payload signed for a different body', () => {
    const svixSignature = sign(secret, svixId, svixTimestamp, payload);
    const tamperedPayload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'attacker-controlled' },
    });
    const ok = verifySvixSignature(
      tamperedPayload,
      { svixId, svixTimestamp, svixSignature },
      secret,
      { now },
    );
    expect(ok).toBe(false);
  });

  it('TEST 3 — rejects a signature computed with the wrong secret', () => {
    const svixSignature = sign(
      'whsec_wrongSecretWrongSecretWrongSecretA',
      svixId,
      svixTimestamp,
      payload,
    );
    const ok = verifySvixSignature(
      payload,
      { svixId, svixTimestamp, svixSignature },
      secret,
      { now },
    );
    expect(ok).toBe(false);
  });

  it('TEST 4 — rejects a well-formed but garbage signature', () => {
    const ok = verifySvixSignature(
      payload,
      { svixId, svixTimestamp, svixSignature: 'v1,not-a-real-signature==' },
      secret,
      { now },
    );
    expect(ok).toBe(false);
  });

  it('TEST 5 — rejects a timestamp far outside the tolerance window (replay protection)', () => {
    const staleTimestamp = String(nowSeconds - 3600); // 1 hour old
    const svixSignature = sign(secret, svixId, staleTimestamp, payload);
    const ok = verifySvixSignature(
      payload,
      { svixId, svixTimestamp: staleTimestamp, svixSignature },
      secret,
      { now },
    );
    expect(ok).toBe(false);
  });

  it('TEST 6 — accepts when ANY signature in a multi-key svix-signature header matches (key rotation)', () => {
    const realSignature = sign(secret, svixId, svixTimestamp, payload);
    const otherKeySignature =
      'v1,' + Buffer.from('unrelated').toString('base64');
    const ok = verifySvixSignature(
      payload,
      {
        svixId,
        svixTimestamp,
        svixSignature: `${otherKeySignature} ${realSignature}`,
      },
      secret,
      { now },
    );
    expect(ok).toBe(true);
  });

  it('TEST 7 — rejects when required headers are missing', () => {
    expect(
      verifySvixSignature(
        payload,
        { svixId: '', svixTimestamp, svixSignature: 'v1,x' },
        secret,
        { now },
      ),
    ).toBe(false);
    expect(
      verifySvixSignature(
        payload,
        { svixId, svixTimestamp: '', svixSignature: 'v1,x' },
        secret,
        { now },
      ),
    ).toBe(false);
    expect(
      verifySvixSignature(
        payload,
        { svixId, svixTimestamp, svixSignature: '' },
        secret,
        { now },
      ),
    ).toBe(false);
  });

  it('TEST 8 — works identically against a Buffer payload as against the equivalent string', () => {
    const svixSignature = sign(secret, svixId, svixTimestamp, payload);
    const ok = verifySvixSignature(
      Buffer.from(payload, 'utf8'),
      { svixId, svixTimestamp, svixSignature },
      secret,
      { now },
    );
    expect(ok).toBe(true);
  });
});
