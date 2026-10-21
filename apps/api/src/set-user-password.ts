/**
 * Creates a KORVA account, or sets the password of an existing one, from the server — no email
 * needed. Written for the first administrator: PLATFORM_ADMIN_EMAILS names who may enter the
 * administration, but it creates no account and no password, and "Mot de passe oublié" depends on
 * email delivery that may not be configured yet.
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm --no-deps api node dist/set-user-password.js ops@example.com
 *
 * Over SSH, connect with `ssh -t` so the prompt can hide what is typed.
 *
 * THE PASSWORD IS NEVER AN ARGUMENT. Command lines end up in the shell history and in the process
 * list (a container entrypoint once printed a database password from argv). It is typed at a
 * masked prompt, twice, or — for automation only — read from standard input when that is not a
 * terminal.
 *
 * Setting the password of an existing account also clears its failed-login lock and closes its
 * open sessions. It does not re-enable an account the administration disabled.
 */
import { NestFactory } from '@nestjs/core';

process.env.DISABLE_BACKGROUND_WORKERS = 'true';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { registerSchema } from '@korva/validation';
import { AppModule } from './app.module';
import { UsersService } from './identity/users/users.service';

/** Reads one line without echoing it (a terminal), or plainly (piped input). */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk: string | Buffer) => (data += chunk.toString()));
      stdin.on('end', () => resolve(data.split('\n')[0]!.replace(/\r$/, '')));
      stdin.on('error', reject);
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      for (const char of key) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function run() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !registerSchema.shape.email.safeParse(email).success) {
    console.error('Usage: node dist/set-user-password.js <email>');
    process.exit(1);
  }

  const password = await readSecret(`Nouveau mot de passe pour ${email} : `);
  const check = registerSchema.shape.password.safeParse(password);
  if (!check.success) {
    console.error('Mot de passe refusé : entre 8 et 72 caractères.');
    process.exit(1);
  }
  if (process.stdin.isTTY) {
    const confirmation = await readSecret('Confirmez le mot de passe : ');
    if (confirmation !== password) {
      console.error('Les deux saisies diffèrent. Rien n’a été modifié.');
      process.exit(1);
    }
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const users = app.get(UsersService);
    const existing = await users.findByEmail(email);
    if (!existing) {
      await users.create(email, password);
      console.log(
        `Compte créé pour ${email}. Connectez-vous sur la page de connexion habituelle.`,
      );
      return;
    }

    await users.updatePasswordHash(
      existing.id as string,
      await users.hashPassword(password),
    );
    await users.resetFailedAttempts(existing.id as string);
    const connection = app.get<Connection>(getConnectionToken());
    await connection
      .collection('sessions')
      .updateMany(
        { userId: existing._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    console.log(
      `Mot de passe mis à jour pour ${email} ; ses sessions ouvertes ont été fermées.`,
    );
    if (existing.disabledAt) {
      console.log(
        'Attention : ce compte est désactivé par l’administration — réactivez-le pour qu’il puisse se connecter.',
      );
    }
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  console.error('Échec :', error instanceof Error ? error.message : error);
  process.exit(1);
});
