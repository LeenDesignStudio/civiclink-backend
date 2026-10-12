import 'dotenv/config';
import { closePipelineCli, reportCliError, runCollectorCli } from './pipeline-app.js';

runCollectorCli(process.argv.slice(2))
  .catch((err: unknown) => {
    reportCliError(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePipelineCli();
  });
