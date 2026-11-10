class ClientUserRole1794355200000 {
  name = "ClientUserRole1794355200000";

  async up(queryRunner) {
    await queryRunner.query("ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check");
    await queryRunner.query("ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_check");
    await queryRunner.query("ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN ('ADMINISTRADOR','CLIENTE','PROGRAMADOR_DESPACHADOR'))");
    await queryRunner.query("ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_cliente_scope CHECK (rol <> 'CLIENTE' OR (tenant_id IS NOT NULL AND cliente_id IS NULL))");
    await queryRunner.query("ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_despachador_empresa CHECK (rol <> 'PROGRAMADOR_DESPACHADOR' OR cliente_id IS NOT NULL)");
    await queryRunner.query(`UPDATE usuarios SET rol = 'CLIENTE' WHERE id IN (
      SELECT DISTINCT ON (tenant_id) id FROM usuarios
      WHERE tenant_id IS NOT NULL AND cliente_id IS NULL AND rol = 'ADMINISTRADOR'
      ORDER BY tenant_id, created_at, id
    )`);
  }

  async down(queryRunner) {
    await queryRunner.query("UPDATE usuarios SET rol = 'ADMINISTRADOR' WHERE rol = 'CLIENTE'");
    await queryRunner.query("ALTER TABLE usuarios DROP CONSTRAINT ck_usuarios_despachador_empresa");
    await queryRunner.query("ALTER TABLE usuarios DROP CONSTRAINT ck_usuarios_cliente_scope");
    await queryRunner.query("ALTER TABLE usuarios DROP CONSTRAINT ck_usuarios_rol");
    await queryRunner.query("ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('ADMINISTRADOR','PROGRAMADOR_DESPACHADOR'))");
    await queryRunner.query("ALTER TABLE usuarios ADD CONSTRAINT usuarios_check CHECK (cliente_id IS NOT NULL OR rol = 'ADMINISTRADOR')");
  }
}

module.exports = { ClientUserRole1794355200000 };
