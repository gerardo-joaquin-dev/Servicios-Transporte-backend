const { EntitySchema } = require("typeorm");

const id = { id: { type: "integer", primary: true, generated: true } };
const str = (nullable = false) => ({ type: "varchar", length: 255, nullable });
const text = (nullable = false) => ({ type: "text", nullable });
const bool = (defaultValue = true) => ({
  type: "boolean",
  default: defaultValue,
});
const num = (nullable = false) => ({
  type: "numeric",
  precision: 14,
  scale: 2,
  nullable,
});
const int = (nullable = false) => ({ type: "integer", nullable });
const date = (nullable = false) => ({ type: "date", nullable });
const timestamp = (nullable = false) => ({ type: "timestamptz", nullable });
const schema = (name, columns, relations = {}) =>
  new EntitySchema({
    name,
    tableName: name,
    columns: { ...id, ...columns },
    relations,
  });
const belongsTo = (target, field, nullable = false) => ({
  type: "many-to-one",
  target,
  joinColumn: { name: field },
  nullable,
  onDelete: "RESTRICT",
});

const schemas = {
  clientes: schema("clientes", {
    razon_social: str(),
    rfc_tax_id: str(),
    telefono: str(),
    correo: str(),
    direccion: text(),
    pais: str(),
    estado: str(),
    ciudad: str(),
    codigo_postal: str(),
    activo: bool(),
    created_at: timestamp(),
    updated_at: timestamp(),
  }),
  usuarios: schema(
    "usuarios",
    {
      cliente_id: int(true),
      nombre_completo: str(),
      correo: str(),
      rol: str(),
      activo: bool(),
      password_hash: str(true),
      token_version: { type: "integer", default: 0 },
      created_at: timestamp(),
    },
    { cliente: belongsTo("clientes", "cliente_id", true) },
  ),
  tipos_unidad: schema("tipos_unidad", { nombre: str() }),
  diccionarios: schema("diccionarios", { nombre: { type: "varchar", length: 100 }, valores: { type: "jsonb", default: () => "'[]'::jsonb" } }),
  choferes: schema(
    "choferes",
    {
      propietario_cliente_id: int(true),
      nombre_completo: str(),
      telefono: str(),
      numero_licencia: str(),
      tipo_licencia: str(),
      vencimiento_licencia: date(),
      estatus: str(),
    },
    { propietario: belongsTo("clientes", "propietario_cliente_id", true) },
  ),
  vehiculos: schema(
    "vehiculos",
    {
      propietario_cliente_id: int(true),
      chofer_predeterminado_id: int(true),
      tipo: str(),
      marca: str(),
      modelo: str(),
      color: str(),
      placas: str(),
      numero_poliza_seguro: str(),
      vencimiento_poliza: date(),
      estatus: str(),
      capacidad: int(),
    },
    {
      propietario: belongsTo("clientes", "propietario_cliente_id", true),
      chofer: belongsTo("choferes", "chofer_predeterminado_id", true),
    },
  ),
  zonas: schema(
    "zonas",
    {
      propietario_cliente_id: int(true),
      nombre: str(),
      descripcion: text(),
      activo: bool(),
    },
    { propietario: belongsTo("clientes", "propietario_cliente_id", true) },
  ),
  locaciones: schema(
    "locaciones",
    {
      zona_id: int(),
      cliente_id: int(true),
      nombre: str(),
      direccion: text(),
      ciudad: str(),
      estado: str(true),
      pais: str(true),
      codigo_postal: str(true),
      tipo: str(),
      latitud: { type: "double precision", nullable: true },
      longitud: { type: "double precision", nullable: true },
      activo: bool(),
    },
    {
      zona_ref: belongsTo("zonas", "zona_id"),
      cliente: belongsTo("clientes", "cliente_id", true),
    },
  ),
  pasajeros: schema(
    "pasajeros",
    {
      cliente_id: int(),
      nombre_completo: str(),
      telefono: str(),
      activo: bool(),
    },
    { cliente: belongsTo("clientes", "cliente_id") },
  ),
  modos_servicio: schema(
    "modos_servicio",
    {
      propietario_cliente_id: int(true),
      nombre: str(),
      descripcion: text(),
      activo: bool(),
    },
    { propietario: belongsTo("clientes", "propietario_cliente_id", true) },
  ),
  rutas: schema(
    "rutas",
    {
      propietario_cliente_id: int(true),
      zona_id: int(),
      nombre: str(),
      zona: str(),
      kilometros_estimados: num(),
      duracion_estimada_min: int(),
      registra_pasajeros: bool(false),
      link_maps: text(),
      activo: bool(),
    },
    {
      propietario: belongsTo("clientes", "propietario_cliente_id", true),
      zona_ref: belongsTo("zonas", "zona_id"),
    },
  ),
  tarifas_cliente: schema(
    "tarifas_cliente",
    {
      cliente_id: int(),
      ruta_id: int(),
      zona_id: int(),
      tipo_cobro: str(),
      importe: num(),
      tarifa_base: num(),
      costo_por_kilometro: num(),
      costo_por_pasajero: num(),
      pago_operador: num(),
      vigente_desde: date(),
      activo: bool(),
      usuario_creacion: str(true),
      created_at: timestamp(),
      updated_at: timestamp(),
    },
    {
      cliente: belongsTo("clientes", "cliente_id"),
      ruta_ref: belongsTo("rutas", "ruta_id"),
      zona_ref: belongsTo("zonas", "zona_id"),
    },
  ),
  servicios: schema(
    "servicios",
    {
      codigo: str(),
      cliente_id: int(),
      ruta_id: int(),
      modo: str(),
      modo_servicio_id: int(true),
      tarifa_id: int(true),
      chofer_id: int(),
      vehiculo_id: int(),
      programado_por_id: int(true),
      fecha_hora_programada: timestamp(),
      estatus_operativo: str(),
      estatus_administrativo: str(),
      estatus_pago_operador: str(),
      fecha_pago_operador: timestamp(true),
      cantidad_pasajeros: int(),
      km_recorridos: num(),
      importe_cliente: num(),
      importe_operador: num(),
      notas: text(),
      created_at: timestamp(true),
      updated_at: timestamp(true),
      updated_by_id: int(true),
      modification_count: { type: "integer", default: 0 },
    },
    {
      cliente: belongsTo("clientes", "cliente_id"),
      ruta_ref: belongsTo("rutas", "ruta_id"),
      modo_ref: belongsTo("modos_servicio", "modo_servicio_id", true),
      tarifa: belongsTo("tarifas_cliente", "tarifa_id", true),
      chofer: belongsTo("choferes", "chofer_id"),
      vehiculo: belongsTo("vehiculos", "vehiculo_id"),
      programador: belongsTo("usuarios", "programado_por_id", true),
      editor: belongsTo("usuarios", "updated_by_id", true),
    },
  ),
  consolidaciones: schema(
    "consolidaciones",
    {
      cliente_id: int(),
      periodo_inicio: date(),
      periodo_fin: date(),
      estatus: str(),
      creado_por_id: int(),
      fecha_envio: timestamp(true),
      fecha_aprobacion: timestamp(true),
      notas: text(),
    },
    {
      cliente: belongsTo("clientes", "cliente_id"),
      creador: belongsTo("usuarios", "creado_por_id"),
    },
  ),
  facturas: schema(
    "facturas",
    {
      cliente_id: int(),
      folio: str(),
      fecha_emision: timestamp(),
      total: num(),
      estatus: str(),
    },
    { cliente: belongsTo("clientes", "cliente_id") },
  ),
  envios_ruta: schema(
    "envios_ruta",
    {
      servicio_id: int(),
      chofer_id: int(),
      canal: str(),
      destino: str(),
      fecha_hora: timestamp(),
      estatus: str(),
    },
    {
      servicio: belongsTo("servicios", "servicio_id"),
      chofer: belongsTo("choferes", "chofer_id"),
    },
  ),
};

module.exports = { schemas };
