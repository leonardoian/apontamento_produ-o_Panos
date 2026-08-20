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
    const { mes, turno, ref, celula } = req.query || {};
    try {
      let rows;
      const todas = !celula || celula === "TODAS";

      if (mes && turno && ref) {
        rows = todas
          ? await sql`SELECT l.* FROM lancamentos l WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes} AND l.turno = ${turno} AND l.ref_cod = ${ref} ORDER BY l.data DESC, l.criado_em DESC`
          : await sql`SELECT l.* FROM lancamentos l WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes} AND l.turno = ${turno} AND l.ref_cod = ${ref} AND l.ref_cod IN (SELECT cod FROM referencias WHERE celula = ${celula} AND ativo = true) ORDER BY l.data DESC, l.criado_em DESC`;
      } else if (mes && turno) {
        rows = todas
          ? await sql`SELECT l.* FROM lancamentos l WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes} AND l.turno = ${turno} ORDER BY l.data DESC, l.criado_em DESC`
          : await sql`SELECT l.* FROM lancamentos l WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes} AND l.turno = ${turno} AND l.ref_cod IN (SELECT cod FROM referencias WHERE celula = ${celula} AND ativo = true) ORDER BY l.data DESC, l.criado_em DESC`;
      } else if (mes) {
        rows = todas
          ? await sql`SELECT l.* FROM lancamentos l WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes} ORDER BY l.data DESC, l.criado_em DESC`
          : await sql`SELECT l.* FROM lancamentos l WHERE TO_CHAR(l.data,'YYYY-MM') = ${mes} AND l.ref_cod IN (SELECT cod FROM referencias WHERE celula = ${celula} AND ativo = true) ORDER BY l.data DESC, l.criado_em DESC`;
      } else {
        rows = todas
          ? await sql`SELECT l.* FROM lancamentos l ORDER BY l.criado_em DESC LIMIT 100`
          : await sql`SELECT l.* FROM lancamentos l WHERE l.ref_cod IN (SELECT ref_cod FROM programa WHERE celula = ${celula}) ORDER BY l.criado_em DESC LIMIT 100`;
      }
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { data, turno, ref_cod, descricao, operador, realizado, meta, refugo, hora_inicio, hora_fim, obs, eficiencia } = getBody(req);
    if (!data || !turno || !ref_cod) return res.status(400).json({ error: "data, turno e ref_cod obrigatórios" });
    // Se eficiência foi enviada do frontend, usa esse valor. Caso contrário, calcula como fallback
    const efic = eficiencia !== undefined && eficiencia !== null ? eficiencia : (meta > 0 ? (realizado / meta).toFixed(4) : null);
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

  if (req.method === "PUT") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { id, data, turno, realizado, refugo, hora_inicio, hora_fim, obs, eficiencia } = getBody(req);
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    const efic = eficiencia !== undefined && eficiencia !== null ? eficiencia : null;
    try {
      await sql`UPDATE lancamentos SET
        data = ${data}, turno = ${turno}, realizado = ${realizado || 0},
        refugo = ${refugo || 0}, hora_inicio = ${hora_inicio || ""},
        hora_fim = ${hora_fim || ""}, obs = ${obs || ""},
        eficiencia = ${efic}
        WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
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
