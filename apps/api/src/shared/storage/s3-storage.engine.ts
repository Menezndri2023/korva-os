import { UnsupportedMediaTypeException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { RequestWithContext } from '../../core/tenant/request-context.types';
import { ALLOWED_UPLOAD_MIME_TYPES } from './storage.constants';
import type {
  MulterFileLike,
  StoredMulterFileInfo,
} from './local-disk-storage.engine';
import {
  FILE_SIGNATURE_CHECKS,
  SIGNATURE_CHECK_BYTES,
} from './file-signature-checks';

/**
 * S3-compatible counterpart to LocalDiskStorageEngine — same multer StorageEngine contract
 * (`_handleFile`/`_removeFile`, see that file's doc comment for why this is hand-written rather
 * than imported from 'multer'), same validation (declared-mimetype allowlist + magic-byte check
 * against the real bytes), same object-key convention (`<organizationId>/<uuid>.<ext>`) — only
 * the write destination differs. Selected via STORAGE_PROVIDER=s3 (uploads.controller.ts);
 * S3Client's own SDK config resolves `STORAGE_ENDPOINT` (set for MinIO/R2/Backblaze — leave unset
 * for real AWS S3), `STORAGE_REGION`, and `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`.
 *
 * Buffers the whole file in memory before issuing PutObjectCommand: the AWS SDK v3 S3 client
 * needs to know the body's length/be able to compute its checksum up front for a single
 * PutObject call, and MAX_UPLOAD_BYTES (5MB, storage.constants.ts) already bounds this to a
 * small, fixed amount — a multipart-upload streaming path would be needed if that limit ever grew
 * into the tens/hundreds of MB, but isn't warranted for today's 5MB cap.
 */
export class S3StorageEngine {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  _handleFile(
    req: Request,
    file: MulterFileLike,
    callback: (error: Error | null, info?: StoredMulterFileInfo) => void,
  ): void {
    const organizationId = (req as RequestWithContext).tenant?.organizationId;
    if (!organizationId) {
      callback(new Error('Missing tenant context for upload'));
      return;
    }

    const extension = ALLOWED_UPLOAD_MIME_TYPES[file.mimetype];
    const signatureCheck = FILE_SIGNATURE_CHECKS[file.mimetype];
    if (!extension || !signatureCheck) {
      callback(
        new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_FILE_TYPE',
          message: `File type "${file.mimetype}" is not allowed`,
        }),
      );
      return;
    }

    const filename = `${randomUUID()}.${extension}`;
    const key = `${organizationId}/${filename}`;

    const chunks: Buffer[] = [];
    file.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    file.stream.on('error', (error) => callback(error as Error));
    file.stream.on('end', () => {
      const body = Buffer.concat(chunks);
      const head = body.subarray(0, SIGNATURE_CHECK_BYTES);
      if (!signatureCheck(head)) {
        callback(
          new UnsupportedMediaTypeException({
            code: 'UNSUPPORTED_FILE_TYPE',
            message: `File content does not match declared type "${file.mimetype}"`,
          }),
        );
        return;
      }

      this.client
        .send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: file.mimetype,
          }),
        )
        .then(() => {
          callback(null, {
            destination: organizationId,
            filename,
            path: key,
            size: body.length,
          });
        })
        .catch((error: Error) => callback(error));
    });
  }

  _removeFile(
    _req: Request,
    file: StoredMulterFileInfo,
    callback: (error: Error | null) => void,
  ): void {
    // Best-effort, matching LocalDiskStorageEngine._removeFile — a stuck upload cleaning up
    // after itself is not itself worth surfacing as a hard failure.
    this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: file.path }))
      .then(() => callback(null))
      .catch(() => callback(null));
  }
}
