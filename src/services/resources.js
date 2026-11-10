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
  if (!["ADMINISTRADOR", "CLIENTE"].includes(user.rol)) throw bad("Acceso denegado", 403);
};
const platformOnly = (user) => {
  adminOnly(user);
  if (user.tenant_id)
    throw bad("Acceso reservado al administrador de la plataforma", 403);
};
const tenantAdminOnly = (user) => {
  adminOnly(user);
  if (user.cliente_id) throw bad("Acceso reservado al administrador del cliente", 403);
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
const assertCompanyAccess = async (manager, user, companyId) => {
  if (!Number.isInteger(companyId) || companyId <= 0)
    throw bad("Selecciona una empresa de tu cliente", 403);
  const company = await exists(manager, "clientes", companyId, "Empresa");
  if (user.tenant_id && (company.tenant_id !== user.tenant_id || (user.cliente_id && user.cliente_id !== companyId)))
    throw bad("No tienes acceso a esta empresa", 403);
  return company;
};
const activeOwnedClient = async (manager, user, id) => {
  await assertCompanyAccess(manager, user, id);
  return activeClient(manager, id);
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
  if (!user.tenant_id) return record;
  if (table === "usuarios") {
    if (record.tenant_id !== user.tenant_id || (user.cliente_id && record.cliente_id !== user.cliente_id))
      throw bad("No tienes acceso a este usuario", 403);
    return record;
  }
  await assertCompanyAccess(manager, user, record[ownerField[table]]);
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
    for (const id of input.cliente_ids) await activeOwnedClient(manager, user, id);
    if (user.tenant_id && input.cliente_ids.length !== 1)
      throw bad("Asocia el modo a una empresa del cliente");
    if (user.tenant_id) input.propietario_cliente_id = input.cliente_ids[0];
  }
  if (["choferes", "vehiculos", "zonas", "rutas"].includes(table)) {
    if (user.cliente_id) input.propietario_cliente_id = user.cliente_id;
    if (user.tenant_id && !input.propietario_cliente_id && table !== "rutas")
      throw bad("Selecciona la empresa propietaria");
    if (input.propietario_cliente_id)
      await activeOwnedClient(manager, user, input.propietario_cliente_id);
  }
  if (["pasajeros", "tarifas_cliente"].includes(table)) {
    if (user.cliente_id) input.cliente_id = user.cliente_id;
    if (input.cliente_id) await activeOwnedClient(manager, user, input.cliente_id);
  }
  if (table === "locaciones") {
    if (user.cliente_id) input.cliente_id = user.cliente_id;
    const zone = await exists(manager, "zonas", input.zona_id, "Zona");
    if (user.tenant_id && !input.cliente_id) input.cliente_id = zone.propietario_cliente_id;
    if (user.cliente_id && zone.propietario_cliente_id !== user.cliente_id)
      throw bad("La zona no pertenece a tu empresa");
    if (input.cliente_id && zone.propietario_cliente_id && zone.propietario_cliente_id !== input.cliente_id)
      throw bad("La zona pertenece a otra empresa");
    if (input.cliente_id) await activeOwnedClient(manager, user, input.cliente_id);
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
      if (input.propietario_cliente_id && driver.propietario_cliente_id && driver.propietario_cliente_id !== input.propietario_cliente_id)
        throw bad("El operador pertenece a otra empresa");
    }
  }
  if (table === "rutas") {
    const zone = await exists(manager, "zonas", input.zona_id, "Zona");
    if (user.cliente_id && zone.propietario_cliente_id !== user.cliente_id)
      throw bad("La zona no pertenece a tu empresa");
    if (user.tenant_id && zone.propietario_cliente_id !== input.cliente_ids[0])
      throw bad("La zona no pertenece a la empresa de la ruta");
    for (const id of input.cliente_ids) await activeOwnedClient(manager, user, id);
    if (user.tenant_id && input.cliente_ids.length !== 1)
      throw bad("Asocia la ruta a una empresa del cliente");
    if (user.tenant_id) input.propietario_cliente_id = input.cliente_ids[0];
    if (input.propietario_cliente_id && input.cliente_ids.some((id) => id !== input.propietario_cliente_id))
      throw bad("Una ruta de empresa solo puede asociarse a su propietaria");
    if (input.cliente_ids.length > 1 && zone.propietario_cliente_id)
      throw bad("Una ruta compartida requiere una zona de plataforma");
    if (
      user.cliente_id &&
      input.cliente_ids.some((id) => id !== user.cliente_id)
    )
      throw bad("La ruta sólo puede asociarse a tu empresa");
    for (const id of input.locacion_ids) {
      const location = await exists(manager, "locaciones", id, "Parada");
      if (location.zona_id !== zone.id)
        throw bad("Todas las paradas deben pertenecer a la zona de la ruta");
      if (location.cliente_id && (input.cliente_ids.length !== 1 || location.cliente_id !== input.cliente_ids[0]))
        throw bad("La parada pertenece a otra empresa");
    }
    for (const id of input.pasajero_ids) {
      const passenger = await exists(manager, "pasajeros", id, "Pasajero");
      if (!input.cliente_ids.includes(passenger.cliente_id))
        throw bad("El pasajero no pertenece a las empresas de la ruta");
    }
    if (input.cliente_ids.length > 1 && input.pasajero_ids.length)
      throw bad("Una ruta compartida no puede incluir pasajeros privados");
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
  if (table === "clientes" && !id) tenantAdminOnly(user);
  const current = id ? await checkAccess(manager, table, id, user) : null;
  const schema = resourceSchemas[table];
  if (!schema) throw bad("Recurso desconocido", 404);
  let input = schema.parse(
    table === "clientes" && current ? { ...current, ...raw } : raw,
  );
  if (table === "clientes") {
    if (current && input.tenant_id !== current.tenant_id)
      throw bad("No se puede mover una empresa entre clientes", 403);
    if (user.tenant_id) input.tenant_id = user.tenant_id;
    if (!current && !input.tenant_id) {
      const now = new Date();
      const tenant = await repo(manager, "tenants").save({ nombre: input.razon_social, activo: true, created_at: now, updated_at: now });
      input.tenant_id = tenant.id;
    }
    if (input.tenant_id && user.tenant_id && input.tenant_id !== user.tenant_id)
      throw bad("No tienes acceso a este cliente", 403);
    if (!current && input.tenant_id) {
      const tenant = await requireOne(manager, "tenants", input.tenant_id, "Cliente de plataforma");
      if (!tenant.activo) throw bad("El cliente de plataforma está inactivo");
    }
  }
  if (table === "clientes" && current && user.cliente_id && input.activo !== current.activo)
    throw bad("Solo el administrador maestro puede activar o desactivar clientes", 403);
  if (table === "usuarios") {
    if (current?.rol === "CLIENTE" && user.tenant_id && id !== user.id)
      throw bad("Solo Flotnix puede administrar usuarios tipo cliente", 403);
    if (user.tenant_id) input.tenant_id = user.tenant_id;
    if (input.rol === "CLIENTE" && user.tenant_id && (!current || current.rol !== "CLIENTE"))
      throw bad("Solo Flotnix puede crear usuarios tipo cliente", 403);
    if (current && (current.rol === "CLIENTE" || input.rol === "CLIENTE") &&
        (input.rol !== current.rol || input.tenant_id !== current.tenant_id || input.cliente_id !== current.cliente_id))
      throw bad("El usuario cliente no puede cambiar de tipo ni de espacio", 403);
    if (input.rol === "CLIENTE" && !current && !user.tenant_id) {
      if (input.tenant_id || input.cliente_id)
        throw bad("El usuario cliente se crea sin seleccionar cuenta ni empresa");
      const now = new Date();
      const tenant = await repo(manager, "tenants").save({
        nombre: input.nombre_completo,
        activo: true,
        created_at: now,
        updated_at: now,
      });
      input.tenant_id = tenant.id;
    }
    if (input.rol === "CLIENTE" && (!input.tenant_id || input.cliente_id))
      throw bad("El usuario cliente debe pertenecer a una cuenta, no a una empresa", 403);
    if (user.cliente_id) {
      input.cliente_id = user.cliente_id;
      if (input.rol === "ADMINISTRADOR" || current?.rol === "ADMINISTRADOR")
        throw bad("Solo el administrador del cliente puede crear administradores", 403);
    }
    if (input.cliente_id) {
      const company = await activeOwnedClient(manager, user, input.cliente_id);
      if (!input.tenant_id) input.tenant_id = company.tenant_id;
      if (input.tenant_id !== company.tenant_id) throw bad("El usuario y la empresa deben pertenecer al mismo cliente", 403);
    } else if (user.tenant_id && input.tenant_id !== user.tenant_id) {
      throw bad("No puedes crear administradores de plataforma", 403);
    }
    if (current && id === user.id && (input.tenant_id !== current.tenant_id || input.cliente_id !== current.cliente_id || input.rol !== current.rol))
      throw bad("No puedes cambiar tu propio nivel de acceso", 403);
  } else {
    input = await validateRelations(manager, table, input, user);
  }
  if (table === "choferes" && input.vencimiento_licencia < todayMexico())
    input.estatus = "INACTIVO";
  if (table === "vehiculos" && input.vencimiento_poliza < todayMexico())
    input.estatus = "INACTIVO";
  if (table === "usuarios") {
    if (!id && !input.password)
      throw bad("Captura una contraseña inicial de al menos 12 caracteres");
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
        input.tenant_id !== current.tenant_id ||
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
  if (table === "clientes") tenantAdminOnly(user);
  const record = await checkAccess(manager, table, id, user);
  if (table === "usuarios" && record.rol === "CLIENTE" && user.tenant_id)
    throw bad("Solo Flotnix puede eliminar usuarios tipo cliente", 403);
  if (table === "usuarios" && user.cliente_id && record.rol === "ADMINISTRADOR")
    throw bad("Solo el administrador del cliente puede eliminar administradores", 403);
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
  tenantAdminOnly,
  owner,
  exists,
  activeClient,
  assertCompanyAccess,
  activeOwnedClient,
  linkRows,
  checkAccess,
};
