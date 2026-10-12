import 'dotenv/config';
import { closePipelineCli, reportCliError, runPilotCli } from './pipeline-app.js';

runPilotCli(process.argv.slice(2))
  .catch((err: unknown) => {
    reportCliError(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePipelineCli();
  });
