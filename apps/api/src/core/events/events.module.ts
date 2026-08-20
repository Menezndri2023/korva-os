import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';

/** Global so any module can inject EventBusService to publish without adding EventsModule to every import list. */
@Global()
@Module({
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
