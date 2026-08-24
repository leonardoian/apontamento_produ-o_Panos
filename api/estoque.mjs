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
    const mes = req.query?.mes || "";

    // ?historico=1&ref=COD -> série daquela referência
    // ?historico=1         -> importações registradas, com o total consolidado
    if (req.query?.historico) {
      const ref = String(req.query?.ref || "").toUpperCase();
      try {
        const rows = ref
          ? await sql`
            SELECT importado_em, mtz_0860, mtz_0803, mtz_0802, sp_0803, pe_0803, total, forecast_mensal
            FROM estoque_historico
            WHERE UPPER(ref_cod) = ${ref}
            ORDER BY importado_em`
          : await sql`
            SELECT importado_em,
                   COUNT(*)::int        AS referencias,
                   SUM(total)::int      AS total_geral
            FROM estoque_historico
            GROUP BY importado_em
            ORDER BY importado_em DESC
            LIMIT 60`;
        return res.status(200).json(rows);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    try {
      const rows = mes
        ? await sql`
          SELECT
            r.cod, r.descricao, r.celula, r.estoque_atual, r.forecast_mensal,
            r.forecast_mi_pe, r.forecast_mi_sp, r.forecast_mi_mtz, r.forecast_me,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0860' THEN e.quantidade END), 0)::int AS mtz_0860,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0803' THEN e.quantidade END), 0)::int AS mtz_0803,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0802' THEN e.quantidade END), 0)::int AS mtz_0802,
            COALESCE(SUM(CASE WHEN e.cd='CD-SP'  AND e.deposito='0803' THEN e.quantidade END), 0)::int AS sp_0803,
            COALESCE(SUM(CASE WHEN e.cd='CD-PE'  AND e.deposito='0803' THEN e.quantidade END), 0)::int AS pe_0803,
            COALESCE(MAX(pr.meta_total), 0)::int AS meta_total
          FROM referencias r
          LEFT JOIN estoque e ON e.ref_cod = r.cod
          -- programa agregado ANTES do join: unir as duas tabelas direto na referencia
          -- multiplicava cada saldo pelo nº de linhas de programa da referência
          -- (de todos os meses, pois o FILTER só limitava a soma, não o join).
          LEFT JOIN (
            SELECT ref_cod, SUM(meta_turno * num_turnos)::int AS meta_total
            FROM programa
            WHERE mes_ano = ${mes} AND ativo = true
            GROUP BY ref_cod
          ) pr ON pr.ref_cod = r.cod
          WHERE r.ativo = true
          GROUP BY r.cod, r.descricao, r.celula, r.estoque_atual, r.forecast_mensal, r.forecast_mi_pe, r.forecast_mi_sp, r.forecast_mi_mtz, r.forecast_me
          ORDER BY r.cod`
        : await sql`
          SELECT
            r.cod, r.descricao, r.celula, r.estoque_atual, r.forecast_mensal,
            r.forecast_mi_pe, r.forecast_mi_sp, r.forecast_mi_mtz, r.forecast_me,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0860' THEN e.quantidade END), 0)::int AS mtz_0860,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0803' THEN e.quantidade END), 0)::int AS mtz_0803,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0802' THEN e.quantidade END), 0)::int AS mtz_0802,
            COALESCE(SUM(CASE WHEN e.cd='CD-SP'  AND e.deposito='0803' THEN e.quantidade END), 0)::int AS sp_0803,
            COALESCE(SUM(CASE WHEN e.cd='CD-PE'  AND e.deposito='0803' THEN e.quantidade END), 0)::int AS pe_0803,
            0::int AS meta_total
          FROM referencias r
          LEFT JOIN estoque e ON e.ref_cod = r.cod
          WHERE r.ativo = true
          GROUP BY r.cod, r.descricao, r.celula, r.estoque_atual, r.forecast_mensal, r.forecast_mi_pe, r.forecast_mi_sp, r.forecast_mi_mtz, r.forecast_me
          ORDER BY r.cod`;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { registros, forecast, iniciar, finalizar, marcador } = getBody(req);

    // A importação envia os saldos em lotes, então não dá para limpar o estoque
    // antes de inserir: o 1º lote apagaria tudo e uma falha no meio deixaria o
    // saldo pela metade. Em vez disso, marca-se o instante de início e, só
    // depois que TODOS os lotes passaram, zera-se o que não foi tocado.
    if (iniciar) {
      try {
        // ::timestamp para bater com o tipo da coluna atualizado_em — NOW() é
        // timestamptz e a comparação passaria a depender do fuso da sessão.
        const [{ agora }] = await sql`SELECT NOW()::timestamp AS agora`;
        return res.status(200).json({ ok: true, marcador: agora });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    if (finalizar) {
      if (!marcador) return res.status(400).json({ error: "marcador obrigatório" });
      try {
        // Zera em vez de apagar: mantém a linha visível e preserva
        // `atualizado_em` como a marca da última atualização real.
        const zeradas = await sql`
          UPDATE estoque SET quantidade = 0
          WHERE atualizado_em < ${marcador} AND quantidade <> 0
          RETURNING 1`;

        // Snapshot depois da varredura, para registrar o estado final de fato.
        // Uma linha por referência (não por depósito): mantém o histórico leve
        // e ainda preserva a quebra por CD nas colunas.
        const snap = await sql`
          INSERT INTO estoque_historico
            (importado_em, ref_cod, mtz_0860, mtz_0803, mtz_0802, sp_0803, pe_0803, total, forecast_mensal)
          SELECT
            ${marcador}, r.cod,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0860' THEN e.quantidade END), 0)::int,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0803' THEN e.quantidade END), 0)::int,
            COALESCE(SUM(CASE WHEN e.cd='CD-MTZ' AND e.deposito='0802' THEN e.quantidade END), 0)::int,
            COALESCE(SUM(CASE WHEN e.cd='CD-SP'  AND e.deposito='0803' THEN e.quantidade END), 0)::int,
            COALESCE(SUM(CASE WHEN e.cd='CD-PE'  AND e.deposito='0803' THEN e.quantidade END), 0)::int,
            COALESCE(SUM(e.quantidade), 0)::int,
            r.forecast_mensal
          FROM referencias r
          LEFT JOIN estoque e ON e.ref_cod = r.cod
          WHERE r.ativo = true
          GROUP BY r.cod, r.forecast_mensal
          ON CONFLICT (importado_em, ref_cod) DO NOTHING
          RETURNING 1`;

        return res.status(200).json({ ok: true, zeradas: zeradas.length, historico: snap.length });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    const BATCH = 50;
    const runBatch = async (items, fn) => {
      for (let i = 0; i < items.length; i += BATCH) {
        await Promise.all(items.slice(i, i + BATCH).map(fn));
      }
    };
    // quantidade/forecast são INT no banco: a planilha traz decimais
    // ("5892.328") e o Postgres recusa o valor inteiro.
    const toInt = v => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? n : 0;
    };
    try {
      const regs = Array.isArray(registros) ? registros.filter(r => r?.ref_cod) : [];
      const fc   = Array.isArray(forecast)  ? forecast.filter(f => f?.ref_cod)  : [];

      // O UPDATE de forecast casa por `cod`: sem a linha em referencias ele
      // atinge 0 registros e não acusa erro. Levanta os códigos ausentes numa
      // query só para poder avisar quem importou, em vez de perder o dado.
      const existentes = new Set((await sql`SELECT cod FROM referencias`).map(r => String(r.cod).toUpperCase()));
      const codigos = [...new Set([...regs, ...fc].map(x => String(x.ref_cod).toUpperCase()))];
      const naoCadastradas = codigos.filter(c => !existentes.has(c));

      // Upsert saldos em paralelo (batches de 50)
      await runBatch(regs, r =>
        sql`INSERT INTO estoque (ref_cod, cd, deposito, quantidade, atualizado_em)
          VALUES (${String(r.ref_cod).toUpperCase()}, ${r.cd}, ${r.deposito}, ${toInt(r.quantidade)}, NOW())
          ON CONFLICT (ref_cod, cd, deposito) DO UPDATE
          SET quantidade = EXCLUDED.quantidade, atualizado_em = NOW()`
      );

      // Atualiza forecast nas referências em paralelo (batches de 50)
      await runBatch(fc, f => {
        const cod = String(f.ref_cod).toUpperCase();
        const hasBreakdown = f.forecast_mi_pe != null || f.forecast_mi_sp != null || f.forecast_mi_mtz != null || f.forecast_me != null;
        if (hasBreakdown) {
          const pe  = toInt(f.forecast_mi_pe);
          const sp  = toInt(f.forecast_mi_sp);
          const mtz = toInt(f.forecast_mi_mtz);
          const me  = toInt(f.forecast_me);
          return sql`UPDATE referencias SET
            forecast_mi_pe  = ${pe},
            forecast_mi_sp  = ${sp},
            forecast_mi_mtz = ${mtz},
            forecast_me     = ${me},
            forecast_mensal = ${pe + sp + mtz + me}
            WHERE UPPER(cod) = ${cod}`;
        } else if (f.forecast_mensal != null) {
          return sql`UPDATE referencias SET forecast_mensal = ${toInt(f.forecast_mensal)} WHERE UPPER(cod) = ${cod}`;
        }
        return Promise.resolve();
      });

      return res.status(200).json({
        ok: true,
        saldos: regs.length,
        forecast: fc.filter(f => existentes.has(String(f.ref_cod).toUpperCase())).length,
        nao_cadastradas: naoCadastradas.slice(0, 20),
        nao_cadastradas_total: naoCadastradas.length,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
