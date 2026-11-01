const { spawnSync } = require("node:child_process");
for (const script of ["create-database.js", "migrate.js", "seed.js"]) {
  const result = spawnSync(
    process.execPath,
    [require("node:path").join(__dirname, script)],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
