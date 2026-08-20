import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomField, CustomFieldSchema } from './schemas/custom-field.schema';
import { CustomFieldsRepository } from './custom-fields.repository';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldsController } from './custom-fields.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomField.name, schema: CustomFieldSchema },
    ]),
  ],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsRepository, CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
