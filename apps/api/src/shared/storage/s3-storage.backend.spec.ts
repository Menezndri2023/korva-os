import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3StorageBackend } from './s3-storage.backend';

/**
 * No real S3/MinIO call is ever made — `S3Client.send` is stubbed directly, same "mock the one
 * network-facing method" approach as the payment providers' `fetch` spies (see
 * flutterwave-payment.provider.spec.ts), rather than pulling in an aws-sdk-client-mock dependency
 * for a single class.
 */
describe('S3StorageBackend', () => {
  const ORG_ID = '507f1f77bcf86cd799439011';
  const FILENAME = '11111111-1111-1111-1111-111111111111.png';
  const BUCKET = 'korva-uploads-test';

  function makeClient(send: jest.Mock<Promise<unknown>, [unknown]>) {
    return { send } as unknown as S3Client;
  }

  describe('readStream', () => {
    it('returns null for a malformed organizationId without calling S3', async () => {
      const send = jest.fn<Promise<unknown>, [unknown]>();
      const backend = new S3StorageBackend(makeClient(send), BUCKET);
      expect(await backend.readStream('not-an-object-id', FILENAME)).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('returns null for a malformed filename without calling S3', async () => {
      const send = jest.fn<Promise<unknown>, [unknown]>();
      const backend = new S3StorageBackend(makeClient(send), BUCKET);
      expect(await backend.readStream(ORG_ID, '../../etc/passwd')).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('issues GetObjectCommand against `<organizationId>/<filename>` and returns the stream/size/mimeType', async () => {
      const fakeStream = {} as NodeJS.ReadableStream;
      const send = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        Body: fakeStream,
        ContentLength: 1234,
        ContentType: 'image/png',
      });
      const backend = new S3StorageBackend(makeClient(send), BUCKET);

      const result = await backend.readStream(ORG_ID, FILENAME);

      expect(result).toEqual({
        stream: fakeStream,
        size: 1234,
        mimeType: 'image/png',
      });
      const command = send.mock.calls[0]![0] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({
        Bucket: BUCKET,
        Key: `${ORG_ID}/${FILENAME}`,
      });
    });

    it('returns null when S3 has no Body (e.g. a zero-byte marker object)', async () => {
      const send = jest
        .fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ Body: undefined });
      const backend = new S3StorageBackend(makeClient(send), BUCKET);
      expect(await backend.readStream(ORG_ID, FILENAME)).toBeNull();
    });

    it('returns null when S3 rejects (e.g. NoSuchKey)', async () => {
      const send = jest
        .fn<Promise<unknown>, [unknown]>()
        .mockRejectedValue(new Error('NoSuchKey'));
      const backend = new S3StorageBackend(makeClient(send), BUCKET);
      expect(await backend.readStream(ORG_ID, FILENAME)).toBeNull();
    });
  });

  describe('remove', () => {
    it('returns false for a malformed organizationId without calling S3', async () => {
      const send = jest.fn<Promise<unknown>, [unknown]>();
      const backend = new S3StorageBackend(makeClient(send), BUCKET);
      expect(await backend.remove('not-an-object-id', FILENAME)).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('issues DeleteObjectCommand against `<organizationId>/<filename>` and returns true', async () => {
      const send = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({});
      const backend = new S3StorageBackend(makeClient(send), BUCKET);

      expect(await backend.remove(ORG_ID, FILENAME)).toBe(true);
      const command = send.mock.calls[0]![0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: BUCKET,
        Key: `${ORG_ID}/${FILENAME}`,
      });
    });

    it('returns false when S3 rejects', async () => {
      const send = jest
        .fn<Promise<unknown>, [unknown]>()
        .mockRejectedValue(new Error('AccessDenied'));
      const backend = new S3StorageBackend(makeClient(send), BUCKET);
      expect(await backend.remove(ORG_ID, FILENAME)).toBe(false);
    });
  });
});
