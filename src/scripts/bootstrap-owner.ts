/**
 * One-time owner bootstrap (Phase 1).
 *
 * Usage:
 *   npm run admin:bootstrap-owner -- --user-id <UUID> [--approved-by <UUID>] [--yes]
 *
 * Rules (mirrors AdminAuthService.bootstrapOwner):
 * - First owner (no active owners exist): promotes the target freely.
 * - Later promotions: require --approved-by an active owner, never self-approval.
 * - Target must exist and be active. Already-owner is a no-op.
 * - Requires explicit operator shell access; every run is audited.
 * - Never commit identities or run against production without a backup.
 */
import * as readline from 'readline';
import { NestFactory } from '@nestjs/core';
import { ApiAppModule } from '@app/apps/api/api-app.module';
import { AdminAuthService } from '@app/modules/admin/auth/admin-auth.service';

function parseArgs(argv: string[]): { userId?: string; approvedBy?: string; yes: boolean } {
  const args = { userId: undefined as string | undefined, approvedBy: undefined as string | undefined, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--user-id' && argv[i + 1]) {
      args.userId = argv[++i];
    } else if (argv[i] === '--approved-by' && argv[i + 1]) {
      args.approvedBy = argv[++i];
    } else if (argv[i] === '--yes') {
      args.yes = true;
    }
  }
  return args;
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  const { userId, approvedBy, yes } = parseArgs(process.argv.slice(2));
  if (!userId) {
    console.error('Usage: npm run admin:bootstrap-owner -- --user-id <UUID> [--approved-by <UUID>] [--yes]');
    process.exit(2);
  }

  if (!yes) {
    const ok = await confirm(
      `Promote user ${userId} to owner${approvedBy ? ` (approved by ${approvedBy})` : ''}? [y/N] `,
    );
    if (!ok) {
      console.log('Aborted.');
      process.exit(1);
    }
  }

  const app = await NestFactory.createApplicationContext(ApiAppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = app.get(AdminAuthService);
    const result = await service.bootstrapOwner(userId, approvedBy);
    console.log(
      result.changed
        ? `OK: ${result.id} is now owner.`
        : `OK: ${result.id} was already owner (no change).`,
    );
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
