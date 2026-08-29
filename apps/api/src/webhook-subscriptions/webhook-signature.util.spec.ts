import { createHmac } from 'node:crypto';
import { signPayload } from './webhook-signature.util';

describe('signPayload', () => {
  it('produces the sha256= HMAC a receiver would independently recompute over the same body/secret', () => {
    const secret = 'whsec_test-secret';
    const body = JSON.stringify({
      event: 'lead.created',
      data: { leadId: '1' },
    });

    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(signPayload(secret, body)).toBe(expected);
  });

  it('changes if the body changes, for the same secret', () => {
    const secret = 'whsec_test-secret';
    const a = signPayload(secret, JSON.stringify({ a: 1 }));
    const b = signPayload(secret, JSON.stringify({ a: 2 }));
    expect(a).not.toBe(b);
  });

  it('changes if the secret changes, for the same body', () => {
    const body = JSON.stringify({ a: 1 });
    const a = signPayload('whsec_one', body);
    const b = signPayload('whsec_two', body);
    expect(a).not.toBe(b);
  });
});
