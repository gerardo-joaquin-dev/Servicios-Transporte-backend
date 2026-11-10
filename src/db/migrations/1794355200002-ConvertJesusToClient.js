const { AssignLegacyCompaniesToJesus1794355200001 } = require("./1794355200001-AssignLegacyCompaniesToJesus");

const TARGET_EMAIL = "jesusrv@flotnix.com";

class ConvertJesusToClient1794355200002 {
  name = "ConvertJesusToClient1794355200002";

  async up(queryRunner) {
    const [target] = await queryRunner.query(
      "SELECT id, nombre_completo, rol, tenant_id, cliente_id FROM usuarios WHERE lower(correo) = $1",
      [TARGET_EMAIL],
    );
    if (!target) {
      const [companies] = await queryRunner.query("SELECT count(*)::int AS total FROM clientes");
      if (companies.total)
        console.warn(`Conversión pendiente: crea ${TARGET_EMAIL} y ejecuta npm run db:assign-legacy`);
      return;
    }
    if (target.rol === "ADMINISTRADOR" && !target.tenant_id && !target.cliente_id) {
      const [tenant] = await queryRunner.query(
        "INSERT INTO tenants (nombre, activo, created_at, updated_at) VALUES ($1, true, now(), now()) RETURNING id",
        [target.nombre_completo],
      );
      await queryRunner.query(
        "UPDATE usuarios SET rol = 'CLIENTE', tenant_id = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2",
        [tenant.id, target.id],
      );
    } else if (target.rol !== "CLIENTE" || !target.tenant_id || target.cliente_id) {
      throw new Error(`${TARGET_EMAIL} debe ser administrador de plataforma o usuario tipo CLIENTE`);
    }
    await new AssignLegacyCompaniesToJesus1794355200001().up(queryRunner);
  }

  async down() {
    throw new Error("La conversión del usuario y la propiedad de las empresas requieren una reversión manual");
  }
}

module.exports = { ConvertJesusToClient1794355200002 };
