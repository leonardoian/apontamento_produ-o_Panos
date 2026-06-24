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
      const rows = await sql`SELECT cod, descricao, meta_hora FROM referencias WHERE ativo = true ORDER BY cod`;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { cod, descricao, meta_hora } = getBody(req);
    if (!cod || !descricao) return res.status(400).json({ error: "cod e descricao obrigatórios" });
    try {
      await sql`INSERT INTO referencias (cod, descricao, meta_hora) VALUES (${cod.toUpperCase()}, ${descricao}, ${meta_hora || null})
        ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao, meta_hora = EXCLUDED.meta_hora, ativo = true`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { cod } = getBody(req);
    try {
      await sql`UPDATE referencias SET ativo = false WHERE cod = ${cod}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
