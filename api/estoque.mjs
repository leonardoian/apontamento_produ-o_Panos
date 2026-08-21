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
    try {
      // Upsert saldos
      if (Array.isArray(registros)) {
        for (const r of registros) {
          await sql`INSERT INTO estoque (ref_cod, cd, deposito, quantidade, atualizado_em)
            VALUES (${r.ref_cod}, ${r.cd}, ${r.deposito}, ${r.quantidade ?? 0}, NOW())
            ON CONFLICT (ref_cod, cd, deposito) DO UPDATE
            SET quantidade = EXCLUDED.quantidade, atualizado_em = NOW()`;
        }
      }
      // Atualiza forecast nas referências (suporta breakdown por CD)
      if (Array.isArray(forecast)) {
        for (const f of forecast) {
          if (!f.ref_cod) continue;
          const hasBreakdown = f.forecast_mi_pe != null || f.forecast_mi_sp != null || f.forecast_mi_mtz != null || f.forecast_me != null;
          if (hasBreakdown) {
            const pe  = +f.forecast_mi_pe  || 0;
            const sp  = +f.forecast_mi_sp  || 0;
            const mtz = +f.forecast_mi_mtz || 0;
            const me  = +f.forecast_me     || 0;
            const total = pe + sp + mtz + me;
            await sql`UPDATE referencias SET
              forecast_mi_pe  = ${pe},
              forecast_mi_sp  = ${sp},
              forecast_mi_mtz = ${mtz},
              forecast_me     = ${me},
              forecast_mensal = ${total}
              WHERE cod = ${f.ref_cod}`;
          } else if (f.forecast_mensal != null) {
            await sql`UPDATE referencias SET forecast_mensal = ${f.forecast_mensal} WHERE cod = ${f.ref_cod}`;
          }
        }
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
