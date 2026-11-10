const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { repo, requireOne, bad } = require("./data");
const { platformOnly } = require("./resources");

const createSchema = z.object({
  nombre: z.string().trim().min(1).max(255),
  admin: z.object({
    nombre_completo: z.string().trim().min(1).max(255),
    correo: z.email().max(255).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
  }),
});
const updateSchema = z.object({
  nombre: z.string().trim().min(1).max(255).optional(),
  activo: z.boolean().optional(),
}).refine((value) => value.nombre !== undefined || value.activo !== undefined);

async function createTenant(manager, raw, user) {
  platformOnly(user);
  const input = createSchema.parse(raw);
  const now = new Date();
  const tenant = await repo(manager, "tenants").save({ nombre: input.nombre, activo: true, created_at: now, updated_at: now });
  const admin = await repo(manager, "usuarios").save({
    tenant_id: tenant.id,
    cliente_id: null,
    nombre_completo: input.admin.nombre_completo,
    correo: input.admin.correo,
    rol: "CLIENTE",
    activo: true,
    password_hash: await bcrypt.hash(input.admin.password, 12),
    token_version: 0,
    created_at: now,
  });
  return { tenant, admin: { id: admin.id, tenant_id: tenant.id, cliente_id: null, nombre_completo: admin.nombre_completo, correo: admin.correo, rol: admin.rol, activo: admin.activo } };
}

async function updateTenant(manager, id, raw, user) {
  platformOnly(user);
  if (!Number.isInteger(id) || id <= 0) throw bad("Cliente no encontrado", 404);
  const tenant = await requireOne(manager, "tenants", id, "Cliente de plataforma");
  const input = updateSchema.parse(raw);
  return repo(manager, "tenants").save({ ...tenant, ...input, updated_at: new Date() });
}

module.exports = { createTenant, updateTenant };
