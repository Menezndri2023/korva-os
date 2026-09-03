import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  LOCAL_STORAGE_ROOT_DIR,
  S3_STORAGE_CONFIG,
  SAFE_FILENAME,
  SAFE_ORGANIZATION_ID,
} from './storage.constants';
import { S3StorageBackend } from './s3-storage.backend';

const MIME_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_UPLOAD_MIME_TYPES).map(([mime, ext]) => [ext, mime]),
);

export interface ReadableStoredFile {
  stream: NodeJS.ReadableStream;
  size: number;
  mimeType: string;
}

/** Provider-agnostic shape both LocalStorageBackend and S3StorageBackend implement — see
 *  StorageService below for why publicUrl() itself isn't part of this (it never varies by
 *  backend: reads are always proxied through our own GET route, on both providers). */
export interface StorageBackend {
  readStream(
    organizationId: string,
    filename: string,
  ): Promise<ReadableStoredFile | null>;
  remove(organizationId: string, filename: string): Promise<boolean>;
}

/**
 * Local-filesystem implementation of the storage abstraction — the default per
 * STORAGE_PROVIDER=local in .env.example. Kept provider-agnostic in its public shape
 * (organizationId + filename in, a stream or a public URL out — no filesystem-specific detail
 * leaks to callers) so S3StorageBackend below can implement the same shape and be swapped in
 * behind UploadsController without changing it.
 */
class LocalStorageBackend implements StorageBackend {
  async readStream(
    organizationId: string,
    filename: string,
  ): Promise<ReadableStoredFile | null> {
    const path = resolveSafePath(organizationId, filename);
    if (!path) return null;

    const extension = filename
      .slice(filename.lastIndexOf('.') + 1)
      .toLowerCase();
    const mimeType = MIME_TYPE_BY_EXTENSION[extension];
    if (!mimeType) return null;

    try {
      const stats = await stat(path);
      if (!stats.isFile()) return null;
      return { stream: createReadStream(path), size: stats.size, mimeType };
    } catch {
      return null;
    }
  }

  async remove(organizationId: string, filename: string): Promise<boolean> {
    const path = resolveSafePath(organizationId, filename);
    if (!path) return false;
    try {
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Picks LocalStorageBackend or S3StorageBackend per STORAGE_PROVIDER (env, read via
 * ConfigService — this class is a normal Nest provider, unlike LocalDiskStorageEngine/
 * S3StorageEngine in uploads.controller.ts, which are built at decorator-evaluation time before
 * Nest's config layer exists). publicUrl() always points at our own `/api/v1/uploads/:orgId/
 * :filename` route regardless of backend — files are proxied through the API on both providers
 * (avoids requiring public bucket ACLs/CORS just to serve an image), so read/remove are the only
 * operations that actually differ per provider.
 */
@Injectable()
export class StorageService {
  private readonly backend: StorageBackend;

  constructor(private readonly configService: ConfigService) {
    const provider = this.configService.get<string>('STORAGE_PROVIDER');
    this.backend =
      provider === 's3'
        ? new S3StorageBackend(
            new S3Client({
              region: S3_STORAGE_CONFIG.region,
              endpoint: S3_STORAGE_CONFIG.endpoint,
              forcePathStyle: S3_STORAGE_CONFIG.forcePathStyle,
              credentials: {
                accessKeyId: S3_STORAGE_CONFIG.accessKeyId,
                secretAccessKey: S3_STORAGE_CONFIG.secretAccessKey,
              },
            }),
            S3_STORAGE_CONFIG.bucket,
          )
        : new LocalStorageBackend();
  }

  // Offer.images validates each entry as an absolute URL (Zod .url()), so this must never
  // return a bare path — same API_URL-based pattern already used for absolute link-building in
  // password-reset.service.ts / email-verification.service.ts.
  publicUrl(organizationId: string, filename: string): string {
    const apiUrl =
      this.configService.get<string>('API_URL') ?? 'http://localhost:4000';
    return `${apiUrl}/api/v1/uploads/${organizationId}/${filename}`;
  }

  readStream(
    organizationId: string,
    filename: string,
  ): Promise<ReadableStoredFile | null> {
    return this.backend.readStream(organizationId, filename);
  }

  remove(organizationId: string, filename: string): Promise<boolean> {
    return this.backend.remove(organizationId, filename);
  }
}

function resolveSafePath(
  organizationId: string,
  filename: string,
): string | null {
  if (!SAFE_ORGANIZATION_ID.test(organizationId)) return null;
  if (!SAFE_FILENAME.test(filename)) return null;
  const path = join(LOCAL_STORAGE_ROOT_DIR, organizationId, filename);
  if (!path.startsWith(LOCAL_STORAGE_ROOT_DIR + sep)) return null;
  return path;
}
