import { setCors, handleOptions, getAuth, getBody, getSQL, initDB, bcrypt } from "./_lib/db.mjs";

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const u = getAuth(req);
  if (!u || u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  if (req.method === "GET") {
    try {
      const rows = await sql`SELECT id, login, nome, perfil, ativo FROM usuarios ORDER BY id`;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { login, senha, nome, perfil } = getBody(req);
    if (!login || !senha || !nome) return res.status(400).json({ error: "Campos obrigatórios" });
    try {
      const hash = await bcrypt.hash(senha, 10);
      await sql`INSERT INTO usuarios (login, senha_hash, nome, perfil)
        VALUES (${login}, ${hash}, ${nome}, ${perfil || "operador"})`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    const { login } = getBody(req);
    if (login === "admin") return res.status(400).json({ error: "Não pode remover o admin" });
    try {
      await sql`UPDATE usuarios SET ativo = false WHERE login = ${login}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
