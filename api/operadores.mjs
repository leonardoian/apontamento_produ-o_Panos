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
    let rows;
    if (celula) {
      rows = await sql`
        SELECT
          operador,
          COUNT(*)::int                                                           AS total_lancamentos,
          COALESCE(SUM(realizado),0)::int                                         AS total_realizado,
          COALESCE(SUM(refugo),0)::int                                            AS total_refugo,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4)          AS efic_media,
          COALESCE(SUM(CASE WHEN turno='T1' THEN realizado ELSE 0 END),0)::int    AS real_t1,
          COALESCE(SUM(CASE WHEN turno='T2' THEN realizado ELSE 0 END),0)::int    AS real_t2,
          COUNT(CASE WHEN turno='T1' THEN 1 END)::int                             AS lanc_t1,
          COUNT(CASE WHEN turno='T2' THEN 1 END)::int                             AS lanc_t2
        FROM lancamentos
        WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
          AND operador IS NOT NULL AND operador != ''
          AND ref_cod IN (
            SELECT ref_cod FROM programa WHERE mes_ano = ${mes} AND celula = ${celula}
          )
        GROUP BY operador
        ORDER BY total_realizado DESC`;
    } else {
      rows = await sql`
        SELECT
          operador,
          COUNT(*)::int                                                           AS total_lancamentos,
          COALESCE(SUM(realizado),0)::int                                         AS total_realizado,
          COALESCE(SUM(refugo),0)::int                                            AS total_refugo,
          ROUND(AVG(CASE WHEN meta > 0 THEN eficiencia END)::numeric, 4)          AS efic_media,
          COALESCE(SUM(CASE WHEN turno='T1' THEN realizado ELSE 0 END),0)::int    AS real_t1,
          COALESCE(SUM(CASE WHEN turno='T2' THEN realizado ELSE 0 END),0)::int    AS real_t2,
          COUNT(CASE WHEN turno='T1' THEN 1 END)::int                             AS lanc_t1,
          COUNT(CASE WHEN turno='T2' THEN 1 END)::int                             AS lanc_t2
        FROM lancamentos
        WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
          AND operador IS NOT NULL AND operador != ''
        GROUP BY operador
        ORDER BY total_realizado DESC`;
    }

    return res.status(200).json(rows);
  } catch (e) {
    return res.status(500).json({ error: "Erro operadores: " + e.message });
  }
}
