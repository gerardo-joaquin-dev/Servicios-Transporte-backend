const { Client } = require("pg");
const { required } = require("../src/config");

async function createDatabase() {
  const target = new URL(required("DATABASE_URL"));
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name))
    throw new Error("Nombre de base de datos inválido");
  const check = new Client({ connectionString: target.toString() });
  let connected = false;
  try {
    await check.connect();
    connected = true;
    console.log(`La base ${name} ya existe`);
    return;
  } catch (error) {
    if (error.code !== "3D000") throw error;
  } finally {
    if (connected) await check.end();
  }
  const adminUrl =
    process.env.DB_ADMIN_URL || new URL("/postgres", target).toString();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`Base ${name} creada`);
  } catch (error) {
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }
}

if (require.main === module)
  createDatabase().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { createDatabase };
