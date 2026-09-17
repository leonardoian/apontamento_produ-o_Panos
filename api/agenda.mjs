import { setCors, handleOptions, getAuth, getBody, getSQL, initDB } from "./_lib/db.mjs";

// Módulo Agenda — tudo num arquivo só (?recurso=tarefas|metas|stats) para não estourar
// o limite de funções serverless da Vercel.

const PRIORIDADES = ["baixa", "media", "alta"];
const STATUS      = ["pendente", "feita", "nao_feita"];
const TIPOS       = ["tarefas", "numerica"];
const PERIODOS    = ["dia", "semana", "mes"];

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  const q       = req.query || {};
  const isAdmin = u.perfil === "admin";
  // Operador só enxerga a própria agenda: o parâmetro `usuario` é ignorado para ele.
  const alvo    = (isAdmin && q.usuario && q.usuario !== "TODOS") ? q.usuario : u.login;

  try {
    switch (q.recurso) {
      case "tarefas": return await tarefas(req, res, sql, u, q, isAdmin, alvo);
      case "metas":   return await metas(req, res, sql, u, q, isAdmin, alvo);
      case "stats":   return await stats(req, res, sql, u, q, isAdmin);
      default:        return res.status(400).json({ error: "Recurso inválido (use ?recurso=tarefas|metas|stats)" });
    }
  } catch (e) {
    return res.status(500).json({ error: "Erro agenda: " + e.message });
  }
}

// ═══════════════════════════════════════
// TAREFAS
// ═══════════════════════════════════════
async function tarefas(req, res, sql, u, q, isAdmin, alvo) {
  if (req.method === "GET") {
    // Calendário: um resumo por dia do mês
    if (q.mes) {
      const dias = await sql`
        SELECT TO_CHAR(data,'YYYY-MM-DD') AS data,
          COUNT(*) FILTER (WHERE status = 'feita')::int     AS feitas,
          COUNT(*) FILTER (WHERE status = 'nao_feita')::int AS nao_feitas,
          COUNT(*) FILTER (WHERE status = 'pendente')::int  AS pendentes
        FROM tarefas
        WHERE ativo = true AND usuario_login = ${alvo} AND TO_CHAR(data,'YYYY-MM') = ${q.mes}
        GROUP BY data ORDER BY data`;
      return res.status(200).json({ dias });
    }

    // Intervalo livre
    if (q.de && q.ate) {
      const rows = await sql`
        SELECT id, usuario_login, TO_CHAR(data,'YYYY-MM-DD') AS data,
          TO_CHAR(data_original,'YYYY-MM-DD') AS data_original, titulo, descricao, celula,
          prioridade, status, obs_status, adiamentos, concluida_em, criado_por
        FROM tarefas
        WHERE ativo = true AND usuario_login = ${alvo} AND data BETWEEN ${q.de} AND ${q.ate}
        ORDER BY data, id`;
      return res.status(200).json({ tarefas: rows });
    }

    // Dia (padrão) — tarefas do dia + pendentes atrasadas de dias anteriores
    const data = q.data || new Date().toISOString().slice(0, 10);
    const [doDia, atrasadas] = await Promise.all([
      sql`
        SELECT id, usuario_login, TO_CHAR(data,'YYYY-MM-DD') AS data,
          TO_CHAR(data_original,'YYYY-MM-DD') AS data_original, titulo, descricao, celula,
          prioridade, status, obs_status, adiamentos, concluida_em, criado_por
        FROM tarefas
        WHERE ativo = true AND usuario_login = ${alvo} AND data = ${data}
        ORDER BY CASE prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, id`,
      sql`
        SELECT id, usuario_login, TO_CHAR(data,'YYYY-MM-DD') AS data,
          TO_CHAR(data_original,'YYYY-MM-DD') AS data_original, titulo, descricao, celula,
          prioridade, status, obs_status, adiamentos, concluida_em, criado_por
        FROM tarefas
        WHERE ativo = true AND usuario_login = ${alvo} AND data < ${data} AND status = 'pendente'
        ORDER BY data, id`,
    ]);
    return res.status(200).json({ data, tarefas: doDia, atrasadas });
  }

  if (req.method === "POST") {
    const b = getBody(req);
    const titulo = (b.titulo || "").trim();
    if (!titulo)  return res.status(400).json({ error: "Título obrigatório" });
    if (!b.data)  return res.status(400).json({ error: "Data obrigatória" });
    // Só admin cria tarefa para outra pessoa
    const dono  = (isAdmin && b.usuario_login) ? b.usuario_login : u.login;
    const prio  = PRIORIDADES.includes(b.prioridade) ? b.prioridade : "media";
    const row = await sql`
      INSERT INTO tarefas (usuario_login, data, data_original, titulo, descricao, celula, prioridade, criado_por)
      VALUES (${dono}, ${b.data}, ${b.data}, ${titulo}, ${b.descricao || ""}, ${b.celula || null}, ${prio}, ${u.login})
      RETURNING id`;
    return res.status(200).json({ ok: true, id: row[0].id });
  }

  if (req.method === "PUT") {
    const b = getBody(req);
    if (!b.id) return res.status(400).json({ error: "id obrigatório" });
    const dono = await donoTarefa(sql, b.id);
    if (!dono)                       return res.status(404).json({ error: "Tarefa não encontrada" });
    if (!podeMexer(u, isAdmin, dono)) return res.status(403).json({ error: "Acesso negado" });

    // Adiar: empurra a data e mantém o histórico de quantas vezes já foi adiada
    if (b.acao === "adiar") {
      if (!b.nova_data) return res.status(400).json({ error: "nova_data obrigatória" });
      await sql`
        UPDATE tarefas SET data = ${b.nova_data}, adiamentos = adiamentos + 1,
          status = 'pendente', concluida_em = NULL
        WHERE id = ${b.id}`;
      return res.status(200).json({ ok: true });
    }

    // Mudança de status (feita / não feita / volta para pendente)
    if (b.status) {
      if (!STATUS.includes(b.status)) return res.status(400).json({ error: "Status inválido" });
      await sql`
        UPDATE tarefas SET status = ${b.status}, obs_status = ${b.obs_status || ""},
          concluida_em = ${b.status === "feita" ? new Date().toISOString() : null}
        WHERE id = ${b.id}`;
      return res.status(200).json({ ok: true });
    }

    // Edição dos campos
    const titulo = (b.titulo || "").trim();
    if (!titulo) return res.status(400).json({ error: "Título obrigatório" });
    const prio = PRIORIDADES.includes(b.prioridade) ? b.prioridade : "media";
    await sql`
      UPDATE tarefas SET data = ${b.data}, titulo = ${titulo}, descricao = ${b.descricao || ""},
        celula = ${b.celula || null}, prioridade = ${prio}
      WHERE id = ${b.id}`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = getBody(req);
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    const dono = await donoTarefa(sql, id);
    if (!dono)                        return res.status(404).json({ error: "Tarefa não encontrada" });
    if (!podeMexer(u, isAdmin, dono)) return res.status(403).json({ error: "Acesso negado" });
    await sql`UPDATE tarefas SET ativo = false WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Método não permitido" });
}

// ═══════════════════════════════════════
// METAS
// ═══════════════════════════════════════
async function metas(req, res, sql, u, q, isAdmin, alvo) {
  if (req.method === "GET") {
    const mes  = q.mes  || new Date().toISOString().slice(0, 7);
    const hoje = q.hoje || new Date().toISOString().slice(0, 10);
    // Meta do tipo 'tarefas' tem o progresso contado na hora a partir da agenda;
    // a do tipo 'numerica' usa o valor que o usuário atualiza à mão.
    const rows = await sql`
      SELECT m.id, m.usuario_login, m.titulo, m.tipo, m.periodo, m.mes_ano,
        m.alvo, m.atual, m.unidade, m.celula, m.criado_por,
        CASE WHEN m.tipo = 'numerica' THEN m.atual ELSE (
          SELECT COUNT(*) FROM tarefas t
          WHERE t.ativo = true AND t.status = 'feita'
            AND t.usuario_login = m.usuario_login
            AND (m.celula IS NULL OR m.celula = '' OR t.celula = m.celula)
            AND (
              (m.periodo = 'dia'    AND t.data = ${hoje}::date) OR
              (m.periodo = 'semana' AND t.data >= date_trunc('week', ${hoje}::date)::date
                                    AND t.data <  (date_trunc('week', ${hoje}::date) + INTERVAL '7 days')::date) OR
              (m.periodo = 'mes'    AND TO_CHAR(t.data,'YYYY-MM') = COALESCE(m.mes_ano, ${mes}))
            )
        ) END::numeric AS progresso
      FROM metas_usuario m
      WHERE m.ativo = true AND m.usuario_login = ${alvo}
        AND (m.periodo <> 'mes' OR m.mes_ano IS NULL OR m.mes_ano = ${mes})
      ORDER BY m.criado_em DESC`;
    return res.status(200).json(rows);
  }

  if (req.method === "POST") {
    const b = getBody(req);
    const titulo = (b.titulo || "").trim();
    if (!titulo)                    return res.status(400).json({ error: "Título obrigatório" });
    if (!(+b.alvo > 0))             return res.status(400).json({ error: "Alvo deve ser maior que zero" });
    const dono    = (isAdmin && b.usuario_login) ? b.usuario_login : u.login;
    const tipo    = TIPOS.includes(b.tipo) ? b.tipo : "tarefas";
    const periodo = PERIODOS.includes(b.periodo) ? b.periodo : "mes";
    const row = await sql`
      INSERT INTO metas_usuario (usuario_login, titulo, tipo, periodo, mes_ano, alvo, atual, unidade, celula, criado_por)
      VALUES (${dono}, ${titulo}, ${tipo}, ${periodo}, ${periodo === "mes" ? (b.mes_ano || null) : null},
              ${+b.alvo}, ${+b.atual || 0}, ${b.unidade || (tipo === "tarefas" ? "tarefas" : "")},
              ${b.celula || null}, ${u.login})
      RETURNING id`;
    return res.status(200).json({ ok: true, id: row[0].id });
  }

  if (req.method === "PUT") {
    const b = getBody(req);
    if (!b.id) return res.status(400).json({ error: "id obrigatório" });
    const dono = await donoMeta(sql, b.id);
    if (!dono)                        return res.status(404).json({ error: "Meta não encontrada" });
    if (!podeMexer(u, isAdmin, dono)) return res.status(403).json({ error: "Acesso negado" });

    // Atualização rápida do progresso (meta numérica)
    if (b.atual !== undefined && b.titulo === undefined) {
      await sql`UPDATE metas_usuario SET atual = ${+b.atual || 0} WHERE id = ${b.id}`;
      return res.status(200).json({ ok: true });
    }

    const titulo = (b.titulo || "").trim();
    if (!titulo)        return res.status(400).json({ error: "Título obrigatório" });
    if (!(+b.alvo > 0)) return res.status(400).json({ error: "Alvo deve ser maior que zero" });
    const tipo    = TIPOS.includes(b.tipo) ? b.tipo : "tarefas";
    const periodo = PERIODOS.includes(b.periodo) ? b.periodo : "mes";
    await sql`
      UPDATE metas_usuario SET titulo = ${titulo}, tipo = ${tipo}, periodo = ${periodo},
        mes_ano = ${periodo === "mes" ? (b.mes_ano || null) : null}, alvo = ${+b.alvo},
        atual = ${+b.atual || 0}, unidade = ${b.unidade || ""}, celula = ${b.celula || null}
      WHERE id = ${b.id}`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = getBody(req);
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    const dono = await donoMeta(sql, id);
    if (!dono)                        return res.status(404).json({ error: "Meta não encontrada" });
    if (!podeMexer(u, isAdmin, dono)) return res.status(403).json({ error: "Acesso negado" });
    await sql`UPDATE metas_usuario SET ativo = false WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Método não permitido" });
}

// ═══════════════════════════════════════
// STATS (gráfico de atividades)
// ═══════════════════════════════════════
async function stats(req, res, sql, u, q, isAdmin) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });

  const ate = q.ate || new Date().toISOString().slice(0, 10);
  const de  = q.de  || ate;
  // Admin sem usuário definido (ou 'TODOS') vê a equipe inteira; operador, só a si mesmo.
  const user   = isAdmin ? (q.usuario && q.usuario !== "TODOS" ? q.usuario : null) : u.login;
  const celula = q.celula || null;

  const [serie, resumoRows, porCelula] = await Promise.all([
    sql`
      SELECT TO_CHAR(data,'YYYY-MM-DD') AS data,
        COUNT(*) FILTER (WHERE status = 'feita')::int     AS feitas,
        COUNT(*) FILTER (WHERE status = 'nao_feita')::int AS nao_feitas,
        COUNT(*) FILTER (WHERE status = 'pendente')::int  AS pendentes
      FROM tarefas
      WHERE ativo = true AND data BETWEEN ${de} AND ${ate}
        AND (${user}::text   IS NULL OR usuario_login = ${user})
        AND (${celula}::text IS NULL OR celula = ${celula})
      GROUP BY data ORDER BY data`,
    sql`
      SELECT COUNT(*)::int                                 AS total,
        COUNT(*) FILTER (WHERE status = 'feita')::int      AS feitas,
        COUNT(*) FILTER (WHERE status = 'nao_feita')::int  AS nao_feitas,
        COUNT(*) FILTER (WHERE status = 'pendente')::int   AS pendentes,
        COALESCE(SUM(adiamentos),0)::int                   AS adiamentos
      FROM tarefas
      WHERE ativo = true AND data BETWEEN ${de} AND ${ate}
        AND (${user}::text   IS NULL OR usuario_login = ${user})
        AND (${celula}::text IS NULL OR celula = ${celula})`,
    sql`
      SELECT COALESCE(NULLIF(celula,''), 'Sem célula') AS celula,
        COUNT(*) FILTER (WHERE status = 'feita')::int  AS feitas,
        COUNT(*)::int                                  AS total
      FROM tarefas
      WHERE ativo = true AND data BETWEEN ${de} AND ${ate}
        AND (${user}::text   IS NULL OR usuario_login = ${user})
        AND (${celula}::text IS NULL OR celula = ${celula})
      GROUP BY 1 ORDER BY feitas DESC`,
  ]);

  // Comparativo da equipe só faz sentido no modo "todos" (admin)
  const equipe = user ? [] : await sql`
    SELECT t.usuario_login, COALESCE(us.nome, t.usuario_login) AS nome,
      COUNT(*)::int                                      AS total,
      COUNT(*) FILTER (WHERE t.status = 'feita')::int     AS feitas,
      COUNT(*) FILTER (WHERE t.status = 'nao_feita')::int AS nao_feitas,
      COUNT(*) FILTER (WHERE t.status = 'pendente')::int  AS pendentes,
      COALESCE(SUM(t.adiamentos),0)::int                  AS adiamentos
    FROM tarefas t
    LEFT JOIN usuarios us ON us.login = t.usuario_login
    WHERE t.ativo = true AND t.data BETWEEN ${de} AND ${ate}
      AND (${celula}::text IS NULL OR t.celula = ${celula})
    GROUP BY t.usuario_login, us.nome
    ORDER BY feitas DESC`;

  return res.status(200).json({ de, ate, serie, resumo: resumoRows[0], por_celula: porCelula, equipe });
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
async function donoTarefa(sql, id) {
  const r = await sql`SELECT usuario_login FROM tarefas WHERE id = ${id} AND ativo = true`;
  return r.length ? r[0].usuario_login : null;
}

async function donoMeta(sql, id) {
  const r = await sql`SELECT usuario_login FROM metas_usuario WHERE id = ${id} AND ativo = true`;
  return r.length ? r[0].usuario_login : null;
}

function podeMexer(u, isAdmin, dono) {
  return isAdmin || dono === u.login;
}
