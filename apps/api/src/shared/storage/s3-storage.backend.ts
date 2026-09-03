import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { SAFE_FILENAME, SAFE_ORGANIZATION_ID } from './storage.constants';
import type { ReadableStoredFile, StorageBackend } from './storage.service';

/**
 * S3-compatible counterpart to LocalStorageBackend (storage.service.ts) — same object-key
 * convention (`<organizationId>/<filename>`), same input validation, different destination.
 * Content-Type/Content-Length come back from S3's own object metadata (set at upload time by
 * S3StorageEngine's PutObjectCommand) rather than being re-derived from the file extension.
 */
export class S3StorageBackend implements StorageBackend {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async readStream(
    organizationId: string,
    filename: string,
  ): Promise<ReadableStoredFile | null> {
    if (
      !SAFE_ORGANIZATION_ID.test(organizationId) ||
      !SAFE_FILENAME.test(filename)
    ) {
      return null;
    }
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: `${organizationId}/${filename}`,
        }),
      );
      if (!result.Body) return null;
      return {
        stream: result.Body as unknown as Readable,
        size: result.ContentLength ?? 0,
        mimeType: result.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async remove(organizationId: string, filename: string): Promise<boolean> {
    if (
      !SAFE_ORGANIZATION_ID.test(organizationId) ||
      !SAFE_FILENAME.test(filename)
    ) {
      return false;
    }
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: `${organizationId}/${filename}`,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
