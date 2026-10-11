import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { reportCliError, runCollectorCli } from './pipeline-app.js';

runCollectorCli(process.argv.slice(2))
  .catch((err: unknown) => {
    reportCliError(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
