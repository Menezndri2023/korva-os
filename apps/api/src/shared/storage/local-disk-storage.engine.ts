import { UnsupportedMediaTypeException } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { RequestWithContext } from '../../core/tenant/request-context.types';
import { ALLOWED_UPLOAD_MIME_TYPES } from './storage.constants';

/** Shape multer actually passes to a StorageEngine — matches busboy's parsed file, not
 * @types/multer (not installed; see the class doc below for why). */
export interface MulterFileLike {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
}

export interface StoredMulterFileInfo {
  destination: string;
  filename: string;
  path: string;
  size: number;
}

/**
 * Hand-written multer StorageEngine (see https://github.com/expressjs/multer#storage) rather
 * than importing multer's own `diskStorage()`: multer is only a *transitive* dependency here
 * (pulled in by @nestjs/platform-express, whose FileInterceptor uses it internally in
 * uploads.controller.ts) — not a direct dependency of @korva/api, and @types/multer isn't
 * installed either. Importing from 'multer' directly would be a phantom-dependency import that
 * happens to resolve today only by accident of the current pnpm store layout. multer's
 * StorageEngine contract is exactly the two methods below (`_handleFile` / `_removeFile`);
 * implementing it by hand against Node's fs/promises avoids that risk entirely.
 *
 * Files are written under `<rootDir>/<organizationId>/<uuid>.<ext>`. organizationId comes from
 * `req.tenant` — already resolved by TenantGuard, which (as a Guard) always runs before this
 * interceptor's `intercept()` in Nest's request pipeline, so by the time multer calls
 * `_handleFile` the request is already authenticated and tenant-scoped.
 *
 * Size limits are NOT enforced here: `limits.fileSize` is passed straight to busboy by multer
 * itself (see uploads.controller.ts), which truncates the incoming stream and aborts the whole
 * upload — including calling `_removeFile` on whatever this engine already wrote — before
 * `@nestjs/platform-express` ever surfaces a response, independently of which StorageEngine is
 * used. Mimetype filtering is likewise primarily `fileFilter`'s job (also in
 * uploads.controller.ts, which runs before multer ever calls `_handleFile`); the check here is
 * defense-in-depth only.
 */
export class LocalDiskStorageEngine {
  constructor(private readonly rootDir: string) {}

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
    if (!extension) {
      callback(
        new UnsupportedMediaTypeException({
          code: 'UNSUPPORTED_FILE_TYPE',
          message: `File type "${file.mimetype}" is not allowed`,
        }),
      );
      return;
    }

    const dir = join(this.rootDir, organizationId);
    const filename = `${randomUUID()}.${extension}`;
    const destinationPath = join(dir, filename);

    mkdir(dir, { recursive: true })
      .then(() => {
        let size = 0;
        const writeStream = createWriteStream(destinationPath);
        file.stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
        });
        writeStream.on('error', (error) => callback(error));
        writeStream.on('finish', () => {
          callback(null, {
            destination: dir,
            filename,
            path: destinationPath,
            size,
          });
        });
        file.stream.pipe(writeStream);
      })
      .catch((error: Error) => callback(error));
  }

  _removeFile(
    _req: Request,
    file: StoredMulterFileInfo,
    callback: (error: Error | null) => void,
  ): void {
    // Best-effort cleanup (e.g. an aborted/oversized upload) — a file that's already gone is
    // not itself an error worth surfacing.
    unlink(file.path)
      .then(() => callback(null))
      .catch(() => callback(null));
  }
}
