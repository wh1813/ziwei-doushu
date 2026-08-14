import { readFile, writeFile } from 'node:fs/promises';

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
if (!databaseId) {
  throw new Error(
    'CLOUDFLARE_D1_DATABASE_ID is required. Create the D1 database and add its ID to the deployment environment.',
  );
}

const databaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim() || 'ziwei-doushu-logs';
const sourceUrl = new URL('../wrangler.jsonc', import.meta.url);
const outputUrl = new URL('../wrangler.deploy.jsonc', import.meta.url);
const config = JSON.parse(await readFile(sourceUrl, 'utf8'));

config.d1_databases = [
  ...(config.d1_databases || []).filter((item) => item.binding !== 'QUERY_LOGS_DB'),
  {
    binding: 'QUERY_LOGS_DB',
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: 'migrations',
  },
];

await writeFile(outputUrl, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log(`Prepared Cloudflare deployment config for D1 database "${databaseName}".`);
