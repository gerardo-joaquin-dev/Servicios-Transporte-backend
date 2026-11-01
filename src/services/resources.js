const bcrypt = require("bcryptjs");
const { todayMexico } = require("../utils/date");
const { resourceSchemas } = require("../validation");
const { repo, requireOne, bad } = require("./data");

const ownerField = {
  clientes: "id",
  choferes: "propietario_cliente_id",
  vehiculos: "propietario_cliente_id",
  zonas: "propietario_cliente_id",
  locaciones: "cliente_id",
  pasajeros: "cliente_id",
  rutas: "propietario_cliente_id",
  tarifas_cliente: "cliente_id",
  modos_servicio: "propietario_cliente_id",
  usuarios: "cliente_id",
};
const labels = {
  clientes: "Empresa",
  choferes: "Operador",
  vehiculos: "Unidad",
  zonas: "Zona",
  locaciones: "Parada",
  pasajeros: "Pasajero",
  rutas: "Ruta",
  tarifas_cliente: "Tarifa",
  modos_servicio: "Modo",
  usuarios: "Usuario",
};
const adminOnly = (user) => {
  if (user.rol !== "ADMINISTRADOR") throw bad("Acceso denegado", 403);
};
const platformOnly = (user) => {
  adminOnly(user);
  if (user.cliente_id)
    throw bad("Acceso reservado al administrador de la plataforma", 403);
};
const owner = (user, value) => {
  if (user.cliente_id && value !== user.cliente_id)
    throw bad("No tienes acceso a este registro", 403);
};
const exists = async (manager, table, id, label = "Registro") =>
  requireOne(manager, table, id, label);
const activeClient = async (manager, id) => {
  const client = await exists(manager, "clientes", id, "Empresa");
  if (!client.activo) throw bad("Selecciona una empresa activa");
  return client;
};
const requireIds = async (manager, table, ids) => {
  for (const id of ids) await exists(manager, table, id);
};
const linkRows = async (
  manager,
  table,
  parentKey,
  parentId,
  childKey,
  ids,
  orderKey,
) => {
  await manager.query(`DELETE FROM ${table} WHERE ${parentKey} = $1`, [
    parentId,
  ]);
  for (const [index, id] of ids.entries()) {
    const columns = orderKey
      ? `${parentKey},${childKey},${orderKey}`
      : `${parentKey},${childKey}`;
    const params = orderKey ? "$1,$2,$3" : "$1,$2";
    await manager.query(
      `INSERT INTO ${table} (${columns}) VALUES (${params})`,
      orderKey ? [parentId, id, index] : [parentId, id],
    );
  }
};

async function checkAccess(manager, table, id, user) {
  const record = await exists(manager, table, id, labels[table]);
  if (!user.cliente_id) return record;
  owner(user, record[ownerField[table]]);
  return record;
}

async function validateRelations(manager, table, input, user) {
  if (table === "clientes") return input;
  if (table === "modos_servicio") {
    if (user.cliente_id) {
      input.propietario_cliente_id = user.cliente_id;
      if (input.cliente_ids.some((id) => id !== user.cliente_id))
        throw bad("El modo sólo puede asociarse a tu empresa");
    }
    for (const id of input.cliente_ids) await activeClient(manager, id);
  }
  if (["choferes", "vehiculos", "zonas", "rutas"].includes(table)) {
    if (user.cliente_id) input.propietario_cliente_id = user.cliente_id;
    if (input.propietario_cliente_id)
      await activeClient(manager, input.propietario_cliente_id);
  }
  if (["pasajeros", "tarifas_cliente", "usuarios"].includes(table)) {
    if (user.cliente_id) input.cliente_id = user.cliente_id;
    if (input.cliente_id) await activeClient(manager, input.cliente_id);
  }
  if (table === "locaciones") {
    if (user.cliente_id) input.cliente_id = user.cliente_id;
    const zone = await exists(manager, "zonas", input.zona_id, "Zona");
    if (user.cliente_id && zone.propietario_cliente_id !== user.cliente_id)
      throw bad("La zona no pertenece a tu empresa");
    if (input.cliente_id) await activeClient(manager, input.cliente_id);
  }
  if (table === "vehiculos") {
    const type = await repo(manager, "tipos_unidad").findOneBy({
      nombre: input.tipo,
    });
    if (!type) throw bad("Selecciona un tipo de unidad del diccionario");
    if (input.chofer_predeterminado_id) {
      const driver = await exists(
        manager,
        "choferes",
        input.chofer_predeterminado_id,
        "Operador",
      );
      if (user.cliente_id && driver.propietario_cliente_id !== user.cliente_id)
        throw bad("El operador no pertenece a tu empresa");
    }
  }
  if (table === "rutas") {
    const zone = await exists(manager, "zonas", input.zona_id, "Zona");
    if (user.cliente_id && zone.propietario_cliente_id !== user.cliente_id)
      throw bad("La zona no pertenece a tu empresa");
    for (const id of input.cliente_ids) await activeClient(manager, id);
    if (
      user.cliente_id &&
      input.cliente_ids.some((id) => id !== user.cliente_id)
    )
      throw bad("La ruta sólo puede asociarse a tu empresa");
    for (const id of input.locacion_ids) {
      const location = await exists(manager, "locaciones", id, "Parada");
      if (location.zona_id !== zone.id)
        throw bad("Todas las paradas deben pertenecer a la zona de la ruta");
    }
    for (const id of input.pasajero_ids) {
      const passenger = await exists(manager, "pasajeros", id, "Pasajero");
      if (!input.cliente_ids.includes(passenger.cliente_id))
        throw bad("El pasajero no pertenece a las empresas de la ruta");
    }
    await requireIds(manager, "modos_servicio", input.modo_servicio_ids);
    for (const modeId of input.modo_servicio_ids) {
      const linked = await manager.query(
        "SELECT 1 FROM modo_clientes WHERE modo_id=$1 AND cliente_id=ANY($2::integer[]) LIMIT 1",
        [modeId, input.cliente_ids],
      );
      if (!linked.length)
        throw bad("El modo no corresponde a las empresas de la ruta");
    }
    if (user.cliente_id) {
      for (const stopId of input.locacion_ids) {
        const stop = await exists(manager, "locaciones", stopId, "Parada");
        if (stop.cliente_id && stop.cliente_id !== user.cliente_id)
          throw bad("La parada no pertenece a tu empresa");
      }
    }
    input.zona = zone.nombre;
  }
  if (table === "tarifas_cliente") {
    const listedAmount =
      input.tipo_cobro === "FIJO"
        ? input.tarifa_base
        : input.tipo_cobro === "POR_KILOMETRO"
          ? input.costo_por_kilometro
          : input.costo_por_pasajero;
    if (Math.abs(input.importe - listedAmount) > 0.01)
      throw bad("El importe debe coincidir con el tipo de cobro seleccionado");
    const route = await exists(manager, "rutas", input.ruta_id, "Ruta");
    if (route.zona_id !== input.zona_id)
      throw bad("La ruta no corresponde a la zona");
    const links = await manager.query(
      "SELECT 1 FROM ruta_clientes WHERE ruta_id=$1 AND cliente_id=$2",
      [route.id, input.cliente_id],
    );
    if (!links.length) throw bad("La ruta no corresponde a la empresa");
  }
  return input;
}

async function saveResource(manager, table, raw, id, user) {
  adminOnly(user);
  if (table === "clientes" && !id) platformOnly(user);
  if (table === "clientes" && id && user.cliente_id && id !== user.cliente_id)
    throw bad("Acceso denegado", 403);
  const current = id ? await checkAccess(manager, table, id, user) : null;
  const schema = resourceSchemas[table];
  if (!schema) throw bad("Recurso desconocido", 404);
  let input = schema.parse(
    table === "clientes" && current ? { ...current, ...raw } : raw,
  );
  input = await validateRelations(manager, table, input, user);
  if (table === "choferes" && input.vencimiento_licencia < todayMexico())
    input.estatus = "INACTIVO";
  if (table === "vehiculos" && input.vencimiento_poliza < todayMexico())
    input.estatus = "INACTIVO";
  if (table === "usuarios") {
    if (!id && !input.password)
      throw bad("Captura una contraseña inicial de al menos 12 caracteres");
    if (id && user.cliente_id && current.cliente_id !== user.cliente_id)
      throw bad("Acceso denegado", 403);
    if (id && id === user.id && !input.activo)
      throw bad("No puedes desactivar tu propia cuenta");
    const password_hash = input.password
      ? await bcrypt.hash(input.password, 12)
      : current?.password_hash;
    const revoke =
      current &&
      (input.password ||
        !input.activo ||
        input.rol !== current.rol ||
        input.cliente_id !== current.cliente_id ||
        input.correo !== current.correo);
    const token_version = current
      ? current.token_version + (revoke ? 1 : 0)
      : 0;
    delete input.password;
    input = {
      ...input,
      password_hash,
      token_version,
      created_at: current?.created_at || new Date(),
    };
  }
  if (table === "clientes") {
    const now = new Date();
    input = {
      ...input,
      created_at: current?.created_at || now,
      updated_at: now,
    };
  }
  if (table === "tarifas_cliente") {
    const now = new Date();
    input = {
      ...input,
      created_at: current?.created_at || now,
      updated_at: now,
    };
  }
  const {
    locacion_ids,
    pasajero_ids,
    cliente_ids,
    modo_servicio_ids,
    ...record
  } = input;
  const saved = await repo(manager, table).save(
    id ? { ...current, ...record, id } : record,
  );
  if (table === "rutas") {
    await linkRows(
      manager,
      "ruta_locaciones",
      "ruta_id",
      saved.id,
      "locacion_id",
      locacion_ids,
      "orden",
    );
    await linkRows(
      manager,
      "ruta_pasajeros",
      "ruta_id",
      saved.id,
      "pasajero_id",
      pasajero_ids,
    );
    await linkRows(
      manager,
      "ruta_clientes",
      "ruta_id",
      saved.id,
      "cliente_id",
      cliente_ids,
    );
    await linkRows(
      manager,
      "ruta_modos",
      "ruta_id",
      saved.id,
      "modo_id",
      modo_servicio_ids,
    );
  }
  if (table === "modos_servicio")
    await linkRows(
      manager,
      "modo_clientes",
      "modo_id",
      saved.id,
      "cliente_id",
      cliente_ids,
    );
  if (table === "usuarios") {
    const { password_hash, token_version, created_at, ...safe } = saved;
    return safe;
  }
  return saved;
}

async function deleteResource(manager, table, id, user) {
  adminOnly(user);
  if (table === "clientes") platformOnly(user);
  await checkAccess(manager, table, id, user);
  if (table === "usuarios" && id === user.id)
    throw bad("No puedes eliminar tu propia cuenta");
  await repo(manager, table).delete(id);
}

async function saveVehicleTypes(manager, types, user) {
  platformOnly(user);
  if (
    !Array.isArray(types) ||
    types.some(
      (type) => typeof type !== "string" || !type.trim() || type.length > 255,
    )
  )
    throw bad("Tipos de unidad inválidos");
  const normalized = types.map((type) => type.trim());
  if (
    new Set(normalized.map((type) => type.toLocaleLowerCase("es-MX"))).size !==
    normalized.length
  )
    throw bad("Los tipos deben ser únicos");
  const old = await repo(manager, "tipos_unidad").find();
  for (const type of old)
    if (!normalized.includes(type.nombre))
      await repo(manager, "tipos_unidad").delete(type.id);
  for (const nombre of normalized)
    if (!old.some((type) => type.nombre === nombre))
      await repo(manager, "tipos_unidad").save({ nombre });
}

module.exports = {
  saveResource,
  deleteResource,
  saveVehicleTypes,
  adminOnly,
  platformOnly,
  owner,
  exists,
  activeClient,
  linkRows,
  checkAccess,
};
