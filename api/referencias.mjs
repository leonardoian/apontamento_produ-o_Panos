import { setCors, handleOptions, getAuth, getBody, getSQL, initDB } from "./_lib/db.mjs";

const _CELULA_NORM = {
  importacao:'Importacao',importação:'Importacao',
  aluminio:'Aluminio','alumínio':'Aluminio',
  panos:'Panos',rodos:'Rodos',manual:'Manual',placas:'Placas',
  bettanin:'Bettanin',sanremo:'Sanremo',
  revendaindustrial:'RevendaIndustrial',
  bettaninindustrial:'BettaninIndustrial',
  importacaomanual:'ImportacaoManual',
};
function normCelula(c) {
  if (!c || !String(c).trim()) return null;
  const key = String(c).trim().toLowerCase().replace(/\s+/g,'');
  return _CELULA_NORM[key] || String(c).trim();
}

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  if (req.method === "GET") {
    try {
      const rows = await sql`SELECT cod, descricao, meta_hora, celula, peso_unitario, estoque_atual, forecast_mensal, forecast_mi_pe, forecast_mi_sp, forecast_mi_mtz, forecast_me FROM referencias WHERE ativo = true ORDER BY cod`;
      return res.status(200).json(rows);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { cod, descricao, meta_hora, celula, peso_unitario, estoque_atual, forecast_mensal,
            forecast_mi_pe, forecast_mi_sp, forecast_mi_mtz, forecast_me } = getBody(req);
    if (!cod || !descricao) return res.status(400).json({ error: "cod e descricao obrigatórios" });
    // null = não fornecido → ON CONFLICT preserva o valor existente via COALESCE
    const celVal  = (celula != null && celula !== '') ? normCelula(celula) : null;
    const insertCel = celVal || 'Panos';
    const pesoVal   = (peso_unitario  != null && String(peso_unitario).trim()  !== '') ? +peso_unitario  : null;
    const estVal    = (estoque_atual   != null && String(estoque_atual).trim()  !== '') ? +estoque_atual  : null;
    const miPeVal   = (forecast_mi_pe  != null && String(forecast_mi_pe).trim()  !== '') ? +forecast_mi_pe  : null;
    const miSpVal   = (forecast_mi_sp  != null && String(forecast_mi_sp).trim()  !== '') ? +forecast_mi_sp  : null;
    const miMtzVal  = (forecast_mi_mtz != null && String(forecast_mi_mtz).trim() !== '') ? +forecast_mi_mtz : null;
    const meVal     = (forecast_me     != null && String(forecast_me).trim()     !== '') ? +forecast_me     : null;
    // Se vieram breakdowns, calcula o total; senão usa o forecast_mensal explícito
    const hasBreakdown = miPeVal != null || miSpVal != null || miMtzVal != null || meVal != null;
    const fcComputed = hasBreakdown ? (miPeVal||0) + (miSpVal||0) + (miMtzVal||0) + (meVal||0) : null;
    const fcVal     = hasBreakdown ? fcComputed
      : (forecast_mensal != null && String(forecast_mensal).trim() !== '') ? +forecast_mensal : null;
    try {
      if (meta_hora === undefined) {
        await sql`INSERT INTO referencias (cod, descricao, meta_hora, celula, peso_unitario, estoque_atual, forecast_mensal, forecast_mi_pe, forecast_mi_sp, forecast_mi_mtz, forecast_me)
          VALUES (${cod.toUpperCase()}, ${descricao}, null, ${insertCel}, ${pesoVal}, ${estVal}, ${fcVal}, ${miPeVal}, ${miSpVal}, ${miMtzVal}, ${meVal})
          ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao,
            celula = COALESCE(${celVal}, referencias.celula),
            peso_unitario = EXCLUDED.peso_unitario,
            estoque_atual = COALESCE(${estVal}, referencias.estoque_atual),
            forecast_mensal = COALESCE(${fcVal}, referencias.forecast_mensal),
            forecast_mi_pe  = COALESCE(${miPeVal},  referencias.forecast_mi_pe),
            forecast_mi_sp  = COALESCE(${miSpVal},  referencias.forecast_mi_sp),
            forecast_mi_mtz = COALESCE(${miMtzVal}, referencias.forecast_mi_mtz),
            forecast_me     = COALESCE(${meVal},     referencias.forecast_me),
            ativo = true`;
      } else {
        await sql`INSERT INTO referencias (cod, descricao, meta_hora, celula, peso_unitario, estoque_atual, forecast_mensal, forecast_mi_pe, forecast_mi_sp, forecast_mi_mtz, forecast_me)
          VALUES (${cod.toUpperCase()}, ${descricao}, ${meta_hora}, ${insertCel}, ${pesoVal}, ${estVal}, ${fcVal}, ${miPeVal}, ${miSpVal}, ${miMtzVal}, ${meVal})
          ON CONFLICT (cod) DO UPDATE SET descricao = EXCLUDED.descricao, meta_hora = EXCLUDED.meta_hora,
            celula = COALESCE(${celVal}, referencias.celula),
            peso_unitario = EXCLUDED.peso_unitario,
            estoque_atual = COALESCE(${estVal}, referencias.estoque_atual),
            forecast_mensal = COALESCE(${fcVal}, referencias.forecast_mensal),
            forecast_mi_pe  = COALESCE(${miPeVal},  referencias.forecast_mi_pe),
            forecast_mi_sp  = COALESCE(${miSpVal},  referencias.forecast_mi_sp),
            forecast_mi_mtz = COALESCE(${miMtzVal}, referencias.forecast_mi_mtz),
            forecast_me     = COALESCE(${meVal},     referencias.forecast_me),
            ativo = true`;
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    if (u.perfil !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { cod } = getBody(req);
    try {
      await sql`UPDATE referencias SET ativo = false WHERE cod = ${cod}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
