import { Module } from '@nestjs/common';
import { DocumentRenderingService } from './rendering/document-rendering.service';

@Module({
  providers: [DocumentRenderingService],
  exports: [DocumentRenderingService],
})
export class DocumentsModule {}
