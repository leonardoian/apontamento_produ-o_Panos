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
    const { mes, turno, ref } = req.query || {};
    try {
      let rows;
      if (mes && turno && ref) {
        rows = await sql`SELECT * FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes} AND turno = ${turno} AND ref_cod = ${ref} ORDER BY data DESC, criado_em DESC`;
      } else if (mes && turno) {
        rows = await sql`SELECT * FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes} AND turno = ${turno} ORDER BY data DESC, criado_em DESC`;
      } else if (mes) {
        rows = await sql`SELECT * FROM lancamentos WHERE TO_CHAR(data,'YYYY-MM') = ${mes} ORDER BY data DESC, criado_em DESC`;
      } else {
        rows = await sql`SELECT * FROM lancamentos ORDER BY criado_em DESC LIMIT 100`;
      }
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { data, turno, ref_cod, descricao, operador, realizado, meta, refugo, hora_inicio, hora_fim, obs } = getBody(req);
    if (!data || !turno || !ref_cod) return res.status(400).json({ error: "data, turno e ref_cod obrigatórios" });
    const efic = meta > 0 ? (realizado / meta).toFixed(4) : null;
    try {
      const row = await sql`INSERT INTO lancamentos
        (data, turno, ref_cod, descricao, operador, realizado, meta, refugo, eficiencia, hora_inicio, hora_fim, obs, usuario_login)
        VALUES (${data}, ${turno}, ${ref_cod}, ${descricao || ""}, ${operador || ""}, ${realizado || 0}, ${meta || 0},
                ${refugo || 0}, ${efic}, ${hora_inicio || ""}, ${hora_fim || ""}, ${obs || ""}, ${u.login})
        RETURNING id`;
      return res.status(200).json({ ok: true, id: row[0].id });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { id } = getBody(req);
    try {
      await sql`DELETE FROM lancamentos WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
