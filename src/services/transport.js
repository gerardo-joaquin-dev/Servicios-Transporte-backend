const { randomUUID } = require("node:crypto");
const { todayMexico } = require("../utils/date");
const { repo, requireOne, bad } = require("./data");
const {
  adminOnly,
  assertCompanyAccess,
  activeClient,
  linkRows,
} = require("./resources");
const { service: serviceSchema, z } = require("../validation");

const serviceAccess = async (manager, id, user) => {
  const service = await requireOne(manager, "servicios", id, "Servicio");
  await assertCompanyAccess(manager, user, service.cliente_id);
  return service;
};
const auditActor = (manager, user) =>
  manager.query("SELECT set_config('app.user_id', $1, true)", [String(user.id)]);
const uniqueIds = (ids) =>
  Array.isArray(ids) &&
  ids.length > 0 &&
  ids.every((id) => Number.isInteger(id) && id > 0) &&
  new Set(ids).size === ids.length;
const requireIds = (ids) => {
  if (!uniqueIds(ids)) throw bad("Selecciona servicios válidos sin repetir");
};

async function validateService(manager, input, user, currentId) {
  await assertCompanyAccess(manager, user, input.cliente_id);
  await activeClient(manager, input.cliente_id);
  const route = await requireOne(manager, "rutas", input.ruta_id, "Ruta");
  if (!route.activo) throw bad("Selecciona una ruta activa");
  if (route.propietario_cliente_id && route.propietario_cliente_id !== input.cliente_id)
    throw bad("La ruta pertenece a otra empresa");
  const zone = await requireOne(manager, "zonas", route.zona_id, "Zona");
  if (zone.propietario_cliente_id && zone.propietario_cliente_id !== input.cliente_id)
    throw bad("La zona pertenece a otra empresa");
  const routeClient = await manager.query(
    "SELECT 1 FROM ruta_clientes WHERE ruta_id=$1 AND cliente_id=$2",
    [route.id, input.cliente_id],
  );
  if (!routeClient.length)
    throw bad("La ruta no está disponible para esta empresa");
  let rate = null;
  if (input.tarifa_id) {
    rate = await requireOne(
      manager,
      "tarifas_cliente",
      input.tarifa_id,
      "Tarifa",
    );
    if (
      !rate.activo ||
      rate.cliente_id !== input.cliente_id ||
      rate.ruta_id !== route.id
    )
      throw bad("La tarifa no corresponde a la empresa y ruta");
  }
  if (input.modo_servicio_id) {
    const mode = await requireOne(
      manager,
      "modos_servicio",
      input.modo_servicio_id,
      "Modo",
    );
    const link = await manager.query(
      "SELECT 1 FROM modo_clientes WHERE modo_id=$1 AND cliente_id=$2",
      [mode.id, input.cliente_id],
    );
    if (!mode.activo || !link.length)
      throw bad("El modo de servicio no corresponde a la empresa");
    const routeModes = await manager.query(
      "SELECT modo_id FROM ruta_modos WHERE ruta_id=$1",
      [route.id],
    );
    if (
      routeModes.length &&
      !routeModes.some((item) => item.modo_id === mode.id)
    )
      throw bad("El modo no está disponible para la ruta");
  }
  const driver = await requireOne(
    manager,
    "choferes",
    input.chofer_id,
    "Operador",
  );
  const vehicle = await requireOne(
    manager,
    "vehiculos",
    input.vehiculo_id,
    "Unidad",
  );
  if (
    driver.estatus !== "ACTIVO" ||
    vehicle.estatus !== "ACTIVO" ||
    driver.vencimiento_licencia < todayMexico() ||
    vehicle.vencimiento_poliza < todayMexico()
  )
    throw bad("Selecciona un operador y una unidad activos y vigentes");
  if ((driver.propietario_cliente_id && driver.propietario_cliente_id !== input.cliente_id) ||
      (vehicle.propietario_cliente_id && vehicle.propietario_cliente_id !== input.cliente_id))
    throw bad("El operador y la unidad no corresponden a esta empresa");
  if (
    user.cliente_id &&
    (driver.propietario_cliente_id !== user.cliente_id ||
      vehicle.propietario_cliente_id !== user.cliente_id)
  )
    throw bad("El operador y la unidad deben pertenecer a tu empresa");
  if (input.cantidad_pasajeros > vehicle.capacidad)
    throw bad(
      `La unidad sólo tiene capacidad para ${vehicle.capacidad} pasajeros`,
    );
  if (
    input.pasajero_ids.length &&
    input.pasajero_ids.length !== input.cantidad_pasajeros
  )
    throw bad("La cantidad de pasajeros no coincide con la selección");
  if (rate?.tipo_cobro === "POR_PASAJERO" && input.cantidad_pasajeros === 0)
    throw bad("Selecciona al menos un pasajero para esta tarifa");
  for (const id of input.pasajero_ids) {
    const passenger = await requireOne(manager, "pasajeros", id, "Pasajero");
    if (!passenger.activo || passenger.cliente_id !== input.cliente_id)
      throw bad("El pasajero no corresponde a la empresa");
  }
  await manager.query("SELECT id FROM choferes WHERE id=$1 FOR UPDATE", [
    driver.id,
  ]);
  await manager.query("SELECT id FROM vehiculos WHERE id=$1 FOR UPDATE", [
    vehicle.id,
  ]);
  const conflict = await manager.query(
    `SELECT codigo FROM servicios WHERE id <> $1 AND estatus_operativo <> 'CANCELADO' AND fecha_hora_programada > $2::timestamptz - interval '1 hour' AND fecha_hora_programada < $2::timestamptz + interval '1 hour' AND (chofer_id=$3 OR vehiculo_id=$4) LIMIT 1`,
    [currentId || 0, input.fecha_hora_programada, driver.id, vehicle.id],
  );
  if (conflict.length)
    throw bad(
      `El operador o la unidad ya están asignados cerca del horario (${conflict[0].codigo})`,
    );
  return { route, rate };
}

async function saveService(manager, raw, id, user) {
  await auditActor(manager, user);
  const current = id ? await serviceAccess(manager, id, user) : null;
  if (current && current.estatus_administrativo !== "ABIERTO")
    throw bad("No se puede editar un servicio en proceso administrativo");
  const previousPassengers = current
    ? (
        await manager.query(
          "SELECT pasajero_id FROM servicio_pasajeros WHERE servicio_id=$1",
          [id],
        )
      ).map((item) => item.pasajero_id)
    : [];
  const input = serviceSchema.parse(
    current
      ? {
          ...current,
          importe_cliente: Number(current.importe_cliente),
          importe_operador: Number(current.importe_operador),
          pasajero_ids: previousPassengers,
          ...raw,
          fecha_hora_programada: new Date(
            raw.fecha_hora_programada || current.fecha_hora_programada,
          ).toISOString(),
        }
      : raw,
  );
  input.estatus_operativo = current?.estatus_operativo || "PROGRAMADO";
  if (user.rol !== "ADMINISTRADOR") {
    const rates = await repo(manager, "tarifas_cliente").find({
      where: { cliente_id: input.cliente_id, ruta_id: input.ruta_id, activo: true },
      order: { vigente_desde: "DESC", id: "DESC" },
    });
    const selected = rates.find((item) => item.id === current?.tarifa_id) || rates[0];
    if (!selected) throw bad("No hay una tarifa activa para esta ruta");
    input.tarifa_id = selected.id;
  }
  const { route, rate } = await validateService(manager, input, user, id);
  if (!current && !rate) throw bad("Selecciona una tarifa configurada");
  const pricingChanged =
    !current ||
    current.tarifa_id !== input.tarifa_id ||
    current.ruta_id !== input.ruta_id ||
    current.cantidad_pasajeros !== input.cantidad_pasajeros;
  if (pricingChanged && !rate) throw bad("Selecciona una tarifa configurada");
  if (pricingChanged && rate) {
    const base = Number(rate.tarifa_base);
    const amount =
      rate.tipo_cobro === "POR_KILOMETRO"
        ? base +
          Number(rate.costo_por_kilometro) * Number(route.kilometros_estimados)
        : rate.tipo_cobro === "POR_PASAJERO"
          ? Number(rate.costo_por_pasajero) * input.cantidad_pasajeros
          : base;
    input.importe_cliente = Math.round(amount * 100) / 100;
    input.importe_operador = Number(rate.pago_operador);
  } else if (current) {
    input.importe_cliente = Number(current.importe_cliente);
    input.importe_operador = Number(current.importe_operador);
  }
  const { pasajero_ids, ...fields } = input;
  const record = current
    ? { ...current, ...fields }
    : {
        ...fields,
        estatus_operativo: "PROGRAMADO",
        codigo: `TMP-${randomUUID()}`,
        programado_por_id: user.id,
        estatus_administrativo: "ABIERTO",
        estatus_pago_operador: "PENDIENTE",
        fecha_pago_operador: null,
        km_recorridos: route.kilometros_estimados,
      };
  const saved = await repo(manager, "servicios").save(record);
  if (!current) {
    saved.codigo = `SERV-${new Date().getFullYear()}-${String(saved.id).padStart(4, "0")}`;
    await repo(manager, "servicios").save(saved);
  }
  await linkRows(
    manager,
    "servicio_pasajeros",
    "servicio_id",
    saved.id,
    "pasajero_id",
    pasajero_ids,
  );
  if (current && JSON.stringify([...previousPassengers].sort()) !== JSON.stringify([...pasajero_ids].sort())) {
    const [latest] = await manager.query("SELECT modification_count FROM servicios WHERE id=$1", [saved.id]);
    const passengerChange = JSON.stringify({ pasajero_ids: { anterior: previousPassengers, nuevo: pasajero_ids } });
    if (latest.modification_count > current.modification_count) {
      await manager.query("UPDATE servicio_auditoria SET cambios = cambios || $2::jsonb WHERE id = (SELECT id FROM servicio_auditoria WHERE servicio_id=$1 ORDER BY id DESC LIMIT 1)", [saved.id, passengerChange]);
    } else {
      await manager.query("INSERT INTO servicio_auditoria (servicio_id, cliente_id, usuario_id, usuario_nombre, tipo, cambios) VALUES ($1,$2,$3,$4,'MODIFICACION',$5::jsonb)", [saved.id, saved.cliente_id, user.id, user.nombre_completo, passengerChange]);
      await manager.query("UPDATE servicios SET modification_count = modification_count + 1, updated_at = now(), updated_by_id = $2 WHERE id = $1", [saved.id, user.id]);
    }
  }
  return { ...saved, pasajero_ids };
}

async function updateServiceStatus(manager, id, status, user) {
  await auditActor(manager, user);
  const service = await serviceAccess(manager, id, user);
  if (!["PROGRAMADO", "EN_RUTA", "FINALIZADO", "CANCELADO"].includes(status))
    throw bad("Estado operativo inválido");
  if (service.estatus_administrativo !== "ABIERTO" && status !== "FINALIZADO")
    throw bad(
      "No se puede cambiar el estado de un servicio en proceso administrativo",
    );
  service.estatus_operativo = status;
  return repo(manager, "servicios").save(service);
}

async function reopenRejectedService(manager, id, user) {
  await auditActor(manager, user);
  adminOnly(user);
  const service = await serviceAccess(manager, id, user);
  if (service.estatus_administrativo !== "RECHAZADO")
    throw bad("Sólo se pueden reabrir servicios rechazados");
  service.estatus_administrativo = "ABIERTO";
  return repo(manager, "servicios").save(service);
}

async function createConsolidation(manager, body, user) {
  await auditActor(manager, user);
  adminOnly(user);
  const { cliente_id, from, to } = body;
  if (
    !Number.isInteger(cliente_id) ||
    !z.iso.date().safeParse(from).success ||
    !z.iso.date().safeParse(to).success ||
    from > to
  )
    throw bad("Periodo o empresa inválidos");
  await assertCompanyAccess(manager, user, cliente_id);
  await activeClient(manager, cliente_id);
  const eligible = await manager.query(
    `SELECT id FROM servicios WHERE cliente_id=$1 AND estatus_operativo='FINALIZADO' AND estatus_administrativo='ABIERTO' AND (fecha_hora_programada AT TIME ZONE 'America/Mexico_City')::date BETWEEN $2::date AND $3::date FOR UPDATE`,
    [cliente_id, from, to],
  );
  if (!eligible.length)
    throw bad("No hay servicios finalizados pendientes en ese periodo");
  const record = await repo(manager, "consolidaciones").save({
    cliente_id,
    periodo_inicio: from,
    periodo_fin: to,
    estatus: "BORRADOR",
    creado_por_id: user.id,
    fecha_envio: null,
    fecha_aprobacion: null,
    notas: "",
  });
  for (const item of eligible) {
    await manager.query(
      "INSERT INTO consolidacion_servicios (consolidacion_id,servicio_id) VALUES ($1,$2)",
      [record.id, item.id],
    );
    await manager.query(
      "UPDATE servicios SET estatus_administrativo='EN_APROBACION' WHERE id=$1",
      [item.id],
    );
  }
  return {
    ...record,
    servicio_ids: eligible.map((item) => item.id),
    servicio_ids_aprobados: [],
  };
}

async function advanceConsolidation(manager, id, action, serviceIds, user) {
  await auditActor(manager, user);
  adminOnly(user);
  const record = await requireOne(
    manager,
    "consolidaciones",
    id,
    "Consolidación",
  );
  await assertCompanyAccess(manager, user, record.cliente_id);
  const links = await manager.query(
    "SELECT * FROM consolidacion_servicios WHERE consolidacion_id=$1 FOR UPDATE",
    [id],
  );
  if (action === "SEND") {
    if (record.estatus === "BORRADOR") {
      record.estatus = "ENVIADO";
      record.fecha_envio = new Date();
      await repo(manager, "consolidaciones").save(record);
    }
    return;
  }
  if (!["APPROVE", "REJECT"].includes(action) || record.estatus === "RECHAZADO")
    throw bad("Acción no permitida para este consolidado");
  const selected =
    serviceIds ||
    links.filter((item) => !item.aprobado).map((item) => item.servicio_id);
  requireIds(selected);
  for (const serviceId of selected) {
    const link = links.find((item) => item.servicio_id === serviceId);
    const service = await requireOne(
      manager,
      "servicios",
      serviceId,
      "Servicio",
    );
    if (
      !link ||
      link.aprobado ||
      service.estatus_administrativo !== "EN_APROBACION"
    )
      throw bad("Selecciona servicios pendientes de aprobación");
    await manager.query(
      "UPDATE consolidacion_servicios SET aprobado=$1 WHERE consolidacion_id=$2 AND servicio_id=$3",
      [action === "APPROVE", id, serviceId],
    );
    service.estatus_administrativo =
      action === "APPROVE" ? "POR_FACTURAR" : "RECHAZADO";
    await repo(manager, "servicios").save(service);
  }
  if (action === "APPROVE") {
    record.estatus = "APROBADO";
    record.fecha_aprobacion = new Date();
  } else if (
    !links.some((item) => item.aprobado) &&
    !(
      await manager.query(
        "SELECT 1 FROM servicios s JOIN consolidacion_servicios cs ON cs.servicio_id=s.id WHERE cs.consolidacion_id=$1 AND s.estatus_administrativo='EN_APROBACION' LIMIT 1",
        [id],
      )
    ).length
  )
    record.estatus = "RECHAZADO";
  await repo(manager, "consolidaciones").save(record);
}

async function createInvoice(manager, consolidationId, serviceIds, user) {
  await auditActor(manager, user);
  adminOnly(user);
  const consolidation = await requireOne(
    manager,
    "consolidaciones",
    consolidationId,
    "Consolidación",
  );
  await assertCompanyAccess(manager, user, consolidation.cliente_id);
  if (consolidation.estatus !== "APROBADO")
    throw bad("La consolidación debe estar aprobada");
  const links = await manager.query(
    "SELECT * FROM consolidacion_servicios WHERE consolidacion_id=$1",
    [consolidationId],
  );
  const selected =
    serviceIds ||
    links.filter((item) => item.aprobado).map((item) => item.servicio_id);
  requireIds(selected);
  let total = 0;
  for (const serviceId of selected) {
    if (!links.some((item) => item.servicio_id === serviceId && item.aprobado))
      throw bad("Selecciona servicios aprobados");
    const service = await requireOne(
      manager,
      "servicios",
      serviceId,
      "Servicio",
    );
    if (service.estatus_administrativo !== "POR_FACTURAR")
      throw bad("El servicio ya fue facturado");
    total += Number(service.importe_cliente);
  }
  const invoice = await repo(manager, "facturas").save({
    cliente_id: consolidation.cliente_id,
    folio: `TMP-${randomUUID()}`,
    fecha_emision: new Date(),
    total,
    estatus: "BORRADOR",
  });
  invoice.folio = `F-${1050 + invoice.id}`;
  await repo(manager, "facturas").save(invoice);
  for (const serviceId of selected) {
    await manager.query(
      "INSERT INTO factura_servicios (factura_id,servicio_id) VALUES ($1,$2)",
      [invoice.id, serviceId],
    );
    await manager.query(
      "UPDATE servicios SET estatus_administrativo='FACTURADO' WHERE id=$1",
      [serviceId],
    );
  }
  return invoice;
}

async function advanceInvoice(manager, id, action, serviceIds, user) {
  await auditActor(manager, user);
  adminOnly(user);
  const invoice = await requireOne(manager, "facturas", id, "Factura");
  await assertCompanyAccess(manager, user, invoice.cliente_id);
  const links = await manager.query(
    "SELECT * FROM factura_servicios WHERE factura_id=$1 FOR UPDATE",
    [id],
  );
  if (action === "PAY_INVOICE") {
    if (
      links.length ||
      !["EMITIDA", "PARCIALMENTE_PAGADA"].includes(invoice.estatus)
    )
      throw bad("Esta factura no tiene un pago total pendiente");
    invoice.estatus = "PAGADA";
    await repo(manager, "facturas").save(invoice);
    return;
  }
  if (!links.length) throw bad("La factura no tiene servicios vinculados");
  if (action === "SEND") {
    if (invoice.estatus !== "BORRADOR") throw bad("La factura ya fue enviada");
    invoice.estatus = "EMITIDA";
    for (const link of links)
      await manager.query(
        "UPDATE servicios SET estatus_administrativo='PENDIENTE_PAGO' WHERE id=$1",
        [link.servicio_id],
      );
  } else if (action === "PAY") {
    if (!["EMITIDA", "PARCIALMENTE_PAGADA"].includes(invoice.estatus))
      throw bad("Primero envía la factura");
    const selected =
      serviceIds ||
      links.filter((item) => !item.pagado).map((item) => item.servicio_id);
    requireIds(selected);
    for (const serviceId of selected) {
      if (!links.some((link) => link.servicio_id === serviceId && !link.pagado))
        throw bad("Selecciona servicios pendientes de pago");
      await manager.query(
        "UPDATE factura_servicios SET pagado=true WHERE factura_id=$1 AND servicio_id=$2",
        [id, serviceId],
      );
      await manager.query(
        "UPDATE servicios SET estatus_administrativo='PAGADO' WHERE id=$1",
        [serviceId],
      );
    }
    invoice.estatus = links.every(
      (link) => link.pagado || selected.includes(link.servicio_id),
    )
      ? "PAGADA"
      : "PARCIALMENTE_PAGADA";
  } else throw bad("Acción de factura inválida");
  await repo(manager, "facturas").save(invoice);
}

async function payOperator(manager, id, user) {
  await auditActor(manager, user);
  adminOnly(user);
  await manager.query("SELECT id FROM servicios WHERE id=$1 FOR UPDATE", [id]);
  const service = await serviceAccess(manager, id, user);
  if (
    service.estatus_operativo !== "FINALIZADO" ||
    service.estatus_pago_operador === "PAGADO"
  )
    throw bad("El servicio no tiene un pago pendiente");
  service.estatus_pago_operador = "PAGADO";
  service.fecha_pago_operador = new Date();
  await repo(manager, "servicios").save(service);
}

async function payAllOperators(manager, ids, user) {
  adminOnly(user);
  requireIds(ids);
  for (const id of ids) await payOperator(manager, id, user);
}

async function sendRoute(manager, id, channel, user) {
  const service = await serviceAccess(manager, id, user);
  if (!["WHATSAPP", "SMS", "APP"].includes(channel))
    throw bad("Canal inválido");
  const driver = await requireOne(
    manager,
    "choferes",
    service.chofer_id,
    "Operador",
  );
  return repo(manager, "envios_ruta").save({
    servicio_id: id,
    chofer_id: driver.id,
    canal: channel,
    destino: driver.telefono,
    fecha_hora: new Date(),
    estatus: "ENVIADO",
  });
}

module.exports = {
  saveService,
  updateServiceStatus,
  reopenRejectedService,
  createConsolidation,
  advanceConsolidation,
  createInvoice,
  advanceInvoice,
  payOperator,
  payAllOperators,
  sendRoute,
};
