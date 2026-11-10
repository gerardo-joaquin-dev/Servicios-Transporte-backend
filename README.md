# Backend de Flotnix

API de la aplicación de transporte construida con Node.js 20+, Express 5, TypeORM y PostgreSQL. El esquema se crea mediante migraciones; `synchronize` está desactivado.

## Arranque local

1. Copia `.env.example` a `.env` y cambia `JWT_SECRET` y `ADMIN_PASSWORD`. La contraseña inicial debe tener al menos 12 caracteres.
2. Inicia PostgreSQL. Puedes usar `docker compose up -d --wait postgres`; las credenciales de ejemplo coinciden con `docker-compose.yml`.
3. Ejecuta:

```bash
npm ci
npm run db:setup
npm run dev
```

`db:setup` crea la base indicada en `DATABASE_URL` si falta, aplica las migraciones y ejecuta la seed. La seed es idempotente: añade `Van`, `Autobús` y `Automóvil`, y crea el administrador configurado en `.env`. Si el usuario ya existe, conserva su contraseña. Para crear una base nueva, el usuario de `DB_ADMIN_URL` necesita permiso `CREATEDB`; si la base ya existe, ese permiso no se usa.

En un servidor con la base ya provisionada, ejecuta `npm ci --omit=dev`, `npm run db:migrate`, `npm run db:seed` y `npm start`. Configura HTTPS delante de la API, `CORS_ORIGIN` con el origen exacto de la web y secretos distintos a los del ejemplo.

## Conectar la web

En `Servicios-transporte`, define `VITE_API_URL=http://localhost:4000` (o la URL pública de la API) y vuelve a compilar la web. Sin esa variable se conserva el modo local de demostración. El inicio de sesión usa el administrador de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Los usuarios nuevos se crean desde **Usuarios y accesos** con una contraseña inicial; pueden iniciar sesión según su rol.

La información guardada previamente en `localStorage` no se traslada automáticamente a PostgreSQL. La base creada por la seed comienza sin empresas ni servicios, para registrar los datos desde la web.

Al actualizar una instalación existente, ejecuta `npm run db:migrate` antes de iniciar la nueva versión. La migración de auditoría añade fechas, contador y eventos de creación o modificación a los servicios. Los servicios anteriores conservan sus datos, pero no se les inventa un historial retroactivo.

La migración de cuentas crea `tenants` y asigna cada empresa existente a una cuenta independiente. Los usuarios de empresa conservan su acceso dentro de esa cuenta. El administrador de Flotnix crea nuevas cuentas mediante `POST /api/cuentas` y puede activarlas o desactivarlas con `PUT /api/cuentas/:id`. El administrador de cada cuenta crea empresas, administradores de cuenta, administradores de empresa y despachadores. Los administradores de empresa solo crean despachadores de su empresa. La API filtra los datos por cuenta y valida la propiedad de cada recurso en las operaciones de escritura.

## Modelo

La migración inicial incluye empresas, usuarios, tipos de unidad, operadores, unidades, zonas, paradas, pasajeros, rutas, modos de servicio, tarifas, servicios, consolidaciones, facturas y envíos de ruta. Las asociaciones de rutas con paradas ordenadas, empresas, modos y pasajeros; de servicios con pasajeros; de consolidaciones y facturas con servicios están en tablas de relación con claves foráneas. Las facturas suman `importe_cliente` sin agregar IVA.

Cada operación que cambia varias tablas se ejecuta en una transacción. Las claves foráneas impiden borrar registros usados por otros. Las validaciones comprueban importes, fechas, estados, capacidad de unidad, disponibilidad de operador y unidad, pertenencia de rutas y tarifas a empresas, y permisos por empresa.

## API

Todas las rutas salvo `POST /api/auth/login` y `GET /health` requieren `Authorization: Bearer <token>`.

| Recurso           | Rutas                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión            | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`                                                                                                                                                  |
| Datos para la web | `GET /api/data`                                                                                                                                                                                                               |
| Catálogos         | `POST`, `PUT /:id`, `DELETE /:id` en `/api/clientes`, `/api/choferes`, `/api/vehiculos`, `/api/zonas`, `/api/locaciones`, `/api/pasajeros`, `/api/rutas`, `/api/tarifas-cliente`, `/api/modos-servicio`, `/api/usuarios`      |
| Diccionario       | `PUT /api/tipos-unidad`                                                                                                                                                                                                       |
| Servicios         | `POST /api/servicios`, `PUT /api/servicios/:id`, `PATCH /api/servicios/:id/estatus`, `POST /api/servicios/:id/reabrir`, `POST /api/servicios/:id/envios`                                                                      |
| Finanzas          | `POST /api/consolidaciones`, `POST /api/consolidaciones/:id/advance`, `POST /api/consolidaciones/:id/facturas`, `POST /api/facturas/:id/advance`, `POST /api/servicios/:id/pagar-operador`, `POST /api/pagos-operadores/lote` |

El administrador de plataforma accede a todos los datos y procesos. El administrador de empresa administra su empresa, catálogos, usuarios y servicios asociados. El despachador consulta su empresa, programa servicios y registra envíos de ruta. Las finanzas y la configuración global son exclusivas del administrador de plataforma.

El administrador maestro activa o desactiva clientes desde el panel de la web. Una empresa inactiva no puede iniciar sesión ni seguir usando un token existente. La respuesta para despachadores omite tarifas, importes y auditoría; el servidor selecciona y calcula la tarifa al programar un servicio. `/api/data` incluye `servicio_auditoria` para administradores, con usuario, fecha, tipo y campos modificados.

## Verificar

```bash
npm test
```

La prueba usa PostgreSQL embebido sólo para pruebas: ejecuta la migración y recorre la autenticación, relaciones, permisos y ciclo administrativo completo. El servidor de producción usa PostgreSQL mediante `DATABASE_URL`.
