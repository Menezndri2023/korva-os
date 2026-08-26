import type { ConfigService } from '@nestjs/config';
import { CredentialEncryptionService } from './credential-encryption.service';

function buildService(
  key = 'test-integration-credentials-key',
): CredentialEncryptionService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(key),
  } as unknown as ConfigService;
  return new CredentialEncryptionService(configService);
}

describe('CredentialEncryptionService', () => {
  it('round-trips a plaintext secret through encrypt/decrypt', () => {
    const service = buildService();
    const ciphertext = service.encrypt('flutterwave-secret-key-1234');
    expect(service.decrypt(ciphertext)).toBe('flutterwave-secret-key-1234');
  });

  it('encodes the payload as iv:authTag:ciphertext hex, same shape as two-factor.service.ts', () => {
    const service = buildService();
    const ciphertext = service.encrypt('some-secret');
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]*$/);
    }
    // 12-byte IV, 16-byte GCM auth tag.
    expect(parts[0]).toHaveLength(24);
    expect(parts[1]).toHaveLength(32);
  });

  it('produces different ciphertext for the same plaintext on repeated calls (random IV)', () => {
    const service = buildService();
    const a = service.encrypt('same-secret');
    const b = service.encrypt('same-secret');
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe('same-secret');
    expect(service.decrypt(b)).toBe('same-secret');
  });

  it('fails to decrypt a ciphertext whose body has been tampered with (authenticated encryption)', () => {
    const service = buildService();
    const ciphertext = service.encrypt('super-secret-value');
    const [iv, authTag, body] = ciphertext.split(':') as [
      string,
      string,
      string,
    ];
    const flippedByte = (parseInt(body.slice(0, 2), 16) ^ 0xff)
      .toString(16)
      .padStart(2, '0');
    const tampered = `${iv}:${authTag}:${flippedByte}${body.slice(2)}`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('fails to decrypt when the auth tag has been tampered with', () => {
    const service = buildService();
    const ciphertext = service.encrypt('another-secret-value');
    const [iv, authTag, body] = ciphertext.split(':') as [
      string,
      string,
      string,
    ];
    const flippedTag = (parseInt(authTag.slice(0, 2), 16) ^ 0xff)
      .toString(16)
      .padStart(2, '0');
    const tampered = `${iv}:${flippedTag}${authTag.slice(2)}:${body}`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('fails to decrypt a payload encrypted under a different key', () => {
    const encryptedUnderKeyOne =
      buildService('key-one').encrypt('cross-key-secret');
    expect(() =>
      buildService('key-two').decrypt(encryptedUnderKeyOne),
    ).toThrow();
  });

  it('throws on a malformed payload (missing segments)', () => {
    const service = buildService();
    expect(() => service.decrypt('not-a-valid-payload')).toThrow(
      'Malformed encrypted integration credential',
    );
  });

  it('reads the key from INTEGRATION_CREDENTIALS_KEY, not JWT_SECRET', () => {
    const getOrThrow = jest.fn().mockReturnValue('integration-key');
    const configService = { getOrThrow } as unknown as ConfigService;
    new CredentialEncryptionService(configService);
    expect(getOrThrow).toHaveBeenCalledWith('INTEGRATION_CREDENTIALS_KEY');
  });
});
