require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env`);
  return value;
}

module.exports = { required, port: Number(process.env.PORT || 4000) };
