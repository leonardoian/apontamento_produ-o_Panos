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
        WITH ultimo_usuario AS (
          SELECT DISTINCT ON (operador)
            operador, usuario_login
          FROM lancamentos
          WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
            AND operador IS NOT NULL AND operador != ''
            AND ref_cod IN (
              SELECT ref_cod FROM programa WHERE mes_ano = ${mes} AND celula = ${celula}
            )
          ORDER BY operador, criado_em DESC
        )
        SELECT
          l.operador,
          uu.usuario_login,
          u.nome                                                                      AS nome_usuario,
          COUNT(l.*)::int                                                             AS total_lancamentos,
          COALESCE(SUM(l.realizado),0)::int                                           AS total_realizado,
          COALESCE(SUM(l.refugo),0)::int                                              AS total_refugo,
          ROUND(AVG(CASE WHEN l.meta > 0 THEN l.eficiencia END)::numeric, 4)         AS efic_media,
          COALESCE(SUM(CASE WHEN l.turno='T1' THEN l.realizado ELSE 0 END),0)::int   AS real_t1,
          COALESCE(SUM(CASE WHEN l.turno='T2' THEN l.realizado ELSE 0 END),0)::int   AS real_t2,
          COUNT(CASE WHEN l.turno='T1' THEN 1 END)::int                              AS lanc_t1,
          COUNT(CASE WHEN l.turno='T2' THEN 1 END)::int                              AS lanc_t2
        FROM lancamentos l
        LEFT JOIN ultimo_usuario uu ON uu.operador = l.operador
        LEFT JOIN usuarios u ON u.login = uu.usuario_login
        WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes}
          AND l.operador IS NOT NULL AND l.operador != ''
          AND l.ref_cod IN (
            SELECT ref_cod FROM programa WHERE mes_ano = ${mes} AND celula = ${celula}
          )
        GROUP BY l.operador, uu.usuario_login, u.nome
        ORDER BY total_realizado DESC`;
    } else {
      rows = await sql`
        WITH ultimo_usuario AS (
          SELECT DISTINCT ON (operador)
            operador, usuario_login
          FROM lancamentos
          WHERE TO_CHAR(data,'YYYY-MM') = ${mes}
            AND operador IS NOT NULL AND operador != ''
          ORDER BY operador, criado_em DESC
        )
        SELECT
          l.operador,
          uu.usuario_login,
          u.nome                                                                      AS nome_usuario,
          COUNT(l.*)::int                                                             AS total_lancamentos,
          COALESCE(SUM(l.realizado),0)::int                                           AS total_realizado,
          COALESCE(SUM(l.refugo),0)::int                                              AS total_refugo,
          ROUND(AVG(CASE WHEN l.meta > 0 THEN l.eficiencia END)::numeric, 4)         AS efic_media,
          COALESCE(SUM(CASE WHEN l.turno='T1' THEN l.realizado ELSE 0 END),0)::int   AS real_t1,
          COALESCE(SUM(CASE WHEN l.turno='T2' THEN l.realizado ELSE 0 END),0)::int   AS real_t2,
          COUNT(CASE WHEN l.turno='T1' THEN 1 END)::int                              AS lanc_t1,
          COUNT(CASE WHEN l.turno='T2' THEN 1 END)::int                              AS lanc_t2
        FROM lancamentos l
        LEFT JOIN ultimo_usuario uu ON uu.operador = l.operador
        LEFT JOIN usuarios u ON u.login = uu.usuario_login
        WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes}
          AND l.operador IS NOT NULL AND l.operador != ''
        GROUP BY l.operador, uu.usuario_login, u.nome
        ORDER BY total_realizado DESC`;
    }

    return res.status(200).json(rows);
  } catch (e) {
    return res.status(500).json({ error: "Erro operadores: " + e.message });
  }
}
