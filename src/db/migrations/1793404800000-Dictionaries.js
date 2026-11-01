class Dictionaries1793404800000 {
  name = "Dictionaries1793404800000";
  async up(queryRunner) {
    await queryRunner.query("CREATE TABLE diccionarios (id SERIAL PRIMARY KEY, nombre VARCHAR(100) NOT NULL, valores JSONB NOT NULL DEFAULT '[]'::jsonb, CONSTRAINT ck_diccionarios_valores_array CHECK (jsonb_typeof(valores) = 'array'))");
    await queryRunner.query("CREATE UNIQUE INDEX uq_diccionarios_nombre_ci ON diccionarios (lower(nombre))");
  }
  async down(queryRunner) {
    await queryRunner.query("DROP TABLE diccionarios");
  }
}
module.exports = { Dictionaries1793404800000 };
