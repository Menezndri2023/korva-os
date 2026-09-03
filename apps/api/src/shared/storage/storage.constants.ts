import { join } from 'node:path';

/** mimetype -> allowed file extension. The only file types POST /uploads accepts. */
export const ALLOWED_UPLOAD_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Shared between LocalStorageBackend and S3StorageBackend (storage.service.ts): rejects anything
 * that isn't exactly `<24-hex-char ObjectId>/<uuid>.<allowed-ext>`. organizationId and filename
 * both come straight from the URL path (GET is public — see uploads.controller.ts), so this
 * format check is what stands between a crafted request and a `../../` traversal read/delete on
 * local disk, or an arbitrary-key read/delete against the bucket on S3.
 */
export const SAFE_ORGANIZATION_ID = /^[a-f0-9]{24}$/i;
export const SAFE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;

/**
 * Local filesystem root for uploaded files — the default/fallback storage provider
 * (STORAGE_PROVIDER=local in .env.example; no other provider is implemented yet, see
 * storage.service.ts). Deliberately NOT read from an env var: `LocalDiskStorageEngine` is
 * constructed directly as a `FileInterceptor` option at controller decorator-evaluation time
 * (uploads.controller.ts), which runs while the module graph is still being `require()`'d —
 * before `ConfigModule.forRoot()` is ever called in app.module.ts, so `process.env` isn't
 * reliably populated from `.env` yet at that point. Resolving against `process.cwd()` needs no
 * config layer and is available synchronously wherever this constant is imported.
 */
export const LOCAL_STORAGE_ROOT_DIR = join(process.cwd(), 'uploads');

/**
 * S3-compatible object storage config — read directly from `process.env` (not ConfigService),
 * same constraint as LOCAL_STORAGE_ROOT_DIR above: `uploads.controller.ts` builds its storage
 * engine as a module-level constant at decorator-evaluation time, before
 * `ConfigModule.forRoot()` ever runs. `STORAGE_ENDPOINT` is only set for a non-AWS S3-compatible
 * provider (MinIO, Cloudflare R2, Backblaze B2, ...); leave it unset to talk to real AWS S3.
 */
export const S3_STORAGE_CONFIG = {
  bucket: process.env.STORAGE_BUCKET ?? '',
  region: process.env.STORAGE_REGION || 'us-east-1',
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
  secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
  // R2/MinIO require path-style addressing (`endpoint/bucket/key`); real AWS S3 uses virtual-
  // hosted-style by default and only needs this when a custom endpoint is also set.
  forcePathStyle: Boolean(process.env.STORAGE_ENDPOINT),
};
