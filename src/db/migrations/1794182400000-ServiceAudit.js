class ServiceAudit1794182400000 {
  name = "ServiceAudit1794182400000";

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE servicios
      ADD COLUMN created_at TIMESTAMPTZ,
      ADD COLUMN updated_at TIMESTAMPTZ,
      ADD COLUMN updated_by_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
      ADD COLUMN modification_count INTEGER NOT NULL DEFAULT 0`);
    await queryRunner.query("ALTER TABLE servicios ALTER COLUMN created_at SET DEFAULT now()");
    await queryRunner.query(`CREATE TABLE servicio_auditoria (
      id BIGSERIAL PRIMARY KEY,
      servicio_id INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
      usuario_nombre VARCHAR(255),
      fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('CREACION', 'MODIFICACION')),
      cambios JSONB NOT NULL DEFAULT '{}'::jsonb
    )`);
    await queryRunner.query(`CREATE INDEX ix_servicio_auditoria_servicio_fecha ON servicio_auditoria (servicio_id, fecha DESC, id DESC)`);
    await queryRunner.query(`CREATE FUNCTION audit_service_change() RETURNS trigger AS $$
    DECLARE actor INTEGER; actor_name VARCHAR(255); differences JSONB;
    BEGIN
      actor := NULLIF(current_setting('app.user_id', true), '')::INTEGER;
      IF actor IS NOT NULL THEN
        SELECT nombre_completo INTO actor_name FROM usuarios WHERE id = actor;
      END IF;
      IF TG_OP = 'INSERT' THEN
        INSERT INTO servicio_auditoria (servicio_id, cliente_id, usuario_id, usuario_nombre, fecha, tipo, cambios)
        VALUES (NEW.id, NEW.cliente_id, COALESCE(actor, NEW.programado_por_id),
          COALESCE(actor_name, (SELECT nombre_completo FROM usuarios WHERE id = NEW.programado_por_id)),
          COALESCE(NEW.created_at, now()), 'CREACION', '{}'::jsonb);
        RETURN NEW;
      END IF;
      IF OLD.codigo LIKE 'TMP-%' AND NEW.codigo LIKE 'SERV-%' THEN RETURN NEW; END IF;
      SELECT COALESCE(jsonb_object_agg(n.key, jsonb_build_object('anterior', o.value, 'nuevo', n.value)), '{}'::jsonb)
        INTO differences
        FROM jsonb_each(to_jsonb(NEW) - ARRAY['id','codigo','created_at','updated_at','updated_by_id','modification_count']) n
        JOIN jsonb_each(to_jsonb(OLD) - ARRAY['id','codigo','created_at','updated_at','updated_by_id','modification_count']) o USING (key)
        WHERE n.value IS DISTINCT FROM o.value;
      IF differences <> '{}'::jsonb THEN
        NEW.updated_at := now();
        NEW.updated_by_id := actor;
        NEW.modification_count := OLD.modification_count + 1;
        INSERT INTO servicio_auditoria (servicio_id, cliente_id, usuario_id, usuario_nombre, tipo, cambios)
        VALUES (NEW.id, NEW.cliente_id, actor, actor_name, 'MODIFICACION', differences);
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER tr_servicios_audit_insert AFTER INSERT ON servicios FOR EACH ROW EXECUTE FUNCTION audit_service_change()`);
    await queryRunner.query(`CREATE TRIGGER tr_servicios_audit_update BEFORE UPDATE ON servicios FOR EACH ROW EXECUTE FUNCTION audit_service_change()`);
  }

  async down(queryRunner) {
    await queryRunner.query("DROP TRIGGER tr_servicios_audit_update ON servicios");
    await queryRunner.query("DROP TRIGGER tr_servicios_audit_insert ON servicios");
    await queryRunner.query("DROP FUNCTION audit_service_change()");
    await queryRunner.query("DROP TABLE servicio_auditoria");
    await queryRunner.query("ALTER TABLE servicios DROP COLUMN modification_count, DROP COLUMN updated_by_id, DROP COLUMN updated_at, DROP COLUMN created_at");
  }
}

module.exports = { ServiceAudit1794182400000 };
