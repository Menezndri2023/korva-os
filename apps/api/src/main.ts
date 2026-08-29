import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { publicCorsMiddleware } from './common/middleware/public-cors.middleware';
import { StructuredLogger } from './common/logging/structured-logger.service';
import { initSentry, captureApiException } from './core/observability/sentry';

async function bootstrap() {
  // Arm Sentry (no-op if SENTRY_DSN is unset) before anything else runs, so a crash during
  // app/module initialization itself — e.g. Mongoose failing to connect — is still capturable
  // via the bootstrap().catch() handler below.
  initSentry();

  // rawBody: true makes Express preserve the raw request body bytes on `req.rawBody` (alongside
  // the normal parsed `req.body` — this does not change parsing behavior for any other route).
  // Required by ResendWebhookController's Svix HMAC-SHA256 signature verification, which must
  // hash the exact bytes Resend sent — see communication/webhooks/resend-webhook.controller.ts.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Replaces Nest's default ConsoleLogger with a JSON-structured one that also stamps every log
  // line with the current request's id (see common/logging/) — done as early as possible so it
  // covers the rest of bootstrap too. This is the only reason main.ts is touched this wave; see
  // common/logging/structured-logger.service.ts and common/middleware/request-id.middleware.ts
  // for the actual logic.
  app.useLogger(new StructuredLogger());

  const configService = app.get(ConfigService);

  // Without this, Nest never forwards SIGTERM to module lifecycle hooks (OnModuleDestroy) —
  // EventsProcessor/EventBusService's Redis connections never close cleanly, and `docker stop`
  // has to wait out its full grace period and SIGKILL the process instead of exiting promptly.
  app.enableShutdownHooks();

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(compression());

  // Must run before app.enableCors() below — see publicCorsMiddleware's own doc comment for
  // why a permissive /public/* policy and the dashboard's strict allowlist can safely coexist.
  app.use(publicCorsMiddleware);

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
  captureApiException(error, { method: 'BOOTSTRAP', route: 'bootstrap' });
  process.exit(1);
});
