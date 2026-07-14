import { setCors, handleOptions, getAuth, getBody, getSQL, bcrypt } from "./_lib/db.mjs";

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }

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
