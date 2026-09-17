import { setCors, handleOptions, getAuth, getBody, getSQL, initDB } from "./_lib/db.mjs";

// Módulo Agenda — tudo num arquivo só (?recurso=tarefas|metas|stats|recorrentes)
// para não estourar o limite de funções serverless da Vercel.
//
// Recorrência: a regra fica em tarefas_recorrentes; as ocorrências são tarefas
// comuns (com serie_id) geradas sob demanda até o fim da janela que alguém
// abriu — ver materializaRecorrentes. Assim status, adiar, participantes,
// crédito, metas e gráfico não precisam saber que a tarefa se repete.
//
// Tarefas compartilhadas: o estado de cada pessoa vive em tarefa_participantes,
// sempre uma linha por participante (inclusive o dono). A agenda do dia é uma
// consulta só, igual para tarefa solo e de equipe. O que muda é a propagação:
//   status_individual = false -> marcar/adiar vale para todas as linhas da tarefa
//   status_individual = true  -> vale só para a linha de quem clicou
//
// Crédito: numa tarefa compartilhada o "feita" conta para quem marcou
// (tarefas.concluida_por). Sem isso, uma tarefa de 3 pessoas fechada uma vez
// contaria 3× no comparativo da equipe e na meta do grupo.

const PRIORIDADES = ["baixa", "media", "alta"];
const STATUS      = ["pendente", "feita", "nao_feita"];
const TIPOS       = ["tarefas", "numerica"];
const PERIODOS    = ["dia", "semana", "mes"];
const FREQUENCIAS = ["diaria", "semanal", "mensal"];
// Até onde uma série pode ser gerada para a frente, contado de hoje. Abrir o
// calendário de um mês distante gera só até aqui.
const HORIZONTE_DIAS = 366;

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
  // Para o admin, `alvo` é a agenda que ele está vendo — e é nela que a ação recai.
  const alvo    = (isAdmin && q.usuario && q.usuario !== "TODOS") ? q.usuario : u.login;

  try {
    switch (q.recurso) {
      case "tarefas": return await tarefas(req, res, sql, u, q, isAdmin, alvo);
      case "metas":   return await metas(req, res, sql, u, q, isAdmin, alvo);
      case "stats":   return await stats(req, res, sql, u, q, isAdmin);
      case "recorrentes": return await recorrentes(req, res, sql, u, q, isAdmin, alvo);
      default:        return res.status(400).json({ error: "Recurso inválido (use ?recurso=tarefas|metas|stats|recorrentes)" });
    }
  } catch (e) {
    return res.status(500).json({ error: "Erro agenda: " + e.message });
  }
}

// ═══════════════════════════════════════
// TAREFAS
// ═══════════════════════════════════════

// Uma consulta para os três usos (dia, atrasadas e intervalo): os filtros não
// usados entram como NULL. `status` e `data` vêm da linha da pessoa; título,
// célula e prioridade são da tarefa, compartilhados por todos.
function listaTarefas(sql, { alvo, data = null, antesDe = null, de = null, ate = null }) {
  return sql`
    SELECT t.id, p.usuario_login, TO_CHAR(p.data,'YYYY-MM-DD') AS data,
      TO_CHAR(t.data_original,'YYYY-MM-DD') AS data_original,
      t.titulo, t.descricao, t.celula, t.prioridade, t.criado_por,
      t.usuario_login AS responsavel, t.status_individual, t.concluida_por,
      t.serie_id, r.frequencia AS serie_frequencia, r.dias_semana AS serie_dias,
      r.dia_mes AS serie_dia_mes, TO_CHAR(r.fim,'YYYY-MM-DD') AS serie_fim,
      p.status, p.obs_status, p.adiamentos, p.concluida_em,
      (SELECT COUNT(*) FROM tarefa_participantes px WHERE px.tarefa_id = t.id)::int AS n_participantes,
      (SELECT COALESCE(json_agg(row_to_json(y) ORDER BY y.nome), '[]'::json) FROM (
         SELECT p2.usuario_login AS login, COALESCE(us.nome, p2.usuario_login) AS nome, p2.status
         FROM tarefa_participantes p2
         LEFT JOIN usuarios us ON us.login = p2.usuario_login
         WHERE p2.tarefa_id = t.id
       ) y) AS participantes
    FROM tarefa_participantes p
    JOIN tarefas t ON t.id = p.tarefa_id
    LEFT JOIN tarefas_recorrentes r ON r.id = t.serie_id
    WHERE t.ativo = true AND p.usuario_login = ${alvo}
      AND (${data}::date    IS NULL OR p.data = ${data}::date)
      AND (${antesDe}::date IS NULL OR (p.data < ${antesDe}::date AND p.status = 'pendente'))
      AND (${de}::date      IS NULL OR p.data >= ${de}::date)
      AND (${ate}::date     IS NULL OR p.data <= ${ate}::date)
    ORDER BY p.data, CASE t.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, t.id`;
}

async function tarefas(req, res, sql, u, q, isAdmin, alvo) {
  if (req.method === "GET") {
    // Séries: gera as ocorrências que ainda faltam até o fim da janela pedida.
    // Barato depois da primeira vez — gerado_ate avança e a consulta vira no-op.
    const fimJanela = q.mes ? ultimoDiaDoMes(q.mes) : (q.ate || q.data || hojeUTC());
    await materializaRecorrentes(sql, fimJanela);

    // Calendário: resumo por dia do mês, pelo status da própria pessoa
    if (q.mes) {
      const dias = await sql`
        SELECT TO_CHAR(p.data,'YYYY-MM-DD') AS data,
          COUNT(*) FILTER (WHERE p.status = 'feita')::int     AS feitas,
          COUNT(*) FILTER (WHERE p.status = 'nao_feita')::int AS nao_feitas,
          COUNT(*) FILTER (WHERE p.status = 'pendente')::int  AS pendentes
        FROM tarefa_participantes p
        JOIN tarefas t ON t.id = p.tarefa_id
        WHERE t.ativo = true AND p.usuario_login = ${alvo}
          AND TO_CHAR(p.data,'YYYY-MM') = ${q.mes}
        GROUP BY p.data ORDER BY p.data`;
      return res.status(200).json({ dias });
    }

    if (q.de && q.ate) {
      const rows = await listaTarefas(sql, { alvo, de: q.de, ate: q.ate });
      return res.status(200).json({ tarefas: rows });
    }

    // Dia (padrão) — tarefas do dia + pendentes atrasadas de dias anteriores
    const data = q.data || new Date().toISOString().slice(0, 10);
    const [doDia, atrasadas] = await Promise.all([
      listaTarefas(sql, { alvo, data }),
      listaTarefas(sql, { alvo, antesDe: data }),
    ]);
    return res.status(200).json({ data, tarefas: doDia, atrasadas });
  }

  if (req.method === "POST") {
    const b = getBody(req);
    const titulo = (b.titulo || "").trim();
    if (!titulo) return res.status(400).json({ error: "Título obrigatório" });
    if (!b.data) return res.status(400).json({ error: "Data obrigatória" });
    // Só admin define outro responsável; qualquer um pode chamar colegas.
    const dono  = (isAdmin && b.usuario_login) ? b.usuario_login : u.login;
    const prio  = PRIORIDADES.includes(b.prioridade) ? b.prioridade : "media";
    const time  = listaParticipantes(b.participantes, dono);

    // Recorrente: grava a regra e gera as ocorrências até a data pedida.
    // Cada ocorrência é uma tarefa comum — status, adiar e crédito não mudam.
    if (b.repetir && b.repetir !== "nao") {
      const regra = validaRegra(b);
      if (regra.erro) return res.status(400).json({ error: regra.erro });
      const serie = await sql`
        INSERT INTO tarefas_recorrentes
          (usuario_login, titulo, descricao, celula, prioridade, status_individual, participantes,
           frequencia, dias_semana, dia_mes, inicio, fim, criado_por)
        VALUES (${dono}, ${titulo}, ${b.descricao || ""}, ${b.celula || null}, ${prio}, ${!!b.status_individual},
                ${JSON.stringify(time)}, ${regra.frequencia}, ${regra.dias_semana}, ${regra.dia_mes},
                ${b.data}, ${regra.fim}, ${u.login})
        RETURNING id`;
      await materializaRecorrentes(sql, b.data);
      return res.status(200).json({ ok: true, serie_id: serie[0].id, participantes: time.length, recorrente: true });
    }

    const row = await sql`
      INSERT INTO tarefas (usuario_login, data, data_original, titulo, descricao, celula,
                           prioridade, criado_por, status_individual)
      VALUES (${dono}, ${b.data}, ${b.data}, ${titulo}, ${b.descricao || ""}, ${b.celula || null},
              ${prio}, ${u.login}, ${!!b.status_individual})
      RETURNING id`;
    const id = row[0].id;
    await Promise.all(time.map(login => sql`
      INSERT INTO tarefa_participantes (tarefa_id, usuario_login, data)
      VALUES (${id}, ${login}, ${b.data})
      ON CONFLICT (tarefa_id, usuario_login) DO NOTHING`));
    return res.status(200).json({ ok: true, id, participantes: time.length });
  }

  if (req.method === "PUT") {
    const b = getBody(req);
    if (!b.id) return res.status(400).json({ error: "id obrigatório" });
    const t = await carregaTarefa(sql, b.id);
    if (!t) return res.status(404).json({ error: "Tarefa não encontrada" });

    // Quem executa a ação: a agenda que está aberta (o admin pode agir na de outro).
    const quem = isAdmin ? alvo : u.login;
    const souParticipante = t.participantes.includes(quem);
    if (!isAdmin && !souParticipante) return res.status(403).json({ error: "Acesso negado" });

    // Adiar: empurra a data e conta o adiamento
    if (b.acao === "adiar") {
      if (!b.nova_data) return res.status(400).json({ error: "nova_data obrigatória" });
      if (t.status_individual) {
        await sql`
          UPDATE tarefa_participantes
          SET data = ${b.nova_data}, adiamentos = adiamentos + 1, status = 'pendente', concluida_em = NULL
          WHERE tarefa_id = ${b.id} AND usuario_login = ${quem}`;
      } else {
        // Trabalho único: adiar vale para todos os participantes.
        // Em `tarefas` só mexe no que ainda é lido: a data da tarefa e o crédito.
        await Promise.all([
          sql`UPDATE tarefa_participantes
              SET data = ${b.nova_data}, adiamentos = adiamentos + 1, status = 'pendente', concluida_em = NULL
              WHERE tarefa_id = ${b.id}`,
          sql`UPDATE tarefas SET data = ${b.nova_data}, concluida_por = NULL WHERE id = ${b.id}`,
        ]);
      }
      return res.status(200).json({ ok: true });
    }

    // Status: feita / não feita / de volta para pendente
    if (b.status) {
      if (!STATUS.includes(b.status)) return res.status(400).json({ error: "Status inválido" });
      const agora  = b.status === "feita" ? new Date().toISOString() : null;
      const credito = b.status === "feita" ? quem : null;
      if (t.status_individual) {
        // Cada um o seu: no modo individual o crédito é automático, não usa concluida_por.
        await sql`
          UPDATE tarefa_participantes
          SET status = ${b.status}, obs_status = ${b.obs_status || ""}, concluida_em = ${agora}
          WHERE tarefa_id = ${b.id} AND usuario_login = ${quem}`;
      } else {
        // Trabalho único: fecha para todos e o crédito fica com quem marcou.
        await Promise.all([
          sql`UPDATE tarefa_participantes
              SET status = ${b.status}, obs_status = ${b.obs_status || ""}, concluida_em = ${agora}
              WHERE tarefa_id = ${b.id}`,
          sql`UPDATE tarefas SET concluida_por = ${credito} WHERE id = ${b.id}`,
        ]);
      }
      return res.status(200).json({ ok: true });
    }

    // Edição dos campos da tarefa — só quem criou, o responsável ou o admin
    if (!podeEditar(u, isAdmin, t)) return res.status(403).json({ error: "Acesso negado" });
    const titulo = (b.titulo || "").trim();
    if (!titulo) return res.status(400).json({ error: "Título obrigatório" });
    const prio = PRIORIDADES.includes(b.prioridade) ? b.prioridade : "media";
    const individual = b.status_individual === undefined ? t.status_individual : !!b.status_individual;
    await sql`
      UPDATE tarefas SET titulo = ${titulo}, descricao = ${b.descricao || ""},
        celula = ${b.celula || null}, prioridade = ${prio}, status_individual = ${individual},
        data = COALESCE(${b.data || null}::date, data)
      WHERE id = ${b.id}`;
    // Remarcar pela edição vale para todos: é a data da tarefa, não de uma pessoa.
    if (b.data) {
      await sql`UPDATE tarefa_participantes SET data = ${b.data} WHERE tarefa_id = ${b.id}`;
    }
    // Acertar a equipe, se vier na requisição
    if (Array.isArray(b.participantes)) {
      const time = listaParticipantes(b.participantes, t.responsavel);
      const dataTarefa = b.data || t.data;
      await Promise.all([
        ...time.map(login => sql`
          INSERT INTO tarefa_participantes (tarefa_id, usuario_login, data)
          VALUES (${b.id}, ${login}, ${dataTarefa})
          ON CONFLICT (tarefa_id, usuario_login) DO NOTHING`),
        ...t.participantes.filter(p => !time.includes(p)).map(login => sql`
          DELETE FROM tarefa_participantes WHERE tarefa_id = ${b.id} AND usuario_login = ${login}`),
      ]);
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = getBody(req);
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    const t = await carregaTarefa(sql, id);
    if (!t) return res.status(404).json({ error: "Tarefa não encontrada" });
    const quem = isAdmin ? alvo : u.login;

    // Participante que não é dono nem criador só sai da tarefa — não apaga
    // o trabalho dos outros.
    if (!podeEditar(u, isAdmin, t)) {
      if (!t.participantes.includes(quem)) return res.status(403).json({ error: "Acesso negado" });
      await sql`DELETE FROM tarefa_participantes WHERE tarefa_id = ${id} AND usuario_login = ${quem}`;
      return res.status(200).json({ ok: true, saiu: true });
    }
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
    // Meta de grupo: `por_pessoa` traz a contribuição de cada participante e o
    // total é a soma (calculada no JS logo abaixo, para não divergir da quebra).
    // Só conta tarefa com crédito da pessoa — ver nota no topo do arquivo.
    const rows = await sql`
      SELECT m.id, m.usuario_login, m.titulo, m.tipo, m.periodo, m.mes_ano,
        m.alvo, m.atual, m.unidade, m.celula, m.criado_por,
        (SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.nome), '[]'::json) FROM (
           SELECT mp.usuario_login AS login,
             COALESCE(us.nome, mp.usuario_login) AS nome,
             (SELECT COUNT(*) FROM tarefa_participantes p
              JOIN tarefas t ON t.id = p.tarefa_id
              WHERE t.ativo = true AND p.usuario_login = mp.usuario_login
                AND p.status = 'feita'
                AND (t.status_individual OR t.concluida_por = p.usuario_login)
                AND (m.celula IS NULL OR m.celula = '' OR t.celula = m.celula)
                AND (
                  (m.periodo = 'dia'    AND p.data = ${hoje}::date) OR
                  (m.periodo = 'semana' AND p.data >= date_trunc('week', ${hoje}::date)::date
                                        AND p.data <  (date_trunc('week', ${hoje}::date) + INTERVAL '7 days')::date) OR
                  (m.periodo = 'mes'    AND TO_CHAR(p.data,'YYYY-MM') = COALESCE(m.mes_ano, ${mes}))
                )
             )::int AS progresso
           FROM meta_participantes mp
           LEFT JOIN usuarios us ON us.login = mp.usuario_login
           WHERE mp.meta_id = m.id
         ) x) AS por_pessoa
      FROM metas_usuario m
      WHERE m.ativo = true
        AND EXISTS (SELECT 1 FROM meta_participantes mp
                    WHERE mp.meta_id = m.id AND mp.usuario_login = ${alvo})
        AND (m.periodo <> 'mes' OR m.mes_ano IS NULL OR m.mes_ano = ${mes})
      ORDER BY m.criado_em DESC`;

    const out = rows.map(m => {
      const porPessoa = m.por_pessoa || [];
      return {
        ...m,
        por_pessoa: porPessoa,
        progresso: m.tipo === "numerica"
          ? +m.atual
          : porPessoa.reduce((s, x) => s + (+x.progresso || 0), 0),
      };
    });
    return res.status(200).json(out);
  }

  if (req.method === "POST") {
    const b = getBody(req);
    const titulo = (b.titulo || "").trim();
    if (!titulo)     return res.status(400).json({ error: "Título obrigatório" });
    if (!(+b.alvo > 0)) return res.status(400).json({ error: "Alvo deve ser maior que zero" });
    const dono    = (isAdmin && b.usuario_login) ? b.usuario_login : u.login;
    const tipo    = TIPOS.includes(b.tipo) ? b.tipo : "tarefas";
    const periodo = PERIODOS.includes(b.periodo) ? b.periodo : "mes";
    const time    = listaParticipantes(b.participantes, dono);
    const row = await sql`
      INSERT INTO metas_usuario (usuario_login, titulo, tipo, periodo, mes_ano, alvo, atual, unidade, celula, criado_por)
      VALUES (${dono}, ${titulo}, ${tipo}, ${periodo}, ${periodo === "mes" ? (b.mes_ano || null) : null},
              ${+b.alvo}, ${+b.atual || 0}, ${b.unidade || (tipo === "tarefas" ? "tarefas" : "")},
              ${b.celula || null}, ${u.login})
      RETURNING id`;
    const id = row[0].id;
    await Promise.all(time.map(login => sql`
      INSERT INTO meta_participantes (meta_id, usuario_login) VALUES (${id}, ${login})
      ON CONFLICT (meta_id, usuario_login) DO NOTHING`));
    return res.status(200).json({ ok: true, id, participantes: time.length });
  }

  if (req.method === "PUT") {
    const b = getBody(req);
    if (!b.id) return res.status(400).json({ error: "id obrigatório" });
    const m = await carregaMeta(sql, b.id);
    if (!m) return res.status(404).json({ error: "Meta não encontrada" });
    const quem = isAdmin ? alvo : u.login;

    // Atualização rápida do progresso manual: qualquer participante pode —
    // é uma meta do grupo, o número é de todos.
    if (b.atual !== undefined && b.titulo === undefined) {
      if (!isAdmin && !m.participantes.includes(quem)) return res.status(403).json({ error: "Acesso negado" });
      await sql`UPDATE metas_usuario SET atual = ${+b.atual || 0} WHERE id = ${b.id}`;
      return res.status(200).json({ ok: true });
    }

    if (!podeEditar(u, isAdmin, m)) return res.status(403).json({ error: "Acesso negado" });
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
    if (Array.isArray(b.participantes)) {
      const time = listaParticipantes(b.participantes, m.responsavel);
      await Promise.all([
        ...time.map(login => sql`
          INSERT INTO meta_participantes (meta_id, usuario_login) VALUES (${b.id}, ${login})
          ON CONFLICT (meta_id, usuario_login) DO NOTHING`),
        ...m.participantes.filter(p => !time.includes(p)).map(login => sql`
          DELETE FROM meta_participantes WHERE meta_id = ${b.id} AND usuario_login = ${login}`),
      ]);
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id } = getBody(req);
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    const m = await carregaMeta(sql, id);
    if (!m) return res.status(404).json({ error: "Meta não encontrada" });
    const quem = isAdmin ? alvo : u.login;

    if (!podeEditar(u, isAdmin, m)) {
      if (!m.participantes.includes(quem)) return res.status(403).json({ error: "Acesso negado" });
      await sql`DELETE FROM meta_participantes WHERE meta_id = ${id} AND usuario_login = ${quem}`;
      return res.status(200).json({ ok: true, saiu: true });
    }
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
  await materializaRecorrentes(sql, ate);

  // `total` soma exatamente feitas + nao_feitas + pendentes, para o % fechar.
  // Uma tarefa compartilhada que um colega fechou não entra em nenhum desses
  // três na agenda de quem não marcou — sai em `feitas_equipe`.
  const [serie, resumoRows, porCelula] = await Promise.all([
    sql`
      SELECT TO_CHAR(p.data,'YYYY-MM-DD') AS data,
        COUNT(*) FILTER (WHERE p.status = 'feita'
                           AND (t.status_individual OR t.concluida_por = p.usuario_login))::int AS feitas,
        COUNT(*) FILTER (WHERE p.status = 'nao_feita')::int AS nao_feitas,
        COUNT(*) FILTER (WHERE p.status = 'pendente')::int  AS pendentes
      FROM tarefa_participantes p
      JOIN tarefas t ON t.id = p.tarefa_id
      WHERE t.ativo = true AND p.data BETWEEN ${de} AND ${ate}
        AND (${user}::text   IS NULL OR p.usuario_login = ${user})
        AND (${celula}::text IS NULL OR t.celula = ${celula})
      GROUP BY p.data ORDER BY p.data`,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE (p.status = 'feita'
                                AND (t.status_individual OR t.concluida_por = p.usuario_login))
                              OR p.status IN ('nao_feita','pendente'))::int AS total,
        COUNT(*) FILTER (WHERE p.status = 'feita'
                           AND (t.status_individual OR t.concluida_por = p.usuario_login))::int AS feitas,
        COUNT(*) FILTER (WHERE p.status = 'feita' AND NOT t.status_individual
                           AND t.concluida_por IS DISTINCT FROM p.usuario_login)::int AS feitas_equipe,
        COUNT(*) FILTER (WHERE p.status = 'nao_feita')::int AS nao_feitas,
        COUNT(*) FILTER (WHERE p.status = 'pendente')::int  AS pendentes,
        COALESCE(SUM(p.adiamentos),0)::int                  AS adiamentos,
        COUNT(DISTINCT t.id) FILTER (WHERE (SELECT COUNT(*) FROM tarefa_participantes px
                                           WHERE px.tarefa_id = t.id) > 1)::int AS compartilhadas
      FROM tarefa_participantes p
      JOIN tarefas t ON t.id = p.tarefa_id
      WHERE t.ativo = true AND p.data BETWEEN ${de} AND ${ate}
        AND (${user}::text   IS NULL OR p.usuario_login = ${user})
        AND (${celula}::text IS NULL OR t.celula = ${celula})`,
    sql`
      SELECT COALESCE(NULLIF(t.celula,''), 'Sem célula') AS celula,
        COUNT(*) FILTER (WHERE p.status = 'feita'
                           AND (t.status_individual OR t.concluida_por = p.usuario_login))::int AS feitas,
        COUNT(*)::int AS total
      FROM tarefa_participantes p
      JOIN tarefas t ON t.id = p.tarefa_id
      WHERE t.ativo = true AND p.data BETWEEN ${de} AND ${ate}
        AND (${user}::text   IS NULL OR p.usuario_login = ${user})
        AND (${celula}::text IS NULL OR t.celula = ${celula})
      GROUP BY 1 ORDER BY feitas DESC`,
  ]);

  // Comparativo da equipe só faz sentido no modo "todos" (admin)
  const equipe = user ? [] : await sql`
    SELECT p.usuario_login, COALESCE(us.nome, p.usuario_login) AS nome,
      COUNT(*) FILTER (WHERE (p.status = 'feita'
                              AND (t.status_individual OR t.concluida_por = p.usuario_login))
                            OR p.status IN ('nao_feita','pendente'))::int AS total,
      COUNT(*) FILTER (WHERE p.status = 'feita'
                         AND (t.status_individual OR t.concluida_por = p.usuario_login))::int AS feitas,
      COUNT(*) FILTER (WHERE p.status = 'nao_feita')::int AS nao_feitas,
      COUNT(*) FILTER (WHERE p.status = 'pendente')::int  AS pendentes,
      COALESCE(SUM(p.adiamentos),0)::int                  AS adiamentos
    FROM tarefa_participantes p
    JOIN tarefas t ON t.id = p.tarefa_id
    LEFT JOIN usuarios us ON us.login = p.usuario_login
    WHERE t.ativo = true AND p.data BETWEEN ${de} AND ${ate}
      AND (${celula}::text IS NULL OR t.celula = ${celula})
    GROUP BY p.usuario_login, us.nome
    ORDER BY feitas DESC`;

  return res.status(200).json({ de, ate, serie, resumo: resumoRows[0], por_celula: porCelula, equipe });
}

// ═══════════════════════════════════════
// RECORRENTES (séries)
// ═══════════════════════════════════════
async function recorrentes(req, res, sql, u, q, isAdmin, alvo) {
  if (req.method === "GET") {
    // Séries em que a pessoa é responsável ou participante. `participantes` é
    // um JSON de logins em texto; o LIKE com aspas evita casar "ana" em "mariana".
    const marca = `%"${alvo}"%`;
    const rows = await sql`
      SELECT r.id, r.usuario_login, r.titulo, r.descricao, r.celula, r.prioridade,
        r.status_individual, r.participantes, r.frequencia, r.dias_semana, r.dia_mes,
        TO_CHAR(r.inicio,'YYYY-MM-DD') AS inicio, TO_CHAR(r.fim,'YYYY-MM-DD') AS fim,
        TO_CHAR(r.gerado_ate,'YYYY-MM-DD') AS gerado_ate, r.criado_por,
        (SELECT COUNT(*) FROM tarefas t WHERE t.serie_id = r.id AND t.ativo = true)::int AS ocorrencias,
        (SELECT COUNT(*) FROM tarefas t
         JOIN tarefa_participantes p ON p.tarefa_id = t.id AND p.usuario_login = ${alvo}
         WHERE t.serie_id = r.id AND t.ativo = true AND p.status = 'feita')::int AS feitas
      FROM tarefas_recorrentes r
      WHERE r.ativo = true AND (r.usuario_login = ${alvo} OR r.participantes LIKE ${marca})
      ORDER BY r.criado_em DESC`;
    return res.status(200).json(rows.map(r => ({
      ...r,
      participantes: parseLogins(r.participantes),
      descricao_regra: descreveRegra(r),
    })));
  }

  if (req.method === "PUT") {
    const b = getBody(req);
    if (!b.id) return res.status(400).json({ error: "id obrigatório" });
    const r = await carregaSerie(sql, b.id);
    if (!r) return res.status(404).json({ error: "Série não encontrada" });
    if (!podeEditar(u, isAdmin, r)) return res.status(403).json({ error: "Acesso negado" });
    const titulo = (b.titulo || "").trim();
    if (!titulo) return res.status(400).json({ error: "Título obrigatório" });
    const prio = PRIORIDADES.includes(b.prioridade) ? b.prioridade : "media";
    const fim  = b.fim || null;
    const hoje = b.hoje || hojeUTC();
    await sql`
      UPDATE tarefas_recorrentes SET titulo = ${titulo}, descricao = ${b.descricao || ""},
        celula = ${b.celula || null}, prioridade = ${prio}, fim = ${fim}
      WHERE id = ${b.id}`;
    // Reflete nas ocorrências futuras que ninguém tocou; o passado fica como está.
    await sql`
      UPDATE tarefas SET titulo = ${titulo}, descricao = ${b.descricao || ""},
        celula = ${b.celula || null}, prioridade = ${prio}
      WHERE serie_id = ${b.id} AND ativo = true AND data_original >= ${hoje}::date
        AND NOT EXISTS (SELECT 1 FROM tarefa_participantes p
                        WHERE p.tarefa_id = tarefas.id AND p.status <> 'pendente')`;
    // Encurtou o fim: apaga o que ficou depois dele e ainda está intocado.
    if (fim) {
      await sql`
        UPDATE tarefas SET ativo = false
        WHERE serie_id = ${b.id} AND ativo = true AND data_original > ${fim}::date
          AND NOT EXISTS (SELECT 1 FROM tarefa_participantes p
                          WHERE p.tarefa_id = tarefas.id AND p.status <> 'pendente')`;
      await sql`UPDATE tarefas_recorrentes SET gerado_ate = LEAST(gerado_ate, ${fim}::date) WHERE id = ${b.id}`;
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    // Encerrar: para de gerar e limpa as ocorrências futuras intocadas.
    // As de hoje e do passado ficam — são histórico.
    const b = getBody(req);
    if (!b.id) return res.status(400).json({ error: "id obrigatório" });
    const r = await carregaSerie(sql, b.id);
    if (!r) return res.status(404).json({ error: "Série não encontrada" });
    if (!podeEditar(u, isAdmin, r)) return res.status(403).json({ error: "Acesso negado" });
    const hoje = b.hoje || hojeUTC();
    await Promise.all([
      sql`UPDATE tarefas_recorrentes SET ativo = false, fim = ${hoje}::date WHERE id = ${b.id}`,
      sql`UPDATE tarefas SET ativo = false
          WHERE serie_id = ${b.id} AND ativo = true AND data_original > ${hoje}::date
            AND NOT EXISTS (SELECT 1 FROM tarefa_participantes p
                            WHERE p.tarefa_id = tarefas.id AND p.status <> 'pendente')`,
    ]);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Método não permitido" });
}

// Gera, para toda série ativa, as ocorrências entre gerado_ate+1 e `ate`
// (limitado ao horizonte). Uma query por série, com unnest — não cresce com o
// número de dias. Idempotente: o índice único (serie_id, data_original) segura
// duplicata se dois acessos coincidirem.
async function materializaRecorrentes(sql, ate) {
  const limite = addDiasUTC(hojeUTC(), HORIZONTE_DIAS);
  if (!ate || ate > limite) ate = limite;
  const series = await sql`
    SELECT id, usuario_login, titulo, descricao, celula, prioridade, status_individual,
      participantes, frequencia, dias_semana, dia_mes, criado_por,
      TO_CHAR(inicio,'YYYY-MM-DD') AS inicio, TO_CHAR(fim,'YYYY-MM-DD') AS fim,
      TO_CHAR(gerado_ate,'YYYY-MM-DD') AS gerado_ate
    FROM tarefas_recorrentes
    WHERE ativo = true AND inicio <= ${ate}::date
      AND (gerado_ate IS NULL OR gerado_ate < ${ate}::date)
      AND (fim IS NULL OR fim >= COALESCE(gerado_ate + 1, inicio))`;

  for (const s of series) {
    const de   = s.gerado_ate ? addDiasUTC(s.gerado_ate, 1) : s.inicio;
    const fim  = s.fim && s.fim < ate ? s.fim : ate;
    if (de > fim) continue;
    const datas  = datasDaSerie(s, de, fim);
    const logins = listaParticipantes(parseLogins(s.participantes), s.usuario_login);
    if (datas.length) {
      await sql`
        WITH novas AS (
          INSERT INTO tarefas (usuario_login, data, data_original, titulo, descricao, celula,
                               prioridade, criado_por, status_individual, serie_id)
          SELECT ${s.usuario_login}, d, d, ${s.titulo}, ${s.descricao || ""}, ${s.celula || null},
                 ${s.prioridade}, ${s.criado_por}, ${!!s.status_individual}, ${s.id}
          FROM unnest(${datas}::date[]) AS d
          ON CONFLICT (serie_id, data_original) WHERE serie_id IS NOT NULL DO NOTHING
          RETURNING id, data
        )
        INSERT INTO tarefa_participantes (tarefa_id, usuario_login, data)
        SELECT n.id, l, n.data FROM novas n CROSS JOIN unnest(${logins}::text[]) AS l
        ON CONFLICT (tarefa_id, usuario_login) DO NOTHING`;
    }
    await sql`UPDATE tarefas_recorrentes SET gerado_ate = ${fim}::date WHERE id = ${s.id}`;
  }
}

// Datas em que a regra cai, entre `de` e `ate` (inclusive), tudo em UTC.
function datasDaSerie(s, de, ate) {
  const out  = [];
  const dias = (s.dias_semana || "").split(",").filter(Boolean).map(Number);
  let d = new Date(de + "T00:00:00Z");
  const fim = new Date(ate + "T00:00:00Z");
  for (; d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (s.frequencia === "diaria") { out.push(iso); continue; }
    if (s.frequencia === "semanal") { if (dias.includes(d.getUTCDay())) out.push(iso); continue; }
    if (s.frequencia === "mensal") {
      // Dia 31 num mês de 30 cai no último dia do mês
      const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const alvo   = Math.min(+s.dia_mes || 1, ultimo);
      if (d.getUTCDate() === alvo) out.push(iso);
    }
  }
  return out;
}

function validaRegra(b) {
  const frequencia = b.repetir === "uteis" ? "semanal" : b.repetir;
  if (!FREQUENCIAS.includes(frequencia)) return { erro: "Repetição inválida" };
  let dias_semana = null, dia_mes = null;
  if (frequencia === "semanal") {
    const dias = b.repetir === "uteis"
      ? [1, 2, 3, 4, 5]
      : (Array.isArray(b.dias_semana) ? b.dias_semana : String(b.dias_semana || "").split(","))
          .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!dias.length) return { erro: "Escolha ao menos um dia da semana" };
    dias_semana = [...new Set(dias)].sort().join(",");
  }
  if (frequencia === "mensal") {
    dia_mes = +b.dia_mes || +String(b.data || "").slice(8, 10) || 1;
    if (dia_mes < 1 || dia_mes > 31) return { erro: "Dia do mês inválido" };
  }
  const fim = b.fim || null;
  if (fim && b.data && fim < b.data) return { erro: "A data final é anterior ao início" };
  return { frequencia, dias_semana, dia_mes, fim };
}

const DOW_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function descreveRegra(r) {
  if (r.frequencia === "diaria") return "todo dia";
  if (r.frequencia === "semanal") {
    const d = (r.dias_semana || "").split(",").filter(Boolean).map(Number);
    if (d.join(",") === "1,2,3,4,5") return "dias úteis";
    return "toda " + d.map(i => DOW_PT[i]).join(", ");
  }
  if (r.frequencia === "mensal") return `todo dia ${r.dia_mes}`;
  return "";
}

function parseLogins(txt) {
  try { const v = JSON.parse(txt || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function carregaSerie(sql, id) {
  const rows = await sql`SELECT id, usuario_login, criado_por FROM tarefas_recorrentes WHERE id = ${id} AND ativo = true`;
  return rows.length ? { ...rows[0], responsavel: rows[0].usuario_login } : null;
}

// Datas do servidor em UTC — só para horizonte e defaults; o dia "de verdade"
// vem sempre do cliente (q.data / b.hoje).
const hojeUTC = () => new Date().toISOString().slice(0, 10);
function addDiasUTC(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ultimoDiaDoMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(ultimo).padStart(2, "0")}`;
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

// Normaliza a equipe: sem vazios, sem repetidos, e o responsável sempre dentro.
function listaParticipantes(lista, dono) {
  const set = new Set([dono]);
  if (Array.isArray(lista)) {
    lista.forEach(x => { const s = String(x || "").trim(); if (s) set.add(s); });
  }
  return [...set];
}

async function carregaTarefa(sql, id) {
  const [rows, parts] = await Promise.all([
    sql`SELECT id, usuario_login, criado_por, status_individual,
               TO_CHAR(data,'YYYY-MM-DD') AS data
        FROM tarefas WHERE id = ${id} AND ativo = true`,
    sql`SELECT usuario_login FROM tarefa_participantes WHERE tarefa_id = ${id}`,
  ]);
  if (!rows.length) return null;
  return {
    ...rows[0],
    responsavel: rows[0].usuario_login,
    participantes: parts.map(p => p.usuario_login),
  };
}

async function carregaMeta(sql, id) {
  const [rows, parts] = await Promise.all([
    sql`SELECT id, usuario_login, criado_por FROM metas_usuario WHERE id = ${id} AND ativo = true`,
    sql`SELECT usuario_login FROM meta_participantes WHERE meta_id = ${id}`,
  ]);
  if (!rows.length) return null;
  return {
    ...rows[0],
    responsavel: rows[0].usuario_login,
    participantes: parts.map(p => p.usuario_login),
  };
}

// Mexer na tarefa/meta em si (editar, excluir, trocar a equipe): admin, quem
// criou ou o responsável. Participante comum só age no próprio status.
function podeEditar(u, isAdmin, item) {
  return isAdmin || item.criado_por === u.login || item.responsavel === u.login;
}
