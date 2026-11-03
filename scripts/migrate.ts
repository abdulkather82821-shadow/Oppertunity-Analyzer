import { getDriver, resetDriver } from '../src/lib/db';
import { runMigrations } from '../src/lib/db/migrate';

async function main() {
  const driver = getDriver();
  const result = await runMigrations(driver);
  console.log(`[db] dialect=${driver.dialect} migration=${result.id} applied=${result.applied}`);
  await resetDriver();
}

main().catch((err) => {
  console.error('[db] migration failed:', err);
  process.exit(1);
});
