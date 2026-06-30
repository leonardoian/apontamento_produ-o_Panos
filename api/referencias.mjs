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
        SELECT r.cod, r.descricao, r.meta_hora,
          COALESCE(STRING_AGG(DISTINCT p.celula, ', ' ORDER BY p.celula), '') AS celulas
        FROM referencias r
        LEFT JOIN programa p ON p.ref_cod = r.cod AND p.ativo = true
        WHERE r.ativo = true
        GROUP BY r.cod, r.descricao, r.meta_hora
        ORDER BY r.cod`;
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
      if (meta_hora === undefined) {
        await sql`INSERT INTO referencias (cod, descricao, meta_hora) VALUES (${cod.toUpperCase()}, ${descricao}, null)
          ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao, ativo = true`;
      } else {
        await sql`INSERT INTO referencias (cod, descricao, meta_hora) VALUES (${cod.toUpperCase()}, ${descricao}, ${meta_hora})
          ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao, meta_hora = EXCLUDED.meta_hora, ativo = true`;
      }
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
