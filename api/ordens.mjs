import { setCors, handleOptions, getAuth, getBody, getSQL, initDB } from "./_lib/db.mjs";

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  if (req.method === "GET") {
    try {
      const rows = await sql`
        WITH progresso AS (
          SELECT
            o.id,
            o.celula, o.ref_cod, o.quantidade, o.meta_hora,
            o.horas_por_turno::float AS horas_por_turno,
            o.data_prevista, o.obs, o.criado_por, o.criado_em,
            r.descricao,
            COALESCE(SUM(l.realizado), 0)::int AS total_realizado
          FROM ordens_producao o
          JOIN referencias r ON r.cod = o.ref_cod
          LEFT JOIN lancamentos l ON l.ref_cod = o.ref_cod AND l.criado_em >= o.criado_em
          WHERE o.ativo = true
          GROUP BY o.id, o.celula, o.ref_cod, o.quantidade, o.meta_hora,
            o.horas_por_turno, o.data_prevista, o.obs, o.criado_por, o.criado_em, r.descricao
        )
        SELECT *,
          CASE
            WHEN total_realizado = 0             THEN 'pendente'
            WHEN total_realizado >= quantidade   THEN 'concluida'
            ELSE 'em_andamento'
          END AS status
        FROM progresso
        ORDER BY
          CASE
            WHEN total_realizado = 0           THEN 0
            WHEN total_realizado < quantidade  THEN 1
            ELSE 2
          END,
          criado_em DESC`;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { celula, ref_cod, quantidade, meta_hora, horas_por_turno, data_prevista, obs } = getBody(req);
    if (!celula || !ref_cod || !quantidade || !meta_hora)
      return res.status(400).json({ error: "celula, ref_cod, quantidade e meta_hora são obrigatórios" });
    try {
      const row = await sql`
        INSERT INTO ordens_producao (celula, ref_cod, quantidade, meta_hora, horas_por_turno, data_prevista, obs, criado_por)
        VALUES (${celula}, ${ref_cod.toUpperCase()}, ${quantidade}, ${meta_hora},
                ${horas_por_turno || 8}, ${data_prevista || null}, ${obs || ""}, ${u.login})
        RETURNING id`;
      return res.status(200).json({ ok: true, id: row[0].id });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { id } = getBody(req);
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    try {
      await sql`UPDATE ordens_producao SET ativo = false WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
