const { test } = require("node:test");
const assert = require("node:assert/strict");

test("migraciones, autenticación y flujo completo de la web", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const db = await PGlite.create();
  const socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await socket.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@${socket.getServerConn()}/postgres`;
  process.env.JWT_SECRET = "test_only_secret_123456789012345678901234567890";
  process.env.DB_POOL_SIZE = "1";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "123456789012";
  const { createDatabase } = require("../scripts/create-database");
  await createDatabase();
  const { dataSource } = require("../src/db/data-source");
  const { seed } = require("../scripts/seed");
  const { app } = require("../src/app");
  let http;
  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seed();
    await seed();
    http = app.listen(0);
    await new Promise((resolve) => http.once("listening", resolve));
    const base = `http://127.0.0.1:${http.address().port}`;
    const call = async (path, method, body, token) => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = response.status === 204 ? null : await response.json();
      assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(payload)}`);
      return payload;
    };
    const login = await call("/auth/login", "POST", {
      email: "admin@example.com",
      password: "123456789012",
    });
    const token = login.token;
    const dictionary = await call("/diccionarios", "POST", { nombre: "Categorías", valores: ["A"] }, token);
    assert.equal(dictionary.valores[0], "A");
    const updatedDictionary = await call(`/diccionarios/${dictionary.id}`, "PUT", { nombre: "Categorías", valores: ["A", "B"] }, token);
    assert.deepEqual(updatedDictionary.valores, ["A", "B"]);
    assert.ok((await call("/data", "GET", undefined, token)).diccionarios.some((item) => item.id === dictionary.id));
    await call(`/diccionarios/${dictionary.id}`, "DELETE", undefined, token);
    const client = await call(
      "/clientes",
      "POST",
      {
        razon_social: "Empresa Uno",
        rfc_tax_id: "ABC010101AAA",
        telefono: "8111111111",
        correo: "empresa@example.com",
        direccion: "Centro",
        pais: "México",
        estado: "Nuevo León",
        ciudad: "Monterrey",
        codigo_postal: "64000",
        activo: true,
      },
      token,
    );
    const otherClient = await call("/clientes", "POST", { ...client, tenant_id: null, razon_social: "Empresa Dos", rfc_tax_id: "XYZ010101BBB", correo: "otra@example.com" }, token);
    assert.notEqual(otherClient.tenant_id, client.tenant_id);
    const otherUser = await call("/usuarios", "POST", { cliente_id: otherClient.id, nombre_completo: "Otro administrador", correo: "otro-admin@example.com", rol: "ADMINISTRADOR", activo: true, password: "123456789012" }, token);
    const otherLogin = await call("/auth/login", "POST", { email: otherUser.correo, password: "123456789012" });
    assert.equal(otherLogin.user.tenant_id, otherClient.tenant_id);
    assert.equal(otherLogin.user.cliente_id, otherClient.id);
    const zone = await call(
      "/zonas",
      "POST",
      { nombre: "Centro", descripcion: "", activo: true },
      token,
    );
    const stop = async (nombre) =>
      call(
        "/locaciones",
        "POST",
        {
          zona_id: zone.id,
          cliente_id: client.id,
          nombre,
          direccion: "Centro",
          ciudad: "Monterrey",
          tipo: "PARADA",
          latitud: null,
          longitud: null,
          activo: true,
        },
        token,
      );
    const a = await stop("Origen");
    const b = await stop("Destino");
    const mode = await call(
      "/modos-servicio",
      "POST",
      {
        nombre: "Entrada",
        descripcion: "",
        cliente_ids: [client.id],
        activo: true,
      },
      token,
    );
    const route = await call(
      "/rutas",
      "POST",
      {
        zona_id: zone.id,
        nombre: "Ruta Uno",
        kilometros_estimados: 12,
        duracion_estimada_min: 30,
        locacion_ids: [a.id, b.id],
        cliente_ids: [client.id],
        pasajero_ids: [],
        modo_servicio_ids: [mode.id],
        registra_pasajeros: false,
        link_maps: "https://maps.google.com/?q=Monterrey",
        activo: true,
      },
      token,
    );
    const driver = await call(
      "/choferes",
      "POST",
      {
        propietario_cliente_id: client.id,
        nombre_completo: "Operador Uno",
        telefono: "8111111111",
        numero_licencia: "LIC-001",
        tipo_licencia: "E",
        vencimiento_licencia: "2030-01-01",
        estatus: "ACTIVO",
      },
      token,
    );
    const vehicle = await call(
      "/vehiculos",
      "POST",
      {
        propietario_cliente_id: client.id,
        chofer_predeterminado_id: driver.id,
        tipo: "Van",
        marca: "Toyota",
        modelo: "Hiace",
        color: "Blanco",
        placas: "ABC-123",
        numero_poliza_seguro: "POL-001",
        vencimiento_poliza: "2030-01-01",
        estatus: "ACTIVO",
        capacidad: 20,
      },
      token,
    );
    const rate = await call(
      "/tarifas-cliente",
      "POST",
      {
        cliente_id: client.id,
        zona_id: zone.id,
        ruta_id: route.id,
        tipo_cobro: "FIJO",
        importe: 1500,
        tarifa_base: 1500,
        costo_por_kilometro: 0,
        costo_por_pasajero: 0,
        pago_operador: 650,
        vigente_desde: "2026-01-01",
        activo: true,
      },
      token,
    );
    const user = await call(
      "/usuarios",
      "POST",
      {
        cliente_id: client.id,
        nombre_completo: "Empresa Admin",
        correo: "empresa-admin@example.com",
        rol: "ADMINISTRADOR",
        activo: true,
        password: "123456789012",
      },
      token,
    );
    assert.equal(user.password_hash, undefined);
    const companyLogin = await call("/auth/login", "POST", {
      email: "empresa-admin@example.com",
      password: "123456789012",
    });
    assert.equal(companyLogin.user.role, "COMPANY_ADMIN");
    const companyMode = await call(
      "/modos-servicio",
      "POST",
      {
        nombre: "Salida",
        descripcion: "",
        cliente_ids: [client.id],
        activo: true,
      },
      companyLogin.token,
    );
    assert.equal(companyMode.propietario_cliente_id, client.id);
    const dispatcher = await call(
      "/usuarios",
      "POST",
      {
        cliente_id: client.id,
        nombre_completo: "Despachador",
        correo: "dispatch@example.com",
        rol: "PROGRAMADOR_DESPACHADOR",
        activo: true,
        password: "123456789012",
      },
      companyLogin.token,
    );
    const dispatchLogin = await call("/auth/login", "POST", {
      email: dispatcher.correo,
      password: "123456789012",
    });
    assert.equal(dispatchLogin.user.role, "DISPATCHER");
    const dispatchForbidden = await fetch(`${base}/api/zonas`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dispatchLogin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nombre: "No permitido" }),
    });
    assert.equal(dispatchForbidden.status, 403);
    const forbidden = await fetch(`${base}/api/clientes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${companyLogin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ razon_social: "Otra" }),
    });
    assert.equal(forbidden.status, 403);
    const invalidDispatcher = await fetch(`${base}/api/usuarios`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cliente_id: null,
        nombre_completo: "Sin empresa",
        correo: "sin-empresa@example.com",
        rol: "PROGRAMADOR_DESPACHADOR",
        activo: true,
        password: "123456789012",
      }),
    });
    assert.equal(invalidDispatcher.status, 422);
    const service = await call(
      "/servicios",
      "POST",
      {
        cliente_id: client.id,
        ruta_id: route.id,
        modo: "ENTRADA",
        modo_servicio_id: mode.id,
        tarifa_id: rate.id,
        chofer_id: driver.id,
        vehiculo_id: vehicle.id,
        fecha_hora_programada: "2026-10-30T14:00:00.000Z",
        estatus_operativo: "PROGRAMADO",
        cantidad_pasajeros: 10,
        pasajero_ids: [],
        importe_cliente: 9999,
        importe_operador: 0,
        notas: "",
      },
      token,
    );
    assert.equal(Number(service.importe_cliente), 1500);
    assert.equal(Number(service.importe_operador), 650);
    const creationAudit = (await call("/data", "GET", undefined, token)).servicio_auditoria.filter((item) => item.servicio_id === service.id);
    assert.equal(creationAudit.length, 1);
    assert.equal(creationAudit[0].tipo, "CREACION");
    assert.equal(creationAudit[0].usuario_id, login.user.id);
    const edited = await call(
      `/servicios/${service.id}`,
      "PUT",
      { notas: "Cambio de instrucciones" },
      token,
    );
    assert.equal(edited.notas, "Cambio de instrucciones");
    assert.equal(Number(edited.importe_cliente), 1500);
    const dispatchEdit = await call(`/servicios/${service.id}`, "PUT", { notas: "Despacho actualizado", importe_cliente: 1, importe_operador: 1, tarifa_id: 99999 }, dispatchLogin.token);
    assert.equal(dispatchEdit.importe_cliente, undefined);
    assert.equal(dispatchEdit.importe_operador, undefined);
    const auditedEdit = (await call("/data", "GET", undefined, token)).servicios.find((item) => item.id === service.id);
    assert.equal(auditedEdit.importe_cliente, 1500);
    assert.equal(auditedEdit.importe_operador, 650);
    assert.ok(auditedEdit.modification_count >= 2);
    const dispatch = await call(
      `/servicios/${service.id}/envios`,
      "POST",
      { channel: "WHATSAPP" },
      dispatchLogin.token,
    );
    assert.equal(dispatch.destino, driver.telefono);
    await call(
      `/servicios/${service.id}/estatus`,
      "PATCH",
      { status: "FINALIZADO" },
      token,
    );
    const consolidation = await call(
      "/consolidaciones",
      "POST",
      { cliente_id: client.id, from: "2026-10-30", to: "2026-10-30" },
      token,
    );
    await call(
      `/consolidaciones/${consolidation.id}/advance`,
      "POST",
      { action: "SEND" },
      token,
    );
    await call(
      `/consolidaciones/${consolidation.id}/advance`,
      "POST",
      { action: "APPROVE", serviceIds: [service.id] },
      token,
    );
    const invoice = await call(
      `/consolidaciones/${consolidation.id}/facturas`,
      "POST",
      { serviceIds: [service.id] },
      token,
    );
    assert.equal(Number(invoice.total), 1500);
    await call(
      `/facturas/${invoice.id}/advance`,
      "POST",
      { action: "SEND" },
      token,
    );
    await call(
      `/facturas/${invoice.id}/advance`,
      "POST",
      { action: "PAY", serviceIds: [service.id] },
      token,
    );
    await call(`/servicios/${service.id}/pagar-operador`, "POST", {}, token);
    const data = await call("/data", "GET", undefined, token);
    assert.equal(
      data.rutas[0].link_maps,
      "https://maps.google.com/?q=Monterrey",
    );
    assert.deepEqual(data.rutas[0].locacion_ids, [a.id, b.id]);
    assert.equal(data.facturas[0].estatus, "PAGADA");
    assert.equal(data.servicios[0].estatus_pago_operador, "PAGADO");
    const scoped = await call("/data", "GET", undefined, companyLogin.token);
    assert.equal(scoped.clientes.length, 1);
    assert.equal(scoped.usuarios.length, 2);
    assert.ok(!scoped.usuarios.some((item) => item.id === otherUser.id));
    assert.ok(!scoped.clientes.some((item) => item.id === otherClient.id));
    const otherScoped = await call("/data", "GET", undefined, otherLogin.token);
    assert.equal(otherScoped.clientes.length, 1);
    assert.equal(otherScoped.servicios.length, 0);
    assert.ok(!otherScoped.usuarios.some((item) => item.id === user.id));
    assert.equal(scoped.facturas.length, 1);
    const dispatchData = await call(
      "/data",
      "GET",
      undefined,
      dispatchLogin.token,
    );
    assert.equal(dispatchData.usuarios.length, 0);
    assert.equal(dispatchData.tarifas_cliente.length, 0);
    assert.equal(dispatchData.servicios[0].importe_cliente, undefined);
    assert.equal(dispatchData.servicios[0].importe_operador, undefined);
    assert.equal(dispatchData.servicios[0].programado_por_nombre, login.user.nombre_completo);
    assert.equal(dispatchData.servicio_auditoria.length, 0);
    assert.ok(data.servicio_auditoria.some((item) => item.usuario_id === dispatcher.id && item.cambios.notas));
    const companyCannotDeactivate = await fetch(`${base}/api/clientes/${client.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${companyLogin.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ activo: false }),
    });
    assert.equal(companyCannotDeactivate.status, 403);
    const financeForbidden = await fetch(`${base}/api/consolidaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${companyLogin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cliente_id: otherClient.id,
        from: "2026-10-30",
        to: "2026-10-30",
      }),
    });
    assert.equal(financeForbidden.status, 403);
    const dispatchCreated = await call("/servicios", "POST", {
      cliente_id: client.id, ruta_id: route.id, modo: "ENTRADA", modo_servicio_id: mode.id,
      tarifa_id: 99999, chofer_id: driver.id, vehiculo_id: vehicle.id,
      fecha_hora_programada: "2026-10-31T18:00:00.000Z", estatus_operativo: "PROGRAMADO",
      cantidad_pasajeros: 2, pasajero_ids: [], importe_cliente: 1, importe_operador: 1, notas: "Creado por despacho",
    }, dispatchLogin.token);
    assert.equal(dispatchCreated.importe_cliente, undefined);
    const dispatchCreatedAdminView = (await call("/data", "GET", undefined, token)).servicios.find((item) => item.id === dispatchCreated.id);
    assert.equal(dispatchCreatedAdminView.importe_cliente, 1500);
    assert.equal(dispatchCreatedAdminView.programado_por_id, dispatcher.id);
    await call(`/clientes/${otherClient.id}`, "PUT", { activo: false }, token);
    const inactiveToken = await fetch(`${base}/api/data`, { headers: { Authorization: `Bearer ${otherLogin.token}` } });
    assert.equal(inactiveToken.status, 401);
    const inactiveLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: otherUser.correo, password: "123456789012" }) });
    assert.equal(inactiveLogin.status, 401);
    const account = await call("/cuentas", "POST", {
      nombre: "Cliente Principal",
      admin: { nombre_completo: "Dueño Cliente", correo: "dueno@example.com", password: "123456789012" },
    }, token);
    const tenantLogin = await call("/auth/login", "POST", { email: "dueno@example.com", password: "123456789012" });
    assert.equal(tenantLogin.user.role, "CLIENT_OWNER");
    assert.equal(tenantLogin.user.tenant_id, account.tenant.id);
    const platformPeer = await call("/usuarios", "POST", { tenant_id: null, cliente_id: null, nombre_completo: "Administradora Flotnix", correo: "plataforma-peer@example.com", rol: "ADMINISTRADOR", activo: true, password: "123456789012" }, token);
    assert.equal((await call("/auth/login", "POST", { email: platformPeer.correo, password: "123456789012" })).user.role, "PLATFORM_ADMIN");
    const convertToClient = await fetch(`${base}/api/usuarios/${platformPeer.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: account.tenant.id, cliente_id: null, nombre_completo: platformPeer.nombre_completo, correo: platformPeer.correo, rol: "CLIENTE", activo: true }) });
    assert.equal(convertToClient.status, 403);
    const secondClientUser = await call("/usuarios", "POST", { tenant_id: null, cliente_id: null, nombre_completo: "Cliente adicional", correo: "cliente-adicional@example.com", rol: "CLIENTE", activo: true, password: "123456789012" }, token);
    assert.equal(secondClientUser.cliente_id, null);
    assert.notEqual(secondClientUser.tenant_id, account.tenant.id);
    const secondClientLogin = await call("/auth/login", "POST", { email: secondClientUser.correo, password: "123456789012" });
    assert.equal(secondClientLogin.user.role, "CLIENT_OWNER");
    const secondClientCompany = await call("/clientes", "POST", { ...client, tenant_id: null, razon_social: "Empresa del segundo cliente", rfc_tax_id: "CLI010101EEE", correo: "segundo-cliente-empresa@example.com" }, secondClientLogin.token);
    assert.equal(secondClientCompany.tenant_id, secondClientUser.tenant_id);
    assert.deepEqual((await call("/data", "GET", undefined, secondClientLogin.token)).clientes.map(item => item.id), [secondClientCompany.id]);
    const platformData = await call("/data", "GET", undefined, token);
    assert.ok(platformData.clientes.some(item => item.id === secondClientCompany.id));
    assert.ok(platformData.usuarios.some(item => item.id === secondClientUser.id));
    const linkedClientUser = await fetch(`${base}/api/usuarios`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: account.tenant.id, cliente_id: null, nombre_completo: "Cliente vinculado", correo: "vinculado@example.com", rol: "CLIENTE", activo: true, password: "123456789012" }) });
    assert.equal(linkedClientUser.status, 400);
    const clientCannotCreateOwner = await fetch(`${base}/api/usuarios`, { method: "POST", headers: { Authorization: `Bearer ${tenantLogin.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: null, cliente_id: null, nombre_completo: "Dueño falso", correo: "falso@example.com", rol: "CLIENTE", activo: true, password: "123456789012" }) });
    assert.equal(clientCannotCreateOwner.status, 403);
    const tenantCompany = await call("/clientes", "POST", { ...client, tenant_id: account.tenant.id, razon_social: "Empresa del cliente", rfc_tax_id: "CLI010101CCC", correo: "empresa-cliente@example.com" }, tenantLogin.token);
    assert.equal(tenantCompany.tenant_id, account.tenant.id);
    const ownerDispatcher = await call("/usuarios", "POST", { cliente_id: tenantCompany.id, nombre_completo: "Despacho seleccionado", correo: "despacho-seleccionado@example.com", rol: "PROGRAMADOR_DESPACHADOR", activo: true, password: "123456789012" }, tenantLogin.token);
    assert.equal(ownerDispatcher.cliente_id, tenantCompany.id);
    const foreignDispatcher = await fetch(`${base}/api/usuarios`, { method: "POST", headers: { Authorization: `Bearer ${tenantLogin.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: secondClientCompany.id, nombre_completo: "Despacho ajeno", correo: "despacho-ajeno@example.com", rol: "PROGRAMADOR_DESPACHADOR", activo: true, password: "123456789012" }) });
    assert.equal(foreignDispatcher.status, 403);
    const peer = await call("/usuarios", "POST", { cliente_id: null, nombre_completo: "Colega", correo: "colega@example.com", rol: "ADMINISTRADOR", activo: true, password: "123456789012" }, tenantLogin.token);
    assert.equal(peer.tenant_id, account.tenant.id);
    const peerLogin = await call("/auth/login", "POST", { email: peer.correo, password: "123456789012" });
    assert.equal(peerLogin.user.role, "TENANT_ADMIN");
    const companyManager = await call("/usuarios", "POST", { cliente_id: tenantCompany.id, nombre_completo: "Gerente", correo: "gerente@example.com", rol: "ADMINISTRADOR", activo: true, password: "123456789012" }, tenantLogin.token);
    const managerLogin = await call("/auth/login", "POST", { email: companyManager.correo, password: "123456789012" });
    assert.equal(managerLogin.user.role, "COMPANY_ADMIN");
    const tenantData = await call("/data", "GET", undefined, tenantLogin.token);
    assert.deepEqual(tenantData.clientes.map((item) => item.id), [tenantCompany.id]);
    assert.ok(!tenantData.usuarios.some((item) => item.id === user.id));
    const crossTenant = await fetch(`${base}/api/usuarios`, { method: "POST", headers: { Authorization: `Bearer ${tenantLogin.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: client.id, nombre_completo: "Intruso", correo: "intruso@example.com", rol: "ADMINISTRADOR", activo: true, password: "123456789012" }) });
    assert.equal(crossTenant.status, 403);
    const managerCreatesAdmin = await fetch(`${base}/api/usuarios`, { method: "POST", headers: { Authorization: `Bearer ${managerLogin.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: tenantCompany.id, nombre_completo: "Otro gerente", correo: "otro-gerente@example.com", rol: "ADMINISTRADOR", activo: true, password: "123456789012" }) });
    assert.equal(managerCreatesAdmin.status, 403);
    const managerDispatcher = await call("/usuarios", "POST", { cliente_id: tenantCompany.id, nombre_completo: "Despacho empresa", correo: "despacho-empresa@example.com", rol: "PROGRAMADOR_DESPACHADOR", activo: true, password: "123456789012" }, managerLogin.token);
    assert.equal(managerDispatcher.cliente_id, tenantCompany.id);
    const secondTenantCompany = await call("/clientes", "POST", { ...client, tenant_id: account.tenant.id, razon_social: "Segunda empresa cliente", rfc_tax_id: "CLI010101DDD", correo: "segunda-empresa@example.com" }, peerLogin.token);
    assert.equal(secondTenantCompany.tenant_id, account.tenant.id);
    const tenantZone = await call("/zonas", "POST", { propietario_cliente_id: tenantCompany.id, nombre: "Zona cliente", descripcion: "", activo: true }, tenantLogin.token);
    const tenantStops = [];
    for (const nombre of ["Inicio cliente", "Destino cliente"]) {
      tenantStops.push(await call("/locaciones", "POST", { zona_id: tenantZone.id, cliente_id: tenantCompany.id, nombre, direccion: "Centro", ciudad: "Monterrey", tipo: "PARADA", latitud: null, longitud: null, activo: true }, tenantLogin.token));
    }
    const tenantMode = await call("/modos-servicio", "POST", { nombre: "Entrada cliente", descripcion: "", cliente_ids: [tenantCompany.id], activo: true }, tenantLogin.token);
    const tenantRoute = await call("/rutas", "POST", { zona_id: tenantZone.id, nombre: "Ruta cliente", kilometros_estimados: 10, duracion_estimada_min: 20, locacion_ids: tenantStops.map(x => x.id), cliente_ids: [tenantCompany.id], pasajero_ids: [], modo_servicio_ids: [tenantMode.id], registra_pasajeros: false, link_maps: "", activo: true }, tenantLogin.token);
    const tenantDriver = await call("/choferes", "POST", { propietario_cliente_id: tenantCompany.id, nombre_completo: "Operador cliente", telefono: "8111111111", numero_licencia: "LIC-CLI", tipo_licencia: "E", vencimiento_licencia: "2030-01-01", estatus: "ACTIVO" }, tenantLogin.token);
    const tenantVehicle = await call("/vehiculos", "POST", { propietario_cliente_id: tenantCompany.id, chofer_predeterminado_id: tenantDriver.id, tipo: "Van", marca: "Toyota", modelo: "Hiace", color: "Blanco", placas: "CLI-123", numero_poliza_seguro: "POL-CLI", vencimiento_poliza: "2030-01-01", estatus: "ACTIVO", capacidad: 20 }, tenantLogin.token);
    const tenantRate = await call("/tarifas-cliente", "POST", { cliente_id: tenantCompany.id, zona_id: tenantZone.id, ruta_id: tenantRoute.id, tipo_cobro: "FIJO", importe: 1000, tarifa_base: 1000, costo_por_kilometro: 0, costo_por_pasajero: 0, pago_operador: 400, vigente_desde: "2026-01-01", activo: true }, tenantLogin.token);
    const tenantService = await call("/servicios", "POST", { cliente_id: tenantCompany.id, ruta_id: tenantRoute.id, modo: "ENTRADA", modo_servicio_id: tenantMode.id, tarifa_id: tenantRate.id, chofer_id: tenantDriver.id, vehiculo_id: tenantVehicle.id, fecha_hora_programada: "2026-10-30T14:00:00.000Z", estatus_operativo: "PROGRAMADO", cantidad_pasajeros: 1, pasajero_ids: [], importe_cliente: 1000, importe_operador: 400, notas: "Cliente" }, tenantLogin.token);
    assert.equal(tenantService.cliente_id, tenantCompany.id);
    const tenantScopedData = await call("/data", "GET", undefined, tenantLogin.token);
    assert.deepEqual(new Set(tenantScopedData.clientes.map(x => x.id)), new Set([tenantCompany.id, secondTenantCompany.id]));
    assert.deepEqual(tenantScopedData.servicios.map(x => x.id), [tenantService.id]);
    assert.deepEqual(tenantScopedData.rutas.map(x => x.id), [tenantRoute.id]);
    assert.deepEqual(tenantScopedData.choferes.map(x => x.id), [tenantDriver.id]);
    assert.equal(tenantScopedData.tarifas_cliente.length, 1);
    const companyScopedData = await call("/data", "GET", undefined, managerLogin.token);
    assert.deepEqual(companyScopedData.clientes.map(x => x.id), [tenantCompany.id]);
    assert.deepEqual(companyScopedData.servicios.map(x => x.id), [tenantService.id]);
    const managerCannotEditSecondCompany = await fetch(`${base}/api/clientes/${secondTenantCompany.id}`, { method: "PUT", headers: { Authorization: `Bearer ${managerLogin.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ activo: false }) });
    assert.equal(managerCannotEditSecondCompany.status, 403);
    await call(`/servicios/${tenantService.id}/estatus`, "PATCH", { status: "FINALIZADO" }, managerLogin.token);
    const tenantConsolidation = await call("/consolidaciones", "POST", { cliente_id: tenantCompany.id, from: "2026-10-30", to: "2026-10-30" }, tenantLogin.token);
    assert.deepEqual(tenantConsolidation.servicio_ids, [tenantService.id]);
    assert.equal((await call("/data", "GET", undefined, managerLogin.token)).consolidaciones.length, 1);
    const tenantCannotCreateAccount = await fetch(`${base}/api/cuentas`, { method: "POST", headers: { Authorization: `Bearer ${tenantLogin.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "Otra cuenta", admin: { nombre_completo: "Otro", correo: "otro@example.com", password: "123456789012" } }) });
    assert.equal(tenantCannotCreateAccount.status, 403);
    await call(`/cuentas/${account.tenant.id}`, "PUT", { activo: false }, token);
    const blockedToken = await fetch(`${base}/api/data`, { headers: { Authorization: `Bearer ${tenantLogin.token}` } });
    assert.equal(blockedToken.status, 401);
    const legacyOwner = await call("/usuarios", "POST", { tenant_id: null, cliente_id: null, nombre_completo: "Jesús", correo: "jesusrv@flotnix.com", rol: "CLIENTE", activo: true, password: "123456789012" }, token);
    const { AssignLegacyCompaniesToJesus1794355200001 } = require("../src/db/migrations/1794355200001-AssignLegacyCompaniesToJesus");
    const assignLegacy = async () => dataSource.transaction(async (manager) => {
      await new AssignLegacyCompaniesToJesus1794355200001().up(manager.queryRunner);
    });
    await assignLegacy();
    await assignLegacy();
    const assigned = await dataSource.query("SELECT cliente_id FROM migration_jesusrv_company_assignments ORDER BY cliente_id");
    assert.deepEqual(assigned.map(row => row.cliente_id), [client.id, otherClient.id]);
    const legacyToken = require("jsonwebtoken").sign({ sub: String(legacyOwner.id), ver: 0 }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "8h", issuer: "flotnix" });
    const legacyData = await call("/data", "GET", undefined, legacyToken);
    assert.deepEqual(new Set(legacyData.clientes.map(item => item.id)), new Set([client.id, otherClient.id]));
    assert.ok(!legacyData.clientes.some(item => item.id === tenantCompany.id || item.id === secondClientCompany.id));
    const [movedCompanyUser] = await dataSource.query("SELECT tenant_id FROM usuarios WHERE id = $1", [otherUser.id]);
    assert.equal(movedCompanyUser.tenant_id, legacyOwner.tenant_id);
  } finally {
    if (http) await new Promise((resolve) => http.close(resolve));
    if (dataSource.isInitialized) await dataSource.destroy();
    await socket.stop();
    await db.close();
  }
});
