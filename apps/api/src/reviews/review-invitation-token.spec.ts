import {
  INVITATION_TTL_MS,
  signReviewInvitation,
  verifyReviewInvitation,
} from './review-invitation-token';

const SECRET = 'test-jwt-secret';
const CLAIMS = {
  organizationId: '64b000000000000000000001',
  entity: 'order' as const,
  entityId: '64b000000000000000000002',
  contactId: '64b000000000000000000003',
};

describe('review invitation token', () => {
  it('round-trips the claims while valid', () => {
    const token = signReviewInvitation(SECRET, CLAIMS, 1_000);
    expect(verifyReviewInvitation(SECRET, token, 2_000)).toEqual({
      ...CLAIMS,
      expiresAt: 1_000 + INVITATION_TTL_MS,
    });
  });

  it('expires', () => {
    const token = signReviewInvitation(SECRET, CLAIMS, 1_000);
    expect(
      verifyReviewInvitation(SECRET, token, 1_000 + INVITATION_TTL_MS),
    ).toBeNull();
  });

  it('refuses another secret, an edited body, and garbage', () => {
    const token = signReviewInvitation(SECRET, CLAIMS);
    expect(verifyReviewInvitation('other-secret', token)).toBeNull();

    const [body, signature] = token.split('.');
    const edited = Buffer.from(
      Buffer.from(body!, 'base64url')
        .toString('utf8')
        .replace(CLAIMS.entityId, '64b0000000000000000000ff'),
    ).toString('base64url');
    expect(verifyReviewInvitation(SECRET, `${edited}.${signature}`)).toBeNull();

    for (const junk of ['', 'a.b', `${token}.x`, 'not-a-token']) {
      expect(verifyReviewInvitation(SECRET, junk)).toBeNull();
    }
  });
});
