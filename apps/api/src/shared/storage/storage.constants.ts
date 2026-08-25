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
