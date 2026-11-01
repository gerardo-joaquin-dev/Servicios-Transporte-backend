class InitialSchema1761868800000 {
  name = "InitialSchema1761868800000";

  async up(queryRunner) {
    for (const sql of [
      `CREATE TABLE clientes (id SERIAL PRIMARY KEY, razon_social VARCHAR(255) NOT NULL, rfc_tax_id VARCHAR(255) NOT NULL, telefono VARCHAR(255) NOT NULL, correo VARCHAR(255) NOT NULL, direccion TEXT NOT NULL, pais VARCHAR(255) NOT NULL, estado VARCHAR(255) NOT NULL, ciudad VARCHAR(255) NOT NULL, codigo_postal VARCHAR(255) NOT NULL, activo BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE UNIQUE INDEX uq_clientes_rfc ON clientes (lower(rfc_tax_id)) WHERE rfc_tax_id <> ''`,
      `CREATE UNIQUE INDEX uq_clientes_correo ON clientes (lower(correo)) WHERE correo <> ''`,
      `CREATE TABLE usuarios (id SERIAL PRIMARY KEY, cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, nombre_completo VARCHAR(255) NOT NULL, correo VARCHAR(255) NOT NULL, rol VARCHAR(255) NOT NULL CHECK (rol IN ('ADMINISTRADOR','PROGRAMADOR_DESPACHADOR')), activo BOOLEAN NOT NULL DEFAULT true, password_hash VARCHAR(255), token_version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (cliente_id IS NOT NULL OR rol = 'ADMINISTRADOR'))`,
      `CREATE UNIQUE INDEX uq_usuarios_correo ON usuarios (lower(correo))`,
      `CREATE TABLE tipos_unidad (id SERIAL PRIMARY KEY, nombre VARCHAR(255) NOT NULL UNIQUE)`,
      `CREATE UNIQUE INDEX uq_tipos_unidad_nombre_ci ON tipos_unidad (lower(nombre))`,
      `CREATE TABLE choferes (id SERIAL PRIMARY KEY, propietario_cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, nombre_completo VARCHAR(255) NOT NULL, telefono VARCHAR(255) NOT NULL, numero_licencia VARCHAR(255) NOT NULL, tipo_licencia VARCHAR(255) NOT NULL, vencimiento_licencia DATE NOT NULL, estatus VARCHAR(255) NOT NULL CHECK (estatus IN ('ACTIVO','INACTIVO','BAJA','SUSPENDIDO','INCAPACIDAD','VACACIONES')))`,
      `CREATE UNIQUE INDEX uq_choferes_licencia ON choferes (lower(numero_licencia))`,
      `CREATE TABLE vehiculos (id SERIAL PRIMARY KEY, propietario_cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, chofer_predeterminado_id INTEGER REFERENCES choferes(id) ON DELETE RESTRICT, tipo VARCHAR(255) NOT NULL REFERENCES tipos_unidad(nombre) ON DELETE RESTRICT, marca VARCHAR(255) NOT NULL, modelo VARCHAR(255) NOT NULL, color VARCHAR(255) NOT NULL, placas VARCHAR(255) NOT NULL, numero_poliza_seguro VARCHAR(255) NOT NULL, vencimiento_poliza DATE NOT NULL, estatus VARCHAR(255) NOT NULL CHECK (estatus IN ('ACTIVO','INACTIVO','SINIESTRO','MANTENIMIENTO')), capacidad INTEGER NOT NULL CHECK (capacidad > 0))`,
      `CREATE UNIQUE INDEX uq_vehiculos_placas ON vehiculos (lower(placas))`,
      `CREATE TABLE zonas (id SERIAL PRIMARY KEY, propietario_cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, nombre VARCHAR(255) NOT NULL, descripcion TEXT NOT NULL DEFAULT '', activo BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE locaciones (id SERIAL PRIMARY KEY, zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE RESTRICT, cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, nombre VARCHAR(255) NOT NULL, direccion TEXT NOT NULL DEFAULT '', ciudad VARCHAR(255) NOT NULL DEFAULT '', estado VARCHAR(255), pais VARCHAR(255), codigo_postal VARCHAR(255), tipo VARCHAR(255) NOT NULL CHECK (tipo IN ('PARADA','CLIENTE','OTRO')), latitud DOUBLE PRECISION CHECK (latitud BETWEEN -90 AND 90), longitud DOUBLE PRECISION CHECK (longitud BETWEEN -180 AND 180), activo BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE pasajeros (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, nombre_completo VARCHAR(255) NOT NULL, telefono VARCHAR(255) NOT NULL DEFAULT '', activo BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE modos_servicio (id SERIAL PRIMARY KEY, propietario_cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, nombre VARCHAR(255) NOT NULL, descripcion TEXT NOT NULL DEFAULT '', activo BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE modo_clientes (modo_id INTEGER NOT NULL REFERENCES modos_servicio(id) ON DELETE CASCADE, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, PRIMARY KEY(modo_id, cliente_id))`,
      `CREATE TABLE rutas (id SERIAL PRIMARY KEY, propietario_cliente_id INTEGER REFERENCES clientes(id) ON DELETE RESTRICT, zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE RESTRICT, nombre VARCHAR(255) NOT NULL, zona VARCHAR(255) NOT NULL, kilometros_estimados NUMERIC(14,2) NOT NULL CHECK (kilometros_estimados >= 0), duracion_estimada_min INTEGER NOT NULL CHECK (duracion_estimada_min >= 0), registra_pasajeros BOOLEAN NOT NULL DEFAULT false, link_maps TEXT NOT NULL DEFAULT '', activo BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE UNIQUE INDEX uq_rutas_zona_nombre ON rutas (zona_id, lower(nombre))`,
      `CREATE TABLE ruta_locaciones (ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE, locacion_id INTEGER NOT NULL REFERENCES locaciones(id) ON DELETE RESTRICT, orden INTEGER NOT NULL CHECK (orden >= 0), PRIMARY KEY(ruta_id, locacion_id), UNIQUE(ruta_id, orden))`,
      `CREATE TABLE ruta_pasajeros (ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE, pasajero_id INTEGER NOT NULL REFERENCES pasajeros(id) ON DELETE RESTRICT, PRIMARY KEY(ruta_id, pasajero_id))`,
      `CREATE TABLE ruta_clientes (ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, PRIMARY KEY(ruta_id, cliente_id))`,
      `CREATE TABLE ruta_modos (ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE, modo_id INTEGER NOT NULL REFERENCES modos_servicio(id) ON DELETE RESTRICT, PRIMARY KEY(ruta_id, modo_id))`,
      `CREATE TABLE tarifas_cliente (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE RESTRICT, zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE RESTRICT, tipo_cobro VARCHAR(255) NOT NULL CHECK (tipo_cobro IN ('FIJO','POR_KILOMETRO','POR_PASAJERO')), importe NUMERIC(14,2) NOT NULL CHECK (importe > 0), tarifa_base NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tarifa_base >= 0), costo_por_kilometro NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_por_kilometro >= 0), costo_por_pasajero NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_por_pasajero >= 0), pago_operador NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (pago_operador >= 0), vigente_desde DATE NOT NULL, activo BOOLEAN NOT NULL DEFAULT true, usuario_creacion VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE servicios (id SERIAL PRIMARY KEY, codigo VARCHAR(255) NOT NULL UNIQUE, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, ruta_id INTEGER NOT NULL REFERENCES rutas(id) ON DELETE RESTRICT, modo VARCHAR(255) NOT NULL CHECK (modo IN ('ENTRADA','SALIDA','ENTRADA_Y_SALIDA','ESPECIAL')), modo_servicio_id INTEGER REFERENCES modos_servicio(id) ON DELETE RESTRICT, tarifa_id INTEGER REFERENCES tarifas_cliente(id) ON DELETE RESTRICT, chofer_id INTEGER NOT NULL REFERENCES choferes(id) ON DELETE RESTRICT, vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE RESTRICT, programado_por_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT, fecha_hora_programada TIMESTAMPTZ NOT NULL, estatus_operativo VARCHAR(255) NOT NULL CHECK (estatus_operativo IN ('PROGRAMADO','EN_RUTA','FINALIZADO','CANCELADO')), estatus_administrativo VARCHAR(255) NOT NULL CHECK (estatus_administrativo IN ('ABIERTO','EN_APROBACION','RECHAZADO','POR_FACTURAR','FACTURADO','PENDIENTE_PAGO','PAGADO')), estatus_pago_operador VARCHAR(255) NOT NULL CHECK (estatus_pago_operador IN ('PENDIENTE','PAGADO')), fecha_pago_operador TIMESTAMPTZ, cantidad_pasajeros INTEGER NOT NULL CHECK (cantidad_pasajeros >= 0), km_recorridos NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (km_recorridos >= 0), importe_cliente NUMERIC(14,2) NOT NULL CHECK (importe_cliente >= 0), importe_operador NUMERIC(14,2) NOT NULL CHECK (importe_operador >= 0), notas TEXT NOT NULL DEFAULT '')`,
      `CREATE INDEX ix_servicios_agenda ON servicios (fecha_hora_programada)`,
      `CREATE INDEX ix_servicios_operador_hora ON servicios (chofer_id, fecha_hora_programada)`,
      `CREATE INDEX ix_servicios_unidad_hora ON servicios (vehiculo_id, fecha_hora_programada)`,
      `CREATE INDEX ix_servicios_cliente_estado ON servicios (cliente_id, estatus_administrativo)`,
      `CREATE TABLE servicio_pasajeros (servicio_id INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE, pasajero_id INTEGER NOT NULL REFERENCES pasajeros(id) ON DELETE RESTRICT, PRIMARY KEY(servicio_id, pasajero_id))`,
      `CREATE TABLE consolidaciones (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, periodo_inicio DATE NOT NULL, periodo_fin DATE NOT NULL, estatus VARCHAR(255) NOT NULL CHECK (estatus IN ('BORRADOR','ENVIADO','APROBADO','RECHAZADO')), creado_por_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT, fecha_envio TIMESTAMPTZ, fecha_aprobacion TIMESTAMPTZ, notas TEXT NOT NULL DEFAULT '', CHECK (periodo_fin >= periodo_inicio))`,
      `CREATE TABLE consolidacion_servicios (consolidacion_id INTEGER NOT NULL REFERENCES consolidaciones(id) ON DELETE CASCADE, servicio_id INTEGER NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT, aprobado BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY(consolidacion_id, servicio_id))`,
      `CREATE TABLE facturas (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, folio VARCHAR(255) NOT NULL UNIQUE, fecha_emision TIMESTAMPTZ NOT NULL DEFAULT now(), total NUMERIC(14,2) NOT NULL CHECK (total >= 0), estatus VARCHAR(255) NOT NULL CHECK (estatus IN ('BORRADOR','EMITIDA','PARCIALMENTE_PAGADA','PAGADA','CANCELADA')))`,
      `CREATE TABLE factura_servicios (factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE, servicio_id INTEGER NOT NULL UNIQUE REFERENCES servicios(id) ON DELETE RESTRICT, pagado BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY(factura_id, servicio_id))`,
      `CREATE TABLE envios_ruta (id SERIAL PRIMARY KEY, servicio_id INTEGER NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT, chofer_id INTEGER NOT NULL REFERENCES choferes(id) ON DELETE RESTRICT, canal VARCHAR(255) NOT NULL CHECK (canal IN ('WHATSAPP','SMS','APP')), destino VARCHAR(255) NOT NULL, fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now(), estatus VARCHAR(255) NOT NULL DEFAULT 'ENVIADO' CHECK (estatus = 'ENVIADO'))`,
    ])
      await queryRunner.query(sql);
  }

  async down(queryRunner) {
    for (const table of [
      "envios_ruta",
      "factura_servicios",
      "facturas",
      "consolidacion_servicios",
      "consolidaciones",
      "servicio_pasajeros",
      "servicios",
      "tarifas_cliente",
      "ruta_modos",
      "ruta_clientes",
      "ruta_pasajeros",
      "ruta_locaciones",
      "rutas",
      "modo_clientes",
      "modos_servicio",
      "pasajeros",
      "locaciones",
      "zonas",
      "vehiculos",
      "choferes",
      "tipos_unidad",
      "usuarios",
      "clientes",
    ]) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
  }
}

module.exports = { InitialSchema1761868800000 };
