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
            COALESCE(SUM(p.meta_turno * p.num_turnos) FILTER (WHERE p.mes_ano = ${mes} AND p.ativo = true), 0)::int AS meta_total
          FROM referencias r
          LEFT JOIN estoque e ON e.ref_cod = r.cod
          LEFT JOIN programa p ON p.ref_cod = r.cod
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
    const { registros, forecast } = getBody(req);
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
