import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, type ReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  LOCAL_STORAGE_ROOT_DIR,
} from './storage.constants';

const SAFE_ORGANIZATION_ID = /^[a-f0-9]{24}$/i;
const SAFE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;

const MIME_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_UPLOAD_MIME_TYPES).map(([mime, ext]) => [ext, mime]),
);

export interface ReadableStoredFile {
  stream: ReadStream;
  size: number;
  mimeType: string;
}

/**
 * Local-filesystem implementation of the storage abstraction — the default/fallback per
 * STORAGE_PROVIDER=local in .env.example (the only value that env var has ever held there; no
 * cloud provider is implemented). Deliberately kept provider-agnostic in its public shape
 * (organizationId + filename in, a stream or a public URL out — no filesystem-specific detail
 * leaks to callers) so a future S3-compatible provider (matching the already-declared but
 * previously-unused STORAGE_BUCKET/STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY env vars) could
 * implement the same shape and be swapped in behind UploadsController without changing it.
 */
@Injectable()
export class StorageService {
  constructor(private readonly configService: ConfigService) {}

  // Offer.images validates each entry as an absolute URL (Zod .url()), so this must never
  // return a bare path — same API_URL-based pattern already used for absolute link-building in
  // password-reset.service.ts / email-verification.service.ts.
  publicUrl(organizationId: string, filename: string): string {
    const apiUrl =
      this.configService.get<string>('API_URL') ?? 'http://localhost:4000';
    return `${apiUrl}/api/v1/uploads/${organizationId}/${filename}`;
  }

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
 * Rejects anything that isn't exactly `<24-hex-char ObjectId>/<uuid>.<allowed-ext>` under the
 * storage root. organizationId and filename both come straight from the URL path (GET is public,
 * see uploads.controller.ts) — this format check, plus the final startsWith guard against the
 * resolved root, is the only thing standing between a crafted request and a `../../` traversal
 * read/delete.
 */
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
