const { schemas } = require("../db/schemas");
const { todayMexico } = require("../utils/date");

const moneyColumns = {
  rutas: ["kilometros_estimados"],
  tarifas_cliente: [
    "importe",
    "tarifa_base",
    "costo_por_kilometro",
    "costo_por_pasajero",
    "pago_operador",
  ],
  servicios: ["km_recorridos", "importe_cliente", "importe_operador"],
  facturas: ["total"],
};
const repo = (manager, table) => manager.getRepository(schemas[table]);
const one = async (manager, table, id) =>
  repo(manager, table).findOneBy({ id });
const requireOne = async (manager, table, id, label = "Registro") => {
  const value = await one(manager, table, id);
  if (!value) throw bad(`${label} no encontrado`, 404);
  return value;
};
const bad = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const numeric = (rows, table) =>
  rows.map((row) => {
    const result = { ...row };
    for (const field of moneyColumns[table] || [])
      result[field] = Number(result[field]);
    return result;
  });
const pairs = async (manager, table) => manager.query(`SELECT * FROM ${table}`);
const valuesFor = (rows, parent, child, parentId) =>
  rows.filter((row) => row[parent] === parentId).map((row) => row[child]);

async function getData(manager) {
  const tables = [
    "tenants",
    "clientes",
    "usuarios",
    "choferes",
    "vehiculos",
    "zonas",
    "locaciones",
    "pasajeros",
    "rutas",
    "tarifas_cliente",
    "modos_servicio",
    "servicios",
    "consolidaciones",
    "facturas",
    "envios_ruta",
  ];
  const data = {};
  for (const table of tables)
    data[table] = numeric(
      await repo(manager, table).find({ order: { id: "DESC" } }),
      table,
    );
  const today = todayMexico();
  data.choferes = data.choferes.map((driver) =>
    driver.vencimiento_licencia < today
      ? { ...driver, estatus: "INACTIVO" }
      : driver,
  );
  data.vehiculos = data.vehiculos.map((vehicle) =>
    vehicle.vencimiento_poliza < today
      ? { ...vehicle, estatus: "INACTIVO" }
      : vehicle,
  );
  data.usuarios = data.usuarios.map(
    ({ password_hash, token_version, created_at, ...user }) => user,
  );
  data.tipos_unidad = (
    await repo(manager, "tipos_unidad").find({ order: { id: "ASC" } })
  ).map((row) => row.nombre);
  data.diccionarios = await repo(manager, "diccionarios").find({ order: { id: "ASC" } });
  data.servicio_auditoria = await manager.query("SELECT * FROM servicio_auditoria ORDER BY fecha DESC, id DESC");
  const [
    routeStops,
    routePassengers,
    routeClients,
    routeModes,
    modeClients,
    servicePassengers,
    consolidationServices,
    invoiceServices,
  ] = await Promise.all([
    pairs(manager, "ruta_locaciones"),
    pairs(manager, "ruta_pasajeros"),
    pairs(manager, "ruta_clientes"),
    pairs(manager, "ruta_modos"),
    pairs(manager, "modo_clientes"),
    pairs(manager, "servicio_pasajeros"),
    pairs(manager, "consolidacion_servicios"),
    pairs(manager, "factura_servicios"),
  ]);
  for (const route of data.rutas) {
    route.locacion_ids = routeStops
      .filter((row) => row.ruta_id === route.id)
      .sort((a, b) => a.orden - b.orden)
      .map((row) => row.locacion_id);
    route.paradas = route.locacion_ids.map(
      (id) =>
        data.locaciones.find((location) => location.id === id)?.nombre || "",
    );
    route.pasajero_ids = valuesFor(
      routePassengers,
      "ruta_id",
      "pasajero_id",
      route.id,
    );
    route.cliente_ids = valuesFor(
      routeClients,
      "ruta_id",
      "cliente_id",
      route.id,
    );
    route.modo_servicio_ids = valuesFor(
      routeModes,
      "ruta_id",
      "modo_id",
      route.id,
    );
  }
  for (const mode of data.modos_servicio)
    mode.cliente_ids = valuesFor(modeClients, "modo_id", "cliente_id", mode.id);
  for (const service of data.servicios) {
    service.pasajero_ids = valuesFor(
      servicePassengers,
      "servicio_id",
      "pasajero_id",
      service.id,
    );
    service.programado_por_nombre = data.usuarios.find((user) => user.id === service.programado_por_id)?.nombre_completo ?? null;
  }
  for (const consolidation of data.consolidaciones) {
    consolidation.servicio_ids = valuesFor(
      consolidationServices,
      "consolidacion_id",
      "servicio_id",
      consolidation.id,
    );
    consolidation.servicio_ids_aprobados = consolidationServices
      .filter(
        (row) => row.consolidacion_id === consolidation.id && row.aprobado,
      )
      .map((row) => row.servicio_id);
  }
  for (const invoice of data.facturas) {
    invoice.servicio_ids = valuesFor(
      invoiceServices,
      "factura_id",
      "servicio_id",
      invoice.id,
    );
    invoice.servicio_ids_pagados = invoiceServices
      .filter((row) => row.factura_id === invoice.id && row.pagado)
      .map((row) => row.servicio_id);
  }
  return data;
}

function scopeData(data, user) {
  if (!user.tenant_id) return data;
  const companies = data.clientes.filter((company) =>
    company.tenant_id === user.tenant_id &&
    (!user.cliente_id || company.id === user.cliente_id),
  );
  const companyIds = new Set(companies.map((company) => company.id));
  const services = data.servicios.filter((item) => companyIds.has(item.cliente_id));
  const rates = data.tarifas_cliente.filter((item) => companyIds.has(item.cliente_id));
  const routes = data.rutas.filter((item) =>
    (item.propietario_cliente_id == null || companyIds.has(item.propietario_cliente_id)) &&
    item.cliente_ids.some((id) => companyIds.has(id)),
  );
  const zoneIds = new Set(routes.map((item) => item.zona_id));
  const stopIds = new Set(routes.flatMap((item) => item.locacion_ids));
  const driverIds = new Set(services.map((item) => item.chofer_id));
  const vehicleIds = new Set(services.map((item) => item.vehiculo_id));
  const modes = data.modos_servicio.filter((item) =>
    (item.propietario_cliente_id == null || companyIds.has(item.propietario_cliente_id)) &&
    item.cliente_ids.some((id) => companyIds.has(id)),
  );
  const modeIds = new Set(modes.map((item) => item.id));
  const admin = user.rol === "ADMINISTRADOR" || user.rol === "CLIENTE";
  return {
    ...data,
    tenants: data.tenants.filter((item) => item.id === user.tenant_id),
    clientes: companies,
    usuarios: admin ? data.usuarios.filter((item) =>
      item.tenant_id === user.tenant_id &&
      (!user.cliente_id || item.cliente_id === user.cliente_id),
    ) : [],
    pasajeros: data.pasajeros.filter((item) => companyIds.has(item.cliente_id)),
    servicios: admin ? services : services.map(({ tarifa_id, importe_cliente, importe_operador, ...item }) => item),
    servicio_auditoria: admin ? data.servicio_auditoria.filter((item) => companyIds.has(item.cliente_id)) : [],
    rutas: routes.map((route) => ({
      ...route,
      cliente_ids: route.cliente_ids.filter((id) => companyIds.has(id)),
      pasajero_ids: route.pasajero_ids.filter((id) =>
        data.pasajeros.some((person) => person.id === id && companyIds.has(person.cliente_id)),
      ),
      modo_servicio_ids: route.modo_servicio_ids.filter((id) => modeIds.has(id)),
    })),
    zonas: data.zonas.filter((item) =>
      (item.propietario_cliente_id == null || companyIds.has(item.propietario_cliente_id)) &&
      (companyIds.has(item.propietario_cliente_id) || zoneIds.has(item.id)),
    ),
    locaciones: data.locaciones.filter((item) =>
      (item.cliente_id == null || companyIds.has(item.cliente_id)) &&
      (companyIds.has(item.cliente_id) || stopIds.has(item.id)),
    ),
    choferes: data.choferes.filter((item) =>
      (item.propietario_cliente_id == null || companyIds.has(item.propietario_cliente_id)) &&
      (companyIds.has(item.propietario_cliente_id) || driverIds.has(item.id)),
    ),
    vehiculos: data.vehiculos.filter((item) =>
      (item.propietario_cliente_id == null || companyIds.has(item.propietario_cliente_id)) &&
      (companyIds.has(item.propietario_cliente_id) || vehicleIds.has(item.id)),
    ),
    tarifas_cliente: admin ? rates : [],
    modos_servicio: modes.map((item) => ({
      ...item, cliente_ids: item.cliente_ids.filter((id) => companyIds.has(id)),
    })),
    facturas: admin ? data.facturas.filter((item) => companyIds.has(item.cliente_id)) : [],
    consolidaciones: admin ? data.consolidaciones.filter((item) => companyIds.has(item.cliente_id)) : [],
    envios_ruta: data.envios_ruta.filter((item) =>
      services.some((service) => service.id === item.servicio_id),
    ),
  };
}

module.exports = { repo, one, requireOne, bad, getData, scopeData };
