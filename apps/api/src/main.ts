import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Without this, Nest never forwards SIGTERM to module lifecycle hooks (OnModuleDestroy) —
  // EventsProcessor/EventBusService's Redis connections never close cleanly, and `docker stop`
  // has to wait out its full grace period and SIGKILL the process instead of exiting promptly.
  app.enableShutdownHooks();

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(compression());

  // Reflecting any Origin with credentials:true would let any site make authenticated
  // requests on a logged-in user's behalf — always resolve to an explicit allowlist.
  const corsOrigins = (
    configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.setGlobalPrefix('api/v1');

  if (configService.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('KORVA OS API')
      .setDescription('Business Operating System SaaS multi-tenant — API v1')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  const port = configService.get<string>('PORT') ?? 4000;
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start KORVA API', error);
  process.exit(1);
});
