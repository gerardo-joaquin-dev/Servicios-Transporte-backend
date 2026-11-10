class TenantAccounts1794268800000 {
  name = "TenantAccounts1794268800000";

  async up(queryRunner) {
    await queryRunner.query(`CREATE TABLE tenants (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(255) NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await queryRunner.query("ALTER TABLE clientes ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE RESTRICT");
    await queryRunner.query("ALTER TABLE usuarios ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE RESTRICT");
    // Las empresas anteriores se convierten en cuentas independientes sin mezclar sus datos.
    await queryRunner.query("INSERT INTO tenants (id, nombre, activo) SELECT id, razon_social, activo FROM clientes");
    await queryRunner.query("SELECT setval(pg_get_serial_sequence('tenants', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM tenants), 1), (SELECT COUNT(*) > 0 FROM tenants))");
    await queryRunner.query("UPDATE clientes SET tenant_id = id");
    await queryRunner.query("UPDATE usuarios u SET tenant_id = c.tenant_id FROM clientes c WHERE u.cliente_id = c.id");
    await queryRunner.query("CREATE INDEX ix_clientes_tenant ON clientes (tenant_id)");
    await queryRunner.query("CREATE INDEX ix_usuarios_tenant ON usuarios (tenant_id)");
    await queryRunner.query("ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_tenant_company CHECK (cliente_id IS NULL OR tenant_id IS NOT NULL)");
  }

  async down(queryRunner) {
    await queryRunner.query("ALTER TABLE usuarios DROP CONSTRAINT ck_usuarios_tenant_company");
    await queryRunner.query("DROP INDEX ix_usuarios_tenant");
    await queryRunner.query("DROP INDEX ix_clientes_tenant");
    await queryRunner.query("ALTER TABLE usuarios DROP COLUMN tenant_id");
    await queryRunner.query("ALTER TABLE clientes DROP COLUMN tenant_id");
    await queryRunner.query("DROP TABLE tenants");
  }
}

module.exports = { TenantAccounts1794268800000 };
