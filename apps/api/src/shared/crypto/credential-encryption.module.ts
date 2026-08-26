import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CredentialEncryptionService } from './credential-encryption.service';

@Module({
  imports: [ConfigModule],
  providers: [CredentialEncryptionService],
  exports: [CredentialEncryptionService],
})
export class CredentialEncryptionModule {}
