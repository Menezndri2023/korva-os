import { EventEmitter } from 'node:events';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Request } from 'express';
import { S3StorageEngine } from './s3-storage.engine';
import type {
  MulterFileLike,
  StoredMulterFileInfo,
} from './local-disk-storage.engine';

const ORG_ID = '507f1f77bcf86cd799439011';
const BUCKET = 'korva-uploads-test';
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function makeRequest(organizationId?: string): Request {
  return {
    tenant: organizationId ? { organizationId } : undefined,
  } as unknown as Request;
}

function makeFile(mimetype: string, body: Buffer): MulterFileLike {
  const stream = new EventEmitter();
  const file = {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype,
    stream,
  };
  // Simulate multer/busboy emitting the body as a single chunk then ending — every S3StorageEngine
  // test below only needs one write, matching MAX_UPLOAD_BYTES's small (5MB) ceiling.
  queueMicrotask(() => {
    stream.emit('data', body);
    stream.emit('end');
  });
  return file as unknown as MulterFileLike;
}

describe('S3StorageEngine', () => {
  function makeClient(send: jest.Mock<Promise<unknown>, [unknown]>) {
    return { send } as unknown as S3Client;
  }

  describe('_handleFile', () => {
    it('errors when the request has no tenant context', (done) => {
      const send = jest.fn<Promise<unknown>, [unknown]>();
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      const file = makeFile('image/png', PNG_SIGNATURE);

      engine._handleFile(makeRequest(undefined), file, (error) => {
        expect(error?.message).toBe('Missing tenant context for upload');
        expect(send).not.toHaveBeenCalled();
        done();
      });
    });

    it('rejects a mimetype outside the allowlist before touching S3', (done) => {
      const send = jest.fn<Promise<unknown>, [unknown]>();
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      const file = makeFile('application/pdf', Buffer.from('%PDF-1.4'));

      engine._handleFile(makeRequest(ORG_ID), file, (error) => {
        expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
        expect(send).not.toHaveBeenCalled();
        done();
      });
    });

    it('rejects content whose real bytes do not match the declared mimetype', (done) => {
      const send = jest.fn<Promise<unknown>, [unknown]>();
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      // Declares PNG but the body is plain text — magic-byte check must catch this.
      const file = makeFile('image/png', Buffer.from('not a real png'));

      engine._handleFile(makeRequest(ORG_ID), file, (error) => {
        expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
        expect(send).not.toHaveBeenCalled();
        done();
      });
    });

    it('uploads a valid PNG via PutObjectCommand under `<organizationId>/<uuid>.png`', (done) => {
      const send = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({});
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      const file = makeFile('image/png', PNG_SIGNATURE);

      engine._handleFile(makeRequest(ORG_ID), file, (error, info) => {
        expect(error).toBeNull();
        expect(info?.destination).toBe(ORG_ID);
        expect(info?.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
        expect(info?.path).toBe(`${ORG_ID}/${info?.filename}`);
        expect(info?.size).toBe(PNG_SIGNATURE.length);

        const command = send.mock.calls[0]![0] as PutObjectCommand;
        expect(command).toBeInstanceOf(PutObjectCommand);
        expect(command.input.Bucket).toBe(BUCKET);
        expect(command.input.Key).toBe(info?.path);
        expect(command.input.ContentType).toBe('image/png');
        done();
      });
    });

    it('surfaces an S3 error through the callback', (done) => {
      const send = jest
        .fn<Promise<unknown>, [unknown]>()
        .mockRejectedValue(new Error('AccessDenied'));
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      const file = makeFile('image/png', PNG_SIGNATURE);

      engine._handleFile(makeRequest(ORG_ID), file, (error) => {
        expect(error?.message).toBe('AccessDenied');
        done();
      });
    });
  });

  describe('_removeFile', () => {
    const info: StoredMulterFileInfo = {
      destination: ORG_ID,
      filename: '11111111-1111-1111-1111-111111111111.png',
      path: `${ORG_ID}/11111111-1111-1111-1111-111111111111.png`,
      size: 8,
    };

    it('calls back with no error on success', (done) => {
      const send = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({});
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      engine._removeFile({} as Request, info, (error) => {
        expect(error).toBeNull();
        done();
      });
    });

    it('is best-effort — a failed delete still calls back with no error', (done) => {
      const send = jest
        .fn<Promise<unknown>, [unknown]>()
        .mockRejectedValue(new Error('NoSuchKey'));
      const engine = new S3StorageEngine(makeClient(send), BUCKET);
      engine._removeFile({} as Request, info, (error) => {
        expect(error).toBeNull();
        done();
      });
    });
  });
});
