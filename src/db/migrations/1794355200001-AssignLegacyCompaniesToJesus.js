const TARGET_EMAIL = "jesusrv@flotnix.com";

class AssignLegacyCompaniesToJesus1794355200001 {
  name = "AssignLegacyCompaniesToJesus1794355200001";

  async up(queryRunner) {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS migration_jesusrv_company_assignments (
      cliente_id INTEGER PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
      previous_tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      target_tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
    )`);
    const [pending] = await queryRunner.query(`SELECT count(*)::int AS total FROM clientes c
      WHERE c.tenant_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM usuarios owner
        WHERE owner.tenant_id = c.tenant_id AND owner.rol = 'CLIENTE'
      )`);
    if (!pending.total) return;
    const [target] = await queryRunner.query(
      "SELECT id, tenant_id, rol FROM usuarios WHERE lower(correo) = $1",
      [TARGET_EMAIL],
    );
    if (!target || target.rol !== "CLIENTE" || !target.tenant_id) {
      console.warn(`Asignación de empresas pendiente: crea primero el usuario tipo cliente ${TARGET_EMAIL} y ejecuta npm run db:assign-legacy`);
      return;
    }
    await queryRunner.query(`INSERT INTO migration_jesusrv_company_assignments (cliente_id, previous_tenant_id, target_tenant_id)
      SELECT c.id, c.tenant_id, $1
      FROM clientes c
      WHERE c.tenant_id IS NOT NULL AND c.tenant_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM usuarios owner
          WHERE owner.tenant_id = c.tenant_id AND owner.rol = 'CLIENTE'
        )
      ON CONFLICT (cliente_id) DO NOTHING`, [target.tenant_id]);
    await queryRunner.query(`UPDATE clientes c SET tenant_id = m.target_tenant_id
      FROM migration_jesusrv_company_assignments m
      WHERE c.id = m.cliente_id AND c.tenant_id = m.previous_tenant_id`);
    await queryRunner.query(`UPDATE usuarios u SET tenant_id = m.target_tenant_id
      FROM migration_jesusrv_company_assignments m
      WHERE u.cliente_id = m.cliente_id AND u.tenant_id <> m.target_tenant_id`);
  }

  async down(queryRunner) {
    await queryRunner.query(`UPDATE usuarios u SET tenant_id = m.previous_tenant_id
      FROM migration_jesusrv_company_assignments m
      WHERE u.cliente_id = m.cliente_id AND u.tenant_id = m.target_tenant_id`);
    await queryRunner.query(`UPDATE clientes c SET tenant_id = m.previous_tenant_id
      FROM migration_jesusrv_company_assignments m
      WHERE c.id = m.cliente_id AND c.tenant_id = m.target_tenant_id`);
    await queryRunner.query("DROP TABLE IF EXISTS migration_jesusrv_company_assignments");
  }
}

module.exports = { AssignLegacyCompaniesToJesus1794355200001 };
