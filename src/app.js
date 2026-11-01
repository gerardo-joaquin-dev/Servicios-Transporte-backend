const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ZodError } = require("zod");
const { dataSource } = require("./db/data-source");
const { required } = require("./config");
const { repo, bad, getData, scopeData } = require("./services/data");
const {
  saveResource,
  deleteResource,
  saveVehicleTypes,
  adminOnly,
} = require("./services/resources");
const transport = require("./services/transport");

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY)
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(helmet());
const origins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim());
app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || origins.includes(origin));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32)
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres");

const roleFor = (user) =>
  !user.cliente_id && user.rol === "ADMINISTRADOR"
    ? "PLATFORM_ADMIN"
    : user.rol === "ADMINISTRADOR"
      ? "COMPANY_ADMIN"
      : "DISPATCHER";
const publicUser = (user) => ({
  id: user.id,
  nombre_completo: user.nombre_completo,
  correo: user.correo,
  role: roleFor(user),
  cliente_id: user.cliente_id,
});

app.get("/health", async (_req, res) => {
  await dataSource.query("SELECT 1");
  res.json({ status: "ok" });
});
app.post("/api/auth/login", loginLimit, async (req, res) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) throw bad("Correo y contraseña obligatorios");
  const user = await repo(dataSource.manager, "usuarios")
    .createQueryBuilder("user")
    .where("lower(user.correo) = :email", { email })
    .getOne();
  const company = user?.cliente_id
    ? await repo(dataSource.manager, "clientes").findOneBy({
        id: user.cliente_id,
      })
    : null;
  if (
    !user ||
    !user.activo ||
    (user.cliente_id && !company?.activo) ||
    (!user.cliente_id && user.rol !== "ADMINISTRADOR") ||
    !user.password_hash ||
    !(await bcrypt.compare(password, user.password_hash))
  )
    throw bad("El correo o la contraseña no coinciden", 401);
  const token = jwt.sign(
    { sub: String(user.id), ver: user.token_version },
    jwtSecret,
    { algorithm: "HS256", expiresIn: "8h", issuer: "flotnix" },
  );
  res.json({
    token,
    user: publicUser(user),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  });
});

async function authenticate(req, _res, next) {
  try {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || "");
    if (!match) throw bad("Inicia sesión para continuar", 401);
    const payload = jwt.verify(match[1], jwtSecret, {
      algorithms: ["HS256"],
      issuer: "flotnix",
    });
    const user = await repo(dataSource.manager, "usuarios").findOneBy({
      id: Number(payload.sub),
    });
    const company = user?.cliente_id
      ? await repo(dataSource.manager, "clientes").findOneBy({
          id: user.cliente_id,
        })
      : null;
    if (
      !user ||
      !user.activo ||
      (user.cliente_id && !company?.activo) ||
      (!user.cliente_id && user.rol !== "ADMINISTRADOR") ||
      user.token_version !== payload.ver
    )
      throw bad("La sesión ya no es válida", 401);
    req.user = user;
    next();
  } catch (error) {
    next(
      error instanceof jwt.JsonWebTokenError ||
        error instanceof jwt.TokenExpiredError
        ? bad("La sesión expiró", 401)
        : error,
    );
  }
}

app.use("/api", authenticate);
app.get("/api/auth/me", (req, res) => res.json(publicUser(req.user)));
app.post("/api/auth/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (
    typeof newPassword !== "string" ||
    newPassword.length < 12 ||
    newPassword.length > 128
  )
    throw bad("La nueva contraseña debe tener entre 12 y 128 caracteres");
  if (
    !(await bcrypt.compare(currentPassword || "", req.user.password_hash || ""))
  )
    throw bad("Contraseña actual incorrecta", 401);
  await dataSource.transaction(async (manager) => {
    const user = await repo(manager, "usuarios").findOneBy({ id: req.user.id });
    user.password_hash = await bcrypt.hash(newPassword, 12);
    user.token_version += 1;
    await repo(manager, "usuarios").save(user);
  });
  res.status(204).send();
});
app.get("/api/data", async (req, res) =>
  res.json(scopeData(await getData(dataSource.manager), req.user)),
);

const resources = {
  clientes: "clientes",
  choferes: "choferes",
  vehiculos: "vehiculos",
  zonas: "zonas",
  locaciones: "locaciones",
  pasajeros: "pasajeros",
  rutas: "rutas",
  "tarifas-cliente": "tarifas_cliente",
  "modos-servicio": "modos_servicio",
  usuarios: "usuarios",
};
for (const [path, table] of Object.entries(resources)) {
  app.post(`/api/${path}`, async (req, res) =>
    res
      .status(201)
      .json(
        await dataSource.transaction((manager) =>
          saveResource(manager, table, req.body, null, req.user),
        ),
      ),
  );
  app.put(`/api/${path}/:id`, async (req, res) =>
    res.json(
      await dataSource.transaction((manager) =>
        saveResource(manager, table, req.body, Number(req.params.id), req.user),
      ),
    ),
  );
  app.delete(`/api/${path}/:id`, async (req, res) => {
    await dataSource.transaction((manager) =>
      deleteResource(manager, table, Number(req.params.id), req.user),
    );
    res.status(204).send();
  });
}
app.put("/api/tipos-unidad", async (req, res) => {
  await dataSource.transaction((manager) =>
    saveVehicleTypes(manager, req.body?.tipos_unidad, req.user),
  );
  res.status(204).send();
});

function dictionaryInput(body) {
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
  const valores = body?.valores;
  if (!nombre || nombre.length > 100) throw bad("El nombre del diccionario debe tener entre 1 y 100 caracteres", 422);
  if (nombre.toLocaleLowerCase("es") === "tipos de unidad") throw bad("Ese diccionario ya existe", 409);
  if (!Array.isArray(valores) || valores.length > 200 || valores.some((value) => typeof value !== "string" || !value.trim() || value.trim().length > 100)) throw bad("Los valores deben ser textos de 1 a 100 caracteres", 422);
  const clean = valores.map((value) => value.trim());
  if (new Set(clean.map((value) => value.toLocaleLowerCase("es"))).size !== clean.length) throw bad("Los valores del diccionario no pueden repetirse", 422);
  return { nombre, valores: clean };
}
function requirePlatform(user) {
  adminOnly(user);
  if (user.cliente_id) throw bad("Acceso reservado al administrador de la plataforma", 403);
}
app.post("/api/diccionarios", async (req, res) => {
  requirePlatform(req.user);
  const input = dictionaryInput(req.body);
  const result = await repo(dataSource.manager, "diccionarios").save(input);
  res.status(201).json(result);
});
app.put("/api/diccionarios/:id", async (req, res) => {
  requirePlatform(req.user);
  const item = await repo(dataSource.manager, "diccionarios").findOneBy({ id: Number(req.params.id) });
  if (!item) throw bad("Diccionario no encontrado", 404);
  res.json(await repo(dataSource.manager, "diccionarios").save({ ...item, ...dictionaryInput(req.body) }));
});
app.delete("/api/diccionarios/:id", async (req, res) => {
  requirePlatform(req.user);
  const result = await repo(dataSource.manager, "diccionarios").delete(Number(req.params.id));
  if (!result.affected) throw bad("Diccionario no encontrado", 404);
  res.status(204).send();
});

app.post("/api/servicios", async (req, res) =>
  res
    .status(201)
    .json(
      await dataSource.transaction((manager) =>
        transport.saveService(manager, req.body, null, req.user),
      ),
    ),
);
app.put("/api/servicios/:id", async (req, res) =>
  res.json(
    await dataSource.transaction((manager) =>
      transport.saveService(manager, req.body, Number(req.params.id), req.user),
    ),
  ),
);
app.patch("/api/servicios/:id/estatus", async (req, res) =>
  res.json(
    await dataSource.transaction((manager) =>
      transport.updateServiceStatus(
        manager,
        Number(req.params.id),
        req.body?.status,
        req.user,
      ),
    ),
  ),
);
app.post("/api/servicios/:id/reabrir", async (req, res) =>
  res.json(
    await dataSource.transaction((manager) =>
      transport.reopenRejectedService(manager, Number(req.params.id), req.user),
    ),
  ),
);
app.post("/api/servicios/:id/envios", async (req, res) =>
  res
    .status(201)
    .json(
      await dataSource.transaction((manager) =>
        transport.sendRoute(
          manager,
          Number(req.params.id),
          req.body?.channel,
          req.user,
        ),
      ),
    ),
);
app.post("/api/servicios/:id/pagar-operador", async (req, res) => {
  await dataSource.transaction((manager) =>
    transport.payOperator(manager, Number(req.params.id), req.user),
  );
  res.status(204).send();
});
app.post("/api/pagos-operadores/lote", async (req, res) => {
  await dataSource.transaction((manager) =>
    transport.payAllOperators(manager, req.body?.serviceIds, req.user),
  );
  res.status(204).send();
});
app.post("/api/consolidaciones", async (req, res) =>
  res
    .status(201)
    .json(
      await dataSource.transaction((manager) =>
        transport.createConsolidation(manager, req.body, req.user),
      ),
    ),
);
app.post("/api/consolidaciones/:id/advance", async (req, res) => {
  await dataSource.transaction((manager) =>
    transport.advanceConsolidation(
      manager,
      Number(req.params.id),
      req.body?.action,
      req.body?.serviceIds,
      req.user,
    ),
  );
  res.status(204).send();
});
app.post("/api/consolidaciones/:id/facturas", async (req, res) =>
  res
    .status(201)
    .json(
      await dataSource.transaction((manager) =>
        transport.createInvoice(
          manager,
          Number(req.params.id),
          req.body?.serviceIds,
          req.user,
        ),
      ),
    ),
);
app.post("/api/facturas/:id/advance", async (req, res) => {
  await dataSource.transaction((manager) =>
    transport.advanceInvoice(
      manager,
      Number(req.params.id),
      req.body?.action,
      req.body?.serviceIds,
      req.user,
    ),
  );
  res.status(204).send();
});

app.use((_req, _res, next) => next(bad("Ruta no encontrada", 404)));
app.use((error, _req, res, _next) => {
  if (error instanceof ZodError)
    return res.status(422).json({
      error: "Datos inválidos",
      details: error.issues.map((item) => ({
        field: item.path.join("."),
        message: item.message,
      })),
    });
  if (error.code === "23505") {
    const duplicateFields = {
      uq_clientes_rfc: "rfc_tax_id", uq_clientes_correo: "correo", uq_usuarios_correo: "correo",
      uq_choferes_licencia: "numero_licencia", uq_vehiculos_placas: "placas",
      uq_rutas_zona_nombre: "nombre", uq_tipos_unidad_nombre_ci: "tipos_unidad",
      uq_diccionarios_nombre_ci: "nombre",
    };
    const field = duplicateFields[error.constraint];
    return res.status(409).json({ error: "Ya existe un registro con esos datos", details: field ? [{ field, message: "Este valor ya está registrado" }] : [] });
  }
  if (error.code === "23503")
    return res.status(409).json({
      error:
        "El registro está relacionado con otros datos o falta una referencia válida",
    });
  if (
    error.code === "23514" ||
    error.code === "23502" ||
    error.code === "22P02"
  )
    return res
      .status(422)
      .json({ error: "Los datos no cumplen las validaciones de la base" });
  if (error.status)
    return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor" });
});

module.exports = { app };
