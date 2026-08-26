import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Settlement, SettlementSchema } from './schemas/settlement.schema';
import { SettlementRepository } from './settlement.repository';
import { SettlementService } from './settlement.service';

/**
 * Stage 1 domain module for split settlement (Flow B, Merchant of Record — see
 * docs/architecture/integrations-platform.md §4 "Split settlement"). Deliberately NOT imported
 * into FinanceModule or AppModule yet — this is standalone scaffolding, not wired into the real
 * payment-completion flow. Wiring is deferred to whichever Stage 2 work actually needs it (a
 * real PSP adapter must exist first).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Settlement.name, schema: SettlementSchema },
    ]),
  ],
  providers: [SettlementRepository, SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
