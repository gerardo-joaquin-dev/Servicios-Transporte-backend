const { app } = require("./app");
const { dataSource } = require("./db/data-source");
const { port } = require("./config");

async function start() {
  await dataSource.initialize();
  const server = app.listen(port, (error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
      void dataSource.destroy();
      return;
    }
    console.log(`Flotnix API escuchando en ${port}`);
  });
  const close = () =>
    server.close(() => dataSource.destroy().finally(() => process.exit(0)));
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
