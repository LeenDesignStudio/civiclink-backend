import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '../src/generated/prisma/client.js';
import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { parsePageSourceFile, sourceCatalog, type SourceSeed } from '../src/modules/pipeline/source-catalog.js';

async function main(): Promise<void> {
  const seeds = [...sourceCatalog(env.TIGER_YEAR), ...(await pageSeeds())];
  const names = new Set<string>();
  for (const seed of seeds) {
    if (names.has(seed.name)) throw new Error(`Duplicate source name: ${seed.name}`);
    names.add(seed.name);
    await upsertSeed(seed);
    process.stdout.write(`upserted ${seed.name}\n`);
  }
}

async function pageSeeds(): Promise<SourceSeed[]> {
  const dir = path.join(process.cwd(), 'data', 'page-sources');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const seeds: SourceSeed[] = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const text = await readFile(path.join(dir, name), 'utf8');
    seeds.push(parsePageSourceFile(text, name));
  }
  return seeds;
}

async function upsertSeed(seed: SourceSeed): Promise<void> {
  const data = {
    publisher: seed.publisher,
    url: seed.url,
    termsUrl: seed.termsUrl,
    method: seed.method,
    schedule: seed.schedule,
    freshnessDays: seed.freshnessDays,
    levels: seed.levels,
    collectorKey: seed.collectorKey,
    config: seed.config as Prisma.InputJsonValue,
    active: true,
  };
  await prisma.source.upsert({
    where: { name: seed.name },
    create: { name: seed.name, ...data },
    update: data,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async () => {
    process.stderr.write('seed sources failed\n');
    await prisma.$disconnect();
    process.exit(1);
  });
