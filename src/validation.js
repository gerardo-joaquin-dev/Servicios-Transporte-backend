const { z } = require("zod");

const name = z.string().trim().min(1).max(255);
const optionalText = z.string().max(5000).default("");
const phone = z.string().trim().max(30);
const email = z
  .email()
  .max(255)
  .transform((value) => value.toLowerCase());
const id = z.number().int().positive();
const maybeId = id.nullish().transform((value) => value ?? null);
const ids = z
  .array(id)
  .refine((list) => new Set(list).size === list.length, "IDs duplicados");
const amount = z.number().finite().min(0);
const calendarDate = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });
const httpUrl = z
  .url()
  .refine(
    (value) => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } },
    "El enlace debe usar HTTP o HTTPS",
  );
const status = (values) => z.enum(values);
const active = z.boolean();

const client = z.object({
  tenant_id: maybeId.optional(),
  razon_social: name,
  rfc_tax_id: z.string().trim().max(32),
  telefono: phone,
  correo: z.union([email, z.literal("")]),
  direccion: optionalText,
  pais: name,
  estado: name,
  ciudad: name,
  codigo_postal: z.string().trim().max(20),
  activo: active,
});
const driver = z.object({
  propietario_cliente_id: maybeId.optional(),
  nombre_completo: name,
  telefono: phone,
  numero_licencia: name,
  tipo_licencia: name,
  vencimiento_licencia: calendarDate,
  estatus: status([
    "ACTIVO",
    "INACTIVO",
    "BAJA",
    "SUSPENDIDO",
    "INCAPACIDAD",
    "VACACIONES",
  ]),
});
const vehicle = z.object({
  propietario_cliente_id: maybeId.optional(),
  chofer_predeterminado_id: maybeId,
  tipo: name,
  marca: name,
  modelo: name,
  color: z.string().max(255),
  placas: name,
  numero_poliza_seguro: z.string().max(255),
  vencimiento_poliza: calendarDate,
  estatus: status(["ACTIVO", "INACTIVO", "SINIESTRO", "MANTENIMIENTO"]),
  capacidad: z.number().int().positive(),
});
const zone = z.object({
  propietario_cliente_id: maybeId.optional(),
  nombre: name,
  descripcion: optionalText,
  activo: active,
});
const location = z.object({
  zona_id: id,
  cliente_id: maybeId,
  nombre: name,
  direccion: optionalText,
  ciudad: z.string().max(255),
  estado: z.string().max(255).optional(),
  pais: z.string().max(255).optional(),
  codigo_postal: z.string().max(20).optional(),
  tipo: status(["PARADA", "CLIENTE", "OTRO"]),
  latitud: z.number().min(-90).max(90).nullable(),
  longitud: z.number().min(-180).max(180).nullable(),
  activo: active,
});
const passenger = z.object({
  cliente_id: id,
  nombre_completo: name,
  telefono: phone,
  activo: active,
});
const route = z.object({
  propietario_cliente_id: maybeId.optional(),
  zona_id: id,
  nombre: name,
  kilometros_estimados: amount,
  duracion_estimada_min: z.number().int().min(0),
  locacion_ids: ids.min(2),
  pasajero_ids: ids.optional().default([]),
  cliente_ids: ids.min(1),
  modo_servicio_ids: ids.optional().default([]),
  registra_pasajeros: z.boolean().optional().default(false),
  link_maps: z
    .union([httpUrl, z.literal("")])
    .optional()
    .default(""),
  activo: active,
});
const rate = z.object({
  cliente_id: id,
  ruta_id: id,
  zona_id: id,
  tipo_cobro: status(["FIJO", "POR_KILOMETRO", "POR_PASAJERO"]),
  importe: amount.positive(),
  tarifa_base: amount.optional().default(0),
  costo_por_kilometro: amount.optional().default(0),
  costo_por_pasajero: amount.optional().default(0),
  pago_operador: amount.optional().default(0),
  vigente_desde: calendarDate,
  activo: active,
  usuario_creacion: z.string().max(255).optional(),
});
const mode = z.object({
  nombre: name,
  descripcion: optionalText,
  cliente_ids: ids.min(1),
  activo: active,
});
const user = z
  .object({
    tenant_id: maybeId.optional(),
    cliente_id: maybeId,
    nombre_completo: name,
    correo: email,
    rol: status(["ADMINISTRADOR", "PROGRAMADOR_DESPACHADOR"]),
    activo: active,
    password: z.string().min(12).max(128).optional(),
  })
  .refine(
    (value) => value.rol === "ADMINISTRADOR" || value.cliente_id !== null,
    {
      message: "El despachador debe pertenecer a una empresa",
      path: ["cliente_id"],
    },
  );
const service = z.object({
  cliente_id: id,
  ruta_id: id,
  modo: status(["ENTRADA", "SALIDA", "ENTRADA_Y_SALIDA", "ESPECIAL"]),
  modo_servicio_id: id.nullish(),
  tarifa_id: id.nullish(),
  chofer_id: id,
  vehiculo_id: id,
  fecha_hora_programada: dateTime,
  estatus_operativo: status([
    "PROGRAMADO",
    "EN_RUTA",
    "FINALIZADO",
    "CANCELADO",
  ]).optional().default("PROGRAMADO"),
  cantidad_pasajeros: z.number().int().min(0),
  pasajero_ids: ids.optional().default([]),
  importe_cliente: amount.optional().default(0),
  importe_operador: amount.optional().default(0),
  notas: optionalText,
});

const resourceSchemas = {
  clientes: client,
  choferes: driver,
  vehiculos: vehicle,
  zonas: zone,
  locaciones: location,
  pasajeros: passenger,
  rutas: route,
  tarifas_cliente: rate,
  modos_servicio: mode,
  usuarios: user,
};

module.exports = { z, id, ids, dateTime, resourceSchemas, service, status };
