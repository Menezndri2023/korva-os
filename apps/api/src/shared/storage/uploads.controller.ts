import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { S3Client } from '@aws-sdk/client-s3';
import type { Response } from 'express';
import type { TenantContext } from '@korva/types';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { StorageService } from './storage.service';
import { LocalDiskStorageEngine } from './local-disk-storage.engine';
import { S3StorageEngine } from './s3-storage.engine';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  LOCAL_STORAGE_ROOT_DIR,
  MAX_UPLOAD_BYTES,
  S3_STORAGE_CONFIG,
} from './storage.constants';

/** What multer actually attaches to the request as req.file — see local-disk-storage.engine.ts
 * for why this is hand-typed instead of Express.Multer.File (@types/multer isn't installed). */
interface UploadedFileLike {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  filename: string;
}

// Constructed once at module-load time (not per-request, not through Nest DI) since it's passed
// as a plain FileInterceptor option — see storage.constants.ts for why this reads `process.env`
// directly (via S3_STORAGE_CONFIG) rather than through Nest's config layer, which doesn't exist
// yet at this point in the module graph's evaluation.
const storageEngine =
  process.env.STORAGE_PROVIDER === 's3'
    ? new S3StorageEngine(
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
    : new LocalDiskStorageEngine(LOCAL_STORAGE_ROOT_DIR);

/**
 * Generic file/image upload — closes the gap the audit found: Offer.images was a string[] of
 * URLs with no actual upload mechanism anywhere (no multer/S3/GridFS, nothing under
 * shared/storage at all). Lives under shared/storage (not catalog) since the mechanism itself is
 * generic, but the intended/primary consumer is Offer.images (see
 * packages/validation/src/catalog.ts — still a plain URL string array, now one POST /uploads can
 * actually populate with a real, working URL), hence gating writes with the existing offers.*
 * permissions rather than adding new ones (see categories.controller.ts for the same reasoning).
 *
 * GET is deliberately public/unauthenticated: the URLs this returns are meant to be used as
 * <img src="..."> on public storefront pages (apps/storefront), which cannot attach an
 * Authorization header to an image request. Tenant isolation therefore applies to the write side
 * only — POST requires auth and scopes the file under the caller's own organizationId, and
 * DELETE refuses to remove a file whose organizationId segment doesn't match the caller's own
 * tenant (see `remove` below) — matching how a public object-storage bucket is normally secured
 * (public read, authenticated write) rather than gating reads, which would break the very
 * feature these URLs exist for.
 */
@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @RequireModule('catalog')
  @RequirePermissions('offers.update')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: storageEngine,
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (
        _req: unknown,
        file: { mimetype: string },
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        if (!ALLOWED_UPLOAD_MIME_TYPES[file.mimetype]) {
          callback(
            new BadRequestException({
              code: 'UNSUPPORTED_FILE_TYPE',
              message: `File type "${file.mimetype}" is not allowed`,
            }),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(
    @CurrentTenant() tenant: TenantContext,
    @UploadedFile() file?: UploadedFileLike,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'A file is required (multipart field name: "file")',
      });
    }

    return {
      url: this.storageService.publicUrl(tenant.organizationId, file.filename),
      filename: file.filename,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  @Public()
  @Get(':organizationId/:filename')
  async read(
    @Param('organizationId') organizationId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.storageService.readStream(organizationId, filename);
    if (!file) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'File not found',
      });
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size.toString());
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Defense in depth alongside LocalDiskStorageEngine's magic-byte check: even though every
    // stored file's content is now verified to actually match its extension at upload time,
    // never let a browser MIME-sniff this response into something other than the declared
    // image type (e.g. as HTML, if a legacy sniffing algorithm ever disagreed with it).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.stream.pipe(res);
  }

  @RequireModule('catalog')
  @RequirePermissions('offers.update')
  @Delete(':organizationId/:filename')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('organizationId') organizationId: string,
    @Param('filename') filename: string,
  ): Promise<{ deleted: true }> {
    // A caller is always resolved against their own tenant.organizationId (TenantGuard already
    // verified real membership) — never trust the URL's organizationId segment on its own for a
    // mutating call, only for the public, read-only GET above.
    if (organizationId !== tenant.organizationId) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'File not found',
      });
    }

    const deleted = await this.storageService.remove(organizationId, filename);
    if (!deleted) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'File not found',
      });
    }

    return { deleted: true };
  }
}
