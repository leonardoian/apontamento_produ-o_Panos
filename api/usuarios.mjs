import { setCors, handleOptions, getAuth, getBody, getSQL, initDB, bcrypt } from "./_lib/db.mjs";


export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  // Consolidado por ?recurso= para caber no limite de 12 Serverless Functions
  // do plano Hobby da Vercel. `me` e `senha` são do próprio usuário e NÃO
  // podem exigir admin — só o CRUD de usuários exige.
  const recurso = req.query?.recurso || "";

  if (recurso === "me") {
    if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });
    return res.status(200).json(u);
  }

  if (recurso === "senha") return trocarSenha(req, res, sql, u);

  if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });

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

// Antes em api/senha.mjs — consolidado aqui como ?recurso=senha.
// Admin redefine a senha de outro usuário sem exigir a atual; o próprio
// usuário precisa informar e acertar a senha atual.
async function trocarSenha(req, res, sql, u) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });
  const { login, senha_atual, nova_senha } = getBody(req);

  if (!nova_senha || nova_senha.length < 6)
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres" });

  // Admin redefinindo senha de outro usuário (não exige senha_atual)
  if (login && login !== u.login) {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    try {
      const hash = await bcrypt.hash(nova_senha, 10);
      await sql`UPDATE usuarios SET senha_hash = ${hash} WHERE login = ${login} AND ativo = true`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Usuário alterando a própria senha (exige senha_atual)
  if (!senha_atual) return res.status(400).json({ error: "Informe a senha atual" });
  try {
    const rows = await sql`SELECT senha_hash FROM usuarios WHERE login = ${u.login} AND ativo = true LIMIT 1`;
    if (!rows.length) return res.status(404).json({ error: "Usuário não encontrado" });
    const ok = await bcrypt.compare(senha_atual, rows[0].senha_hash);
    if (!ok) return res.status(401).json({ error: "Senha atual incorreta" });
    const hash = await bcrypt.hash(nova_senha, 10);
    await sql`UPDATE usuarios SET senha_hash = ${hash} WHERE login = ${u.login}`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
