import { setCors, handleOptions, getAuth, getSQL, initDB } from "./_lib/db.mjs";

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  const mes    = req.query?.mes    || new Date().toISOString().slice(0, 7);
  const celula = req.query?.celula || null;

  try {
    let totais, prog, turnos, recentes;

    if (celula) {
      [totais] = await sql`
        SELECT
          COALESCE(SUM(realizado),0)::int AS total_realizado,
          COALESCE(SUM(refugo),0)::int    AS total_refugo,
          COUNT(*)::int                   AS total_lancamentos,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
        FROM lancamentos
        WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
          AND ref_cod IN (
            SELECT cod FROM referencias WHERE celula = ${celula} AND ativo = true
          )`;

      prog = await sql`
        SELECT cod, descricao, meta_total, realizado, refugo, num_turnos, meta_turno, sem_programa
        FROM (
          SELECT p.ref_cod AS cod, r.descricao,
            (p.meta_turno * p.num_turnos) AS meta_total,
            COALESCE(SUM(l.realizado),0)::int AS realizado,
            COALESCE(SUM(l.refugo),0)::int    AS refugo,
            p.num_turnos, p.meta_turno, false AS sem_programa
          FROM programa p
          JOIN referencias r ON r.cod = p.ref_cod
          LEFT JOIN lancamentos l ON l.ref_cod = p.ref_cod AND TO_CHAR(l.data,'YYYY-MM') = ${mes}
          WHERE p.mes_ano = ${mes} AND p.ativo = true AND p.celula = ${celula}
          GROUP BY p.id, p.ref_cod, r.cod, r.descricao, p.meta_turno, p.num_turnos
          UNION ALL
          SELECT l.ref_cod AS cod, r.descricao,
            0 AS meta_total,
            COALESCE(SUM(l.realizado),0)::int AS realizado,
            COALESCE(SUM(l.refugo),0)::int    AS refugo,
            0 AS num_turnos, 0 AS meta_turno, true AS sem_programa
          FROM lancamentos l
          JOIN referencias r ON r.cod = l.ref_cod
          WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes}
            AND r.celula = ${celula}
            AND l.ref_cod NOT IN (
              SELECT ref_cod FROM programa WHERE mes_ano = ${mes} AND ativo = true AND celula = ${celula}
            )
          GROUP BY l.ref_cod, r.descricao
        ) t
        ORDER BY sem_programa, cod`;

      turnos = await sql`
        SELECT turno,
          COALESCE(SUM(realizado),0)::int AS realizado,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
        FROM lancamentos
        WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
          AND ref_cod IN (
            SELECT cod FROM referencias WHERE celula = ${celula} AND ativo = true
          )
        GROUP BY turno ORDER BY turno`;

      recentes = await sql`
        SELECT data, turno, ref_cod, operador, realizado, eficiencia
        FROM lancamentos
        WHERE ref_cod IN (
          SELECT cod FROM referencias WHERE celula = ${celula} AND ativo = true
        )
        ORDER BY criado_em DESC LIMIT 8`;

    } else {
      [totais] = await sql`
        SELECT
          COALESCE(SUM(realizado),0)::int AS total_realizado,
          COALESCE(SUM(refugo),0)::int    AS total_refugo,
          COUNT(*)::int                   AS total_lancamentos,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
        FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes}`;

      prog = await sql`
        SELECT cod, descricao, meta_total, realizado, refugo, num_turnos, meta_turno, sem_programa
        FROM (
          SELECT p.ref_cod AS cod, r.descricao,
            (p.meta_turno * p.num_turnos) AS meta_total,
            COALESCE(SUM(l.realizado),0)::int AS realizado,
            COALESCE(SUM(l.refugo),0)::int    AS refugo,
            p.num_turnos, p.meta_turno, false AS sem_programa
          FROM programa p
          JOIN referencias r ON r.cod = p.ref_cod
          LEFT JOIN lancamentos l ON l.ref_cod = p.ref_cod AND TO_CHAR(l.data,'YYYY-MM') = ${mes}
          WHERE p.mes_ano = ${mes} AND p.ativo = true
          GROUP BY p.id, p.ref_cod, r.cod, r.descricao, p.meta_turno, p.num_turnos
          UNION ALL
          SELECT l.ref_cod AS cod, r.descricao,
            0 AS meta_total,
            COALESCE(SUM(l.realizado),0)::int AS realizado,
            COALESCE(SUM(l.refugo),0)::int    AS refugo,
            0 AS num_turnos, 0 AS meta_turno, true AS sem_programa
          FROM lancamentos l
          JOIN referencias r ON r.cod = l.ref_cod
          WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes}
            AND l.ref_cod NOT IN (
              SELECT ref_cod FROM programa WHERE mes_ano = ${mes} AND ativo = true
            )
          GROUP BY l.ref_cod, r.descricao
        ) t
        ORDER BY sem_programa, cod`;

      turnos = await sql`
        SELECT turno,
          COALESCE(SUM(realizado),0)::int AS realizado,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4) AS efic_media
        FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
        GROUP BY turno ORDER BY turno`;

      recentes = await sql`
        SELECT data, turno, ref_cod, operador, realizado, eficiencia
        FROM lancamentos ORDER BY criado_em DESC LIMIT 8`;
    }

    return res.status(200).json({ totais, prog, turnos, recentes });
  } catch (e) {
    return res.status(500).json({ error: "Erro dashboard: " + e.message });
  }
}
