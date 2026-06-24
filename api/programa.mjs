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
    const mes = req.query?.mes || "";
    const celula = req.query?.celula || "Panos";
    try {
      const rows = mes
        ? await sql`SELECT p.id, p.mes_ano, p.ref_cod, p.celula, p.meta_turno, p.num_turnos,
            (p.meta_turno * p.num_turnos) AS meta_total, r.descricao, r.meta_hora
            FROM programa p JOIN referencias r ON r.cod = p.ref_cod
            WHERE p.mes_ano = ${mes} AND p.celula = ${celula} AND p.ativo = true ORDER BY r.cod`
        : await sql`SELECT p.id, p.mes_ano, p.ref_cod, p.celula, p.meta_turno, p.num_turnos,
            (p.meta_turno * p.num_turnos) AS meta_total, r.descricao, r.meta_hora
            FROM programa p JOIN referencias r ON r.cod = p.ref_cod
            WHERE p.celula = ${celula} AND p.ativo = true ORDER BY p.mes_ano, r.cod`;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { mes_ano, ref_cod, celula, meta_turno, num_turnos } = getBody(req);
    if (!mes_ano || !ref_cod) return res.status(400).json({ error: "mes_ano e ref_cod obrigatórios" });
    try {
      await sql`INSERT INTO programa (mes_ano, ref_cod, celula, meta_turno, num_turnos)
        VALUES (${mes_ano}, ${ref_cod.toUpperCase()}, ${celula || 'Panos'}, ${meta_turno || 0}, ${num_turnos || 2})
        ON CONFLICT (mes_ano, ref_cod, celula) DO UPDATE
        SET meta_turno = EXCLUDED.meta_turno, num_turnos = EXCLUDED.num_turnos, ativo = true`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { mes_ano, ref_cod, celula } = getBody(req);
    try {
      await sql`UPDATE programa SET ativo = false WHERE mes_ano = ${mes_ano} AND ref_cod = ${ref_cod} AND celula = ${celula || 'Panos'}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
