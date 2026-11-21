import { createHmac } from 'node:crypto';
import { SasPayWebhookVerifier } from './saspay-webhook-verifier';
import { extractEventId, parseEvent } from './saspay-webhook.controller';

const SECRET = 'signing-secret';
const NOW = 1_800_000_000_000;
const BODY = Buffer.from(
  '{"event":"transaction.success","data":{"id":"tx-1","type":"PAIEMENT","status":"SUCCESS"}}',
);

function sign(timestamp: string, body: Buffer = BODY) {
  return createHmac('sha256', SECRET)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
}

describe('SasPayWebhookVerifier', () => {
  const verifier = new SasPayWebhookVerifier(SECRET, () => NOW);
  const ts = String(NOW / 1000);

  it('accepts SasPay’s signature over timestamp.rawBody', () => {
    expect(
      verifier.verify(BODY, {
        'x-webhook-signature': sign(ts),
        'x-webhook-timestamp': ts,
      }),
    ).toBe(true);
  });

  it('refuses a tampered body, a wrong secret or a stale delivery', () => {
    expect(
      verifier.verify(Buffer.from(`${BODY.toString()} `), {
        'x-webhook-signature': sign(ts),
        'x-webhook-timestamp': ts,
      }),
    ).toBe(false);
    expect(
      new SasPayWebhookVerifier('other', () => NOW).verify(BODY, {
        'x-webhook-signature': sign(ts),
        'x-webhook-timestamp': ts,
      }),
    ).toBe(false);
    const old = String(NOW / 1000 - 301);
    expect(
      verifier.verify(BODY, {
        'x-webhook-signature': sign(old),
        'x-webhook-timestamp': old,
      }),
    ).toBe(false);
    expect(verifier.verify(BODY, {})).toBe(false);
  });
});

describe('SasPay webhook payload', () => {
  it('names the delivery by event, transaction and status', () => {
    expect(
      extractEventId({
        event: 'transaction.success',
        data: { id: 'tx-1', status: 'SUCCESS' },
      }),
    ).toBe('transaction.success:tx-1:SUCCESS');
    expect(() => extractEventId({ event: 'transaction.success' })).toThrow();
  });

  it('reads only transaction events', () => {
    expect(parseEvent(BODY)).toEqual({
      transactionId: 'tx-1',
      type: 'PAIEMENT',
    });
    expect(
      parseEvent(
        Buffer.from('{"event":"settlement.success","data":{"id":"s"}}'),
      ),
    ).toBeUndefined();
    expect(parseEvent(Buffer.from('not json'))).toBeUndefined();
  });
});
