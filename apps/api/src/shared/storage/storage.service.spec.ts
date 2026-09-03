import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

function makeConfigService(
  values: Record<string, string | undefined>,
): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('StorageService', () => {
  describe('publicUrl', () => {
    it('always points at the API uploads route, regardless of STORAGE_PROVIDER', () => {
      for (const provider of ['local', 's3', undefined]) {
        const service = new StorageService(
          makeConfigService({
            STORAGE_PROVIDER: provider,
            API_URL: 'https://api.example.com',
          }),
        );
        expect(service.publicUrl('507f1f77bcf86cd799439011', 'x.png')).toBe(
          'https://api.example.com/api/v1/uploads/507f1f77bcf86cd799439011/x.png',
        );
      }
    });

    it('falls back to localhost:4000 when API_URL is unset', () => {
      const service = new StorageService(makeConfigService({}));
      expect(service.publicUrl('507f1f77bcf86cd799439011', 'x.png')).toBe(
        'http://localhost:4000/api/v1/uploads/507f1f77bcf86cd799439011/x.png',
      );
    });
  });

  describe('provider selection', () => {
    it('does not throw when constructed with STORAGE_PROVIDER=s3 and no bucket configured (S3Client defers credential/config validation to call time, not construction time)', () => {
      expect(
        () => new StorageService(makeConfigService({ STORAGE_PROVIDER: 's3' })),
      ).not.toThrow();
    });

    it('an unrecognized STORAGE_PROVIDER value falls back to the local backend rather than throwing', () => {
      expect(
        () =>
          new StorageService(
            makeConfigService({ STORAGE_PROVIDER: 'something-else' }),
          ),
      ).not.toThrow();
    });
  });
});
