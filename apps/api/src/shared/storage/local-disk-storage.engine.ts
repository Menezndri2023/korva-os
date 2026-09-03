import { UnsupportedMediaTypeException } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { RequestWithContext } from '../../core/tenant/request-context.types';
import { ALLOWED_UPLOAD_MIME_TYPES } from './storage.constants';
import {
  FILE_SIGNATURE_CHECKS,
  SIGNATURE_CHECK_BYTES,
} from './file-signature-checks';

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
 * uploads.controller.ts, which runs before multer ever calls `_handleFile`); the declared-
 * mimetype check here is defense-in-depth only. The actual-bytes signature check below is NOT
 * redundant with either of those — both only ever see the client-supplied mimetype string, never
 * the file's real content.
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

    const dir = join(this.rootDir, organizationId);
    const filename = `${randomUUID()}.${extension}`;
    const destinationPath = join(dir, filename);

    mkdir(dir, { recursive: true })
      .then(() => {
        let size = 0;
        let settled = false;
        let signatureVerified = false;
        let headBuffer = Buffer.alloc(0);
        const writeStream = createWriteStream(destinationPath);

        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          writeStream.destroy();
          // Drain and discard whatever the client still has in flight instead of leaving the
          // request stream dangling mid-upload, which could hang the connection.
          file.stream.removeAllListeners('data');
          file.stream.resume();
          unlink(destinationPath).catch(() => {});
          callback(error);
        };

        const verifySignature = (): boolean => {
          signatureVerified = true;
          if (!signatureCheck(headBuffer)) {
            fail(
              new UnsupportedMediaTypeException({
                code: 'UNSUPPORTED_FILE_TYPE',
                message: `File content does not match declared type "${file.mimetype}"`,
              }),
            );
            return false;
          }
          writeStream.write(headBuffer);
          return true;
        };

        file.stream.on('data', (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;

          if (!signatureVerified) {
            headBuffer = Buffer.concat([headBuffer, chunk]);
            if (headBuffer.length < SIGNATURE_CHECK_BYTES) return;
            if (!verifySignature()) return;
            return;
          }
          writeStream.write(chunk);
        });

        file.stream.on('end', () => {
          if (settled) return;
          // Fewer bytes ever arrived than SIGNATURE_CHECK_BYTES (a tiny/empty file) — verify
          // against whatever was buffered; every real signature above needs at most 12 bytes, so
          // anything shorter genuinely can't be a valid file of its claimed type.
          if (!signatureVerified && !verifySignature()) return;
          writeStream.end();
        });

        file.stream.on('error', (error) => fail(error as Error));
        writeStream.on('error', (error) => fail(error));
        writeStream.on('finish', () => {
          if (settled) return;
          settled = true;
          callback(null, {
            destination: dir,
            filename,
            path: destinationPath,
            size,
          });
        });
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
