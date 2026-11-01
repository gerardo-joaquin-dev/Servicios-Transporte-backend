const { dataSource } = require("../src/db/data-source");

async function migrate() {
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: "all" });
    console.log(`${applied.length} migraciones aplicadas`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module)
  migrate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { migrate };
