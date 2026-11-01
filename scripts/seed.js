const bcrypt = require("bcryptjs");
const { dataSource } = require("../src/db/data-source");
const { required } = require("../src/config");

async function seed() {
  const email = required("ADMIN_EMAIL").trim().toLowerCase();
  const password = required("ADMIN_PASSWORD");
  if (password.length < 12)
    throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres");
  const ownsConnection = !dataSource.isInitialized;
  if (ownsConnection) await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      for (const nombre of ["Van", "Autobús", "Automóvil"]) {
        await manager.query(
          "INSERT INTO tipos_unidad (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING",
          [nombre],
        );
      }
      const existing = await manager.query(
        "SELECT id FROM usuarios WHERE lower(correo) = $1",
        [email],
      );
      if (!existing.length) {
        await manager.query(
          "INSERT INTO usuarios (cliente_id,nombre_completo,correo,rol,activo,password_hash) VALUES (NULL,$1,$2,'ADMINISTRADOR',true,$3)",
          [
            process.env.ADMIN_NAME || "Administrador Flotnix",
            email,
            await bcrypt.hash(password, 12),
          ],
        );
        console.log(`Administrador ${email} creado`);
      } else {
        console.log(`Administrador ${email} ya existe; contraseña conservada`);
      }
    });
  } finally {
    if (ownsConnection) await dataSource.destroy();
  }
}

if (require.main === module)
  seed().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { seed };
