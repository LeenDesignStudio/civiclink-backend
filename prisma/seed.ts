import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';

const CATEGORIES = [
  'Elections & Voting',
  'Taxes & Assessments',
  'Permits & Licenses',
  'Waste & Recycling',
  'Utilities',
  'Public Safety',
  'Streets & Transportation',
  'Parks & Recreation',
  'Schools & Education',
  'Health & Human Services',
] as const;

async function main(): Promise<void> {
  const effectiveAt = new Date('2026-01-01T00:00:00.000Z');
  for (const kind of ['TERMS', 'PRIVACY'] as const) {
    await prisma.legalDocument.upsert({
      where: { kind_version: { kind, version: 'v1' } },
      create: { kind, version: 'v1', effectiveAt, current: true },
      update: { current: true, effectiveAt },
    });
  }

  for (const [index, name] of CATEGORIES.entries()) {
    await prisma.serviceCategory.upsert({
      where: { name },
      create: { name, sortOrder: index, active: true },
      update: { sortOrder: index, active: true },
    });
  }

  await prisma.source.upsert({
    where: { name: 'Seed fixtures' },
    create: {
      name: 'Seed fixtures',
      publisher: 'CivicLink',
      url: 'https://civiclink.local/seed',
      termsUrl: 'https://civiclink.local/terms',
      method: 'MANUAL',
      schedule: 'ON_DEMAND',
      levels: ['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL'],
      active: true,
    },
    update: { active: true },
  });

  await prisma.adminUser.upsert({
    where: { email: env.BOOTSTRAP_SUPER_ADMIN_EMAIL },
    create: {
      email: env.BOOTSTRAP_SUPER_ADMIN_EMAIL,
      role: 'SUPER_ADMIN',
      status: 'INVITED',
    },
    update: {},
  });

  if (env.APP_ENV === 'development') {
    await prisma.plan.upsert({
      where: { stripePriceId: 'price_dev_resident' },
      create: {
        stripePriceId: 'price_dev_resident',
        name: 'Resident',
        amountCents: 0,
        currency: 'usd',
        interval: 'month',
        features: [],
        entitlements: {
          maxSavedLocations: env.LIMIT_DEFAULT_MAX_SAVED_LOCATIONS,
          maxFollows: env.LIMIT_DEFAULT_MAX_FOLLOWS,
        },
        active: true,
        sortOrder: 0,
      },
      update: { active: true },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (_error: unknown) => {
    process.stderr.write('seed failed\n');
    await prisma.$disconnect();
    process.exit(1);
  });
