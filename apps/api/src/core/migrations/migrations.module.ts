import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Migration, MigrationSchema } from './schemas/migration.schema';

/**
 * Registers the `migrations` collection so scripts/migrate.ts can read and write it through the
 * normal Mongoose model, rather than reaching into the raw driver.
 *
 * No provider and no controller: nothing in the running application reads or writes migration
 * records. The runner is a deploy-time script (see scripts/migrate.ts for why it is deliberately
 * not an endpoint and deliberately not run at boot), and this module exists purely so that
 * script can resolve the model from the same AppModule it already builds.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Migration.name, schema: MigrationSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class MigrationsModule {}
