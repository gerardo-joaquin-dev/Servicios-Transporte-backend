const { DataSource } = require("typeorm");
const { required } = require("../config");
const { schemas } = require("./schemas");
const {
  InitialSchema1761868800000,
} = require("./migrations/1761868800000-InitialSchema");
const { Dictionaries1793404800000 } = require("./migrations/1793404800000-Dictionaries");
const { ServiceAudit1794182400000 } = require("./migrations/1794182400000-ServiceAudit");

const dataSource = new DataSource({
  type: "postgres",
  url: required("DATABASE_URL"),
  entities: Object.values(schemas),
  migrations: [InitialSchema1761868800000, Dictionaries1793404800000, ServiceAudit1794182400000],
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DB_LOG === "true",
  extra: { max: Number(process.env.DB_POOL_SIZE || 10) },
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

module.exports = { dataSource };
