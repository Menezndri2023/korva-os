import { createHmac } from 'node:crypto';
import { GeniusPayWebhookVerifier } from './geniuspay-webhook-verifier';
import {
  extractEventId,
  extractReference,
} from './geniuspay-webhook.controller';

const SECRET = 'whsec_test';
const NOW = 1_800_000_000_000;
const body = Buffer.from(
  JSON.stringify({
    id: '550e8400-e29b-41d4-a716-446655440000',
    event: 'payment.success',
    data: { reference: 'MTX-A1B2C3D4E5', status: 'completed' },
  }),
);

function sign(timestamp: number, raw = body, secret = SECRET) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${raw.toString('utf8')}`)
    .digest('hex');
}

describe('GeniusPayWebhookVerifier', () => {
  const verifier = new GeniusPayWebhookVerifier(SECRET, () => NOW);
  const ts = NOW / 1000;

  it('accepts a delivery signed over "timestamp.body"', () => {
    expect(
      verifier.verify(body, {
        'x-webhook-signature': sign(ts),
        'x-webhook-timestamp': String(ts),
      }),
    ).toBe(true);
  });

  it('refuses another secret, an altered body, a stale delivery, and missing headers', () => {
    expect(
      verifier.verify(body, {
        'x-webhook-signature': sign(ts, body, 'other'),
        'x-webhook-timestamp': String(ts),
      }),
    ).toBe(false);
    expect(
      verifier.verify(
        Buffer.from(body.toString().replace('completed', 'refunded')),
        {
          'x-webhook-signature': sign(ts),
          'x-webhook-timestamp': String(ts),
        },
      ),
    ).toBe(false);
    const old = ts - 301;
    expect(
      verifier.verify(body, {
        'x-webhook-signature': sign(old),
        'x-webhook-timestamp': String(old),
      }),
    ).toBe(false);
    expect(verifier.verify(body, {})).toBe(false);
    expect(new GeniusPayWebhookVerifier('', () => NOW).verify(body, {})).toBe(
      false,
    );
  });
});

describe('GeniusPay webhook payload', () => {
  it('reads the transaction reference and the delivery id', () => {
    expect(extractReference(body)).toBe('MTX-A1B2C3D4E5');
    expect(
      extractEventId(JSON.parse(body.toString()) as Record<string, unknown>),
    ).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(
      extractEventId({ event: 'payment.failed', data: { reference: 'MTX-9' } }),
    ).toBe('payment.failed:MTX-9');
    expect(extractReference(Buffer.from('not json'))).toBeUndefined();
  });
});
