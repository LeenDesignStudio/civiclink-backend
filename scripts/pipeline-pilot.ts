import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { reportCliError, runPilotCli } from './pipeline-app.js';

runPilotCli(process.argv.slice(2))
  .catch((err: unknown) => {
    reportCliError(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
