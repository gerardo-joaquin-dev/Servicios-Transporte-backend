const { dataSource } = require("../src/db/data-source");
const { AssignLegacyCompaniesToJesus1794355200001 } = require("../src/db/migrations/1794355200001-AssignLegacyCompaniesToJesus");

async function assignLegacyCompanies() {
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: "all" });
    const [target] = await dataSource.query(
      "SELECT tenant_id, rol FROM usuarios WHERE lower(correo) = $1",
      ["jesusrv@flotnix.com"],
    );
    if (!target || target.rol !== "CLIENTE" || !target.tenant_id)
      throw new Error("Primero debe existir jesusrv@flotnix.com como usuario tipo CLIENTE");
    await dataSource.transaction(async (manager) => {
      await new AssignLegacyCompaniesToJesus1794355200001().up(manager.queryRunner);
    });
    const [result] = await dataSource.query(
      "SELECT count(*)::int AS total FROM migration_jesusrv_company_assignments",
    );
    console.log(`${result.total} empresas heredadas asignadas a jesusrv@flotnix.com`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module)
  assignLegacyCompanies().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { assignLegacyCompanies };
