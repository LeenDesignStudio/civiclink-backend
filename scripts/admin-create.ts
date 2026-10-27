import 'dotenv/config';

const ROLES = ['VIEWER', 'EDITOR', 'COMMUNICATIONS', 'SUPER_ADMIN'] as const;
type AdminRoleFlag = (typeof ROLES)[number];

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function isRole(value: string): value is AdminRoleFlag {
  return (ROLES as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const email = flag('email')?.trim().toLowerCase();
  const name = flag('name')?.trim();
  const role = flag('role');
  if (!email || !email.includes('@') || !name || name.length > 100 || !role || !isRole(role)) {
    process.stderr.write('Usage: pnpm admin:create --email <email> --name <name> --role SUPER_ADMIN\n');
    process.exitCode = 1;
    return;
  }

  const { prisma } = await import('../src/db/prisma.js');
  const { env } = await import('../src/config/env.js');
  const { AdminAuthRepo } = await import('../src/auth/admin-auth.repo.js');
  const { AdminAuthService } = await import('../src/auth/admin-auth.js');
  const { Argon2Hasher } = await import('../src/auth/passwords.js');
  const { systemClock } = await import('../src/lib/clock.js');
  const { systemRandom } = await import('../src/lib/random.js');
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email }, select: { id: true, status: true } });
    if (existing?.status === 'DEACTIVATED') {
      process.stderr.write('That admin is deactivated.\n');
      process.exitCode = 1;
      return;
    }
    const adminId = existing
      ? existing.id
      : (
          await prisma.adminUser.create({
            data: { email, name, role, status: 'INVITED', invitedAt: new Date() },
            select: { id: true },
          })
        ).id;
    const auth = new AdminAuthService({
      store: new AdminAuthRepo(prisma),
      clock: systemClock,
      random: systemRandom,
      passwords: new Argon2Hasher(),
      webUrl: env.PUBLIC_WEB_URL,
    });
    process.stdout.write(`${await auth.issueInvite(adminId)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write('Could not create the admin invite.\n');
  process.exitCode = 1;
});
