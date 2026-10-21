/**
 * Creates the KORVA administrator account for an address listed in PLATFORM_ADMIN_EMAILS — or
 * gives it a new password — and prints that password ONCE, on the operator's terminal:
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm --no-deps api node dist/create-platform-admin.js ops@example.com
 *
 * The password is generated here, at random (~144 bits), and only its argon2 hash is stored. It
 * is never passed on a command line, never logged, and never written anywhere else: copy it into
 * a password manager, sign in at /admin/connexion, and change it from the administration if you
 * like. Running the command again for the same address replaces the password (and unlocks the
 * account) — the recovery path when it is lost.
 *
 * An administrator is not a business user (see PlatformAdmin): this creates no User, no
 * organization, nothing a customer would see.
 */
import { NestFactory } from '@nestjs/core';

process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { AppModule } from './app.module';
import { PlatformAdminAuthService } from './platform-admin/platform-admin-auth.service';

async function run() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error(
      'Usage : node dist/create-platform-admin.js <adresse e-mail>',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const result = await app.get(PlatformAdminAuthService).provision(email);
    const line = '─'.repeat(60);
    console.log(line);
    console.log(
      result.created
        ? `Compte administrateur KORVA créé pour ${result.email}`
        : `Nouveau mot de passe administrateur pour ${result.email}`,
    );
    console.log('');
    console.log(`  Mot de passe : ${result.password}`);
    console.log('');
    console.log(
      'Il ne sera plus jamais affiché. Copiez-le dans un gestionnaire de mots de passe,',
    );
    console.log(
      'puis connectez-vous sur https://app.korvasuite.com/admin/connexion',
    );
    console.log(line);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'response' in error
        ? JSON.stringify(error.response)
        : error instanceof Error
          ? error.message
          : String(error);
    console.error(`Échec : ${message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void run();
