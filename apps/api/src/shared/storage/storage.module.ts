import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';

/**
 * Imported by CatalogModule (see catalog.module.ts) rather than registered directly in
 * app.module.ts: app.module.ts sits outside this change's ownership boundary and is shared
 * ground with other work landing in the same wave, but Nest only needs a module to appear
 * anywhere in the compiled module graph to pick up its controllers/providers — CatalogModule is
 * already on AppModule's import list, so importing StorageModule there is enough for
 * UploadsController's routes to be registered.
 */
@Module({
  controllers: [UploadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
