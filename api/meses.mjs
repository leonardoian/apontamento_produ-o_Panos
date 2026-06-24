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

  try {
    const rows = await sql`SELECT DISTINCT mes_ano FROM programa WHERE ativo = true ORDER BY mes_ano DESC`;
    return res.status(200).json(rows.map(r => r.mes_ano));
  } catch (e) {
    return res.status(500).json({ error: "Erro meses: " + e.message });
  }
}
