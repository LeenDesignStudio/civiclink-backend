import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against database "${name}"`);
  }
}

function migrate(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, MIGRATION_DATABASE_URL: url },
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma migrate deploy exited ${code ?? 'null'}`));
    });
    child.on('error', reject);
  });
}

async function grantApp(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO civiclink_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO civiclink_app;
      REVOKE UPDATE, DELETE, TRUNCATE ON change_log FROM civiclink_app;
    `);
  } finally {
    await client.end();
  }
}

async function execSql(connectionString: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export default async function setup(project: { provide(key: string, value: string): void }): Promise<() => Promise<void>> {
  const existing = process.env.TEST_DATABASE_URL;
  const existingOwner = process.env.TEST_MIGRATION_DATABASE_URL;
  if (existing && existingOwner) {
    assertTestDatabase(existing);
    assertTestDatabase(existingOwner);
    await migrate(existingOwner);
    await grantApp(existingOwner);
    project.provide('databaseUrl', existing);
    project.provide('ownerUrl', existingOwner);
    return async () => {};
  }

  const container = await new PostgreSqlContainer('postgis/postgis:16-3.5').start();
  const adminUrl = container.getConnectionUri();
  const ownerPass = randomBytes(18).toString('hex');
  const appPass = randomBytes(18).toString('hex');
  await execSql(
    adminUrl,
    `
      CREATE ROLE civiclink_owner LOGIN PASSWORD '${ownerPass}';
      CREATE ROLE civiclink_app LOGIN PASSWORD '${appPass}';
    `,
  );
  await execSql(adminUrl, 'CREATE DATABASE civiclink_test OWNER civiclink_owner');
  const host = container.getHost();
  const port = container.getPort();
  const adminDb = `postgresql://${encodeURIComponent(container.getUsername())}:${encodeURIComponent(container.getPassword())}@${host}:${port}/civiclink_test`;
  await execSql(
    adminDb,
    `
      CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
      CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
      CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
      ALTER DATABASE civiclink_test SET search_path TO public, extensions;
      GRANT USAGE ON SCHEMA extensions TO civiclink_app;
      GRANT USAGE ON SCHEMA public TO civiclink_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO civiclink_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO civiclink_app;
      CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION civiclink_app;
    `,
  );
  const ownerUrl = `postgresql://civiclink_owner:${ownerPass}@${host}:${port}/civiclink_test`;
  const appUrl = `postgresql://civiclink_app:${appPass}@${host}:${port}/civiclink_test`;
  assertTestDatabase(ownerUrl);
  assertTestDatabase(appUrl);
  await migrate(ownerUrl);
  await grantApp(ownerUrl);
  project.provide('databaseUrl', appUrl);
  project.provide('ownerUrl', ownerUrl);
  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerUrl: string;
  }
}
