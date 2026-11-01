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
    const edited = await call(
      `/servicios/${service.id}`,
      "PUT",
      { notas: "Cambio de instrucciones" },
      token,
    );
    assert.equal(edited.notas, "Cambio de instrucciones");
    assert.equal(Number(edited.importe_cliente), 1500);
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
    assert.equal(scoped.facturas.length, 0);
    const dispatchData = await call(
      "/data",
      "GET",
      undefined,
      dispatchLogin.token,
    );
    assert.equal(dispatchData.usuarios.length, 0);
    const financeForbidden = await fetch(`${base}/api/consolidaciones`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${companyLogin.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cliente_id: client.id,
        from: "2026-10-30",
        to: "2026-10-30",
      }),
    });
    assert.equal(financeForbidden.status, 403);
  } finally {
    if (http) await new Promise((resolve) => http.close(resolve));
    if (dataSource.isInitialized) await dataSource.destroy();
    await socket.stop();
    await db.close();
  }
});
