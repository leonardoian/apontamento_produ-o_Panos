import { setCors, handleOptions, getAuth, getBody, getSQL, initDB } from "./_lib/db.mjs";
import { calcularPrograma } from "../lib/calculo.mjs";

// Lista técnica (BOM) e necessidade de compra.
// Consolidado por ?recurso= para caber no limite de 12 Serverless Functions
// do plano Hobby da Vercel:
//   (vazio)    GET/POST/DELETE  componentes do catálogo (`materiais`)
//   itens      GET/POST/DELETE  BOM de uma referência
//   estoque    POST             saldo dos componentes
//   calculo    GET              necessidade × estoque × a comprar de um mês
//   pedidos    GET/POST/DELETE  pedidos de compra por (mês, componente)

export default async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const u = getAuth(req);
  if (!u) return res.status(401).json({ error: "Não autorizado" });
  const isAdmin = u.perfil === "admin";

  let sql;
  try { sql = getSQL(); } catch (e) { return res.status(500).json({ error: e.message }); }
  try { await initDB(sql); } catch (e) { return res.status(500).json({ error: "Erro initDB: " + e.message }); }

  const recurso = req.query?.recurso || "";
  const negado = () => res.status(403).json({ error: "Acesso negado" });

  try {
    // ── Catálogo de componentes ──────────────────────────────────────────
    if (!recurso) {
      if (req.method === "GET") {
        const busca = String(req.query?.q || "").trim();
        const rows = busca
          ? await sql`
            SELECT m.id, m.codigo, m.descricao, m.umc,
                   COALESCE(e.qtd_atual, 0)::float AS qtd_atual
            FROM materiais m
            LEFT JOIN estoque_materiais e ON e.material_id = m.id
            WHERE m.codigo ILIKE ${'%' + busca + '%'} OR m.descricao ILIKE ${'%' + busca + '%'}
            ORDER BY m.codigo LIMIT 300`
          : await sql`
            SELECT m.id, m.codigo, m.descricao, m.umc,
                   COALESCE(e.qtd_atual, 0)::float AS qtd_atual
            FROM materiais m
            LEFT JOIN estoque_materiais e ON e.material_id = m.id
            ORDER BY m.codigo LIMIT 300`;
        return res.status(200).json(rows);
      }
      if (req.method === "POST") {
        if (!isAdmin) return negado();
        const { codigo, descricao, umc } = getBody(req);
        if (!codigo || !descricao) return res.status(400).json({ error: "codigo e descricao obrigatórios" });
        const [row] = await sql`
          INSERT INTO materiais (codigo, descricao, umc)
          VALUES (${String(codigo).trim().toUpperCase()}, ${descricao}, ${umc || 'PC'})
          ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao, umc = EXCLUDED.umc
          RETURNING id, codigo, descricao, umc`;
        return res.status(200).json(row);
      }
      if (req.method === "DELETE") {
        if (!isAdmin) return negado();
        const { id } = getBody(req);
        // Sem ON DELETE CASCADE de propósito: apagar um componente ainda
        // usado silenciosamente corromperia a BOM que o referencia.
        const [{ usos }] = await sql`SELECT COUNT(*)::int AS usos FROM bom_itens WHERE material_id = ${id}`;
        if (usos > 0) return res.status(409).json({ error: `Componente usado em ${usos} lista(s) técnica(s)` });
        await sql`DELETE FROM estoque_materiais WHERE material_id = ${id}`;
        await sql`DELETE FROM materiais WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: "Método não permitido" });
    }

    // ── BOM de uma referência ────────────────────────────────────────────
    if (recurso === "itens") {
      if (req.method === "GET") {
        const ref = String(req.query?.ref || "").toUpperCase();
        if (!ref) return res.status(400).json({ error: "ref obrigatória" });
        const rows = await sql`
          SELECT b.id, b.material_id, b.pcs_por_umc::float, m.codigo, m.descricao, m.umc,
                 COALESCE(e.qtd_atual, 0)::float AS qtd_atual
          FROM bom_itens b
          JOIN materiais m ON m.id = b.material_id
          LEFT JOIN estoque_materiais e ON e.material_id = b.material_id
          WHERE UPPER(b.ref_cod) = ${ref}
          ORDER BY m.codigo`;
        return res.status(200).json(rows);
      }
      if (req.method === "POST") {
        if (!isAdmin) return negado();
        const { ref_cod, material_id, pcs_por_umc } = getBody(req);
        const pcs = Number(pcs_por_umc);
        if (!ref_cod || !material_id) return res.status(400).json({ error: "ref_cod e material_id obrigatórios" });
        if (!(pcs > 0)) return res.status(400).json({ error: "pcs_por_umc deve ser maior que zero" });
        await sql`
          INSERT INTO bom_itens (ref_cod, material_id, pcs_por_umc, atualizado_em)
          VALUES (${String(ref_cod).toUpperCase()}, ${material_id}, ${pcs}, NOW())
          ON CONFLICT (ref_cod, material_id)
          DO UPDATE SET pcs_por_umc = EXCLUDED.pcs_por_umc, atualizado_em = NOW()`;
        return res.status(200).json({ ok: true });
      }
      if (req.method === "DELETE") {
        if (!isAdmin) return negado();
        const { id } = getBody(req);
        await sql`DELETE FROM bom_itens WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: "Método não permitido" });
    }

    // ── Saldo dos componentes ────────────────────────────────────────────
    if (recurso === "estoque") {
      if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });
      if (!isAdmin) return negado();
      const { material_id, qtd_atual } = getBody(req);
      if (!material_id) return res.status(400).json({ error: "material_id obrigatório" });
      await sql`
        INSERT INTO estoque_materiais (material_id, qtd_atual, atualizado_em)
        VALUES (${material_id}, ${Number(qtd_atual) || 0}, NOW())
        ON CONFLICT (material_id) DO UPDATE
        SET qtd_atual = EXCLUDED.qtd_atual, atualizado_em = NOW()`;
      return res.status(200).json({ ok: true });
    }

    // ── Necessidade de compra do mês ─────────────────────────────────────
    if (recurso === "calculo") {
      if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });
      const mes = String(req.query?.mes || "");
      if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: "mes no formato AAAA-MM obrigatório" });

      // O programa aqui é o nosso: meta_turno × num_turnos por referência.
      const programa = await sql`
        SELECT ref_cod, SUM(meta_turno * num_turnos)::int AS qtd
        FROM programa WHERE mes_ano = ${mes} AND ativo = true
        GROUP BY ref_cod`;
      const bom = await sql`
        SELECT ref_cod, material_id, pcs_por_umc::float FROM bom_itens`;
      const est = await sql`
        SELECT material_id, qtd_atual::float FROM estoque_materiais`;

      const boms = new Map();
      for (const b of bom) {
        const k = String(b.ref_cod).toUpperCase();
        if (!boms.has(k)) boms.set(k, []);
        boms.get(k).push({ materialId: Number(b.material_id), pcsPorUmc: Number(b.pcs_por_umc) });
      }
      const estoque = new Map(est.map(e => [Number(e.material_id), Number(e.qtd_atual)]));
      const itens = programa.map(p => ({ refCod: String(p.ref_cod).toUpperCase(), qtdProduzir: Number(p.qtd) }));

      const calc = calcularPrograma(itens, boms, estoque);

      // Referências programadas que ainda não têm lista técnica: sem isso o
      // resultado parece completo mas está subestimando a necessidade.
      const semBom = itens.filter(i => !boms.has(i.refCod)).map(i => i.refCod);

      if (!calc.length) return res.status(200).json({ itens: [], sem_bom: semBom });

      const ids = calc.map(c => c.materialId);
      const mats = await sql`
        SELECT m.id, m.codigo, m.descricao, m.umc,
               COALESCE(SUM(p.qtd_pedida) FILTER (WHERE p.mes_ano = ${mes}), 0)::float AS ja_pedido
        FROM materiais m
        LEFT JOIN pedidos_compra p ON p.material_id = m.id
        WHERE m.id = ANY(${ids})
        GROUP BY m.id, m.codigo, m.descricao, m.umc`;
      const porId = new Map(mats.map(m => [Number(m.id), m]));

      return res.status(200).json({
        mes,
        sem_bom: semBom,
        itens: calc.map(c => ({ ...c, ...(porId.get(c.materialId) || {}) })),
      });
    }

    // ── Pedidos de compra ────────────────────────────────────────────────
    if (recurso === "pedidos") {
      if (req.method === "GET") {
        const mes = String(req.query?.mes || "");
        const rows = await sql`
          SELECT p.id, p.mes_ano, p.material_id, p.numero_pedido, p.qtd_pedida::float,
                 p.previsao_entrega, p.entregue, m.codigo, m.descricao
          FROM pedidos_compra p
          JOIN materiais m ON m.id = p.material_id
          WHERE p.mes_ano = ${mes}
          ORDER BY m.codigo, p.id`;
        return res.status(200).json(rows);
      }
      if (req.method === "POST") {
        if (!isAdmin) return negado();
        const { id, mes_ano, material_id, numero_pedido, qtd_pedida, previsao_entrega, entregue } = getBody(req);
        if (id) {
          await sql`
            UPDATE pedidos_compra SET
              numero_pedido = ${numero_pedido || null},
              qtd_pedida = ${qtd_pedida != null ? Number(qtd_pedida) : null},
              previsao_entrega = ${previsao_entrega || null},
              entregue = ${!!entregue}
            WHERE id = ${id}`;
          return res.status(200).json({ ok: true });
        }
        if (!mes_ano || !material_id) return res.status(400).json({ error: "mes_ano e material_id obrigatórios" });
        await sql`
          INSERT INTO pedidos_compra (mes_ano, material_id, numero_pedido, qtd_pedida, previsao_entrega, entregue)
          VALUES (${mes_ano}, ${material_id}, ${numero_pedido || null},
                  ${qtd_pedida != null ? Number(qtd_pedida) : null},
                  ${previsao_entrega || null}, ${!!entregue})`;
        return res.status(200).json({ ok: true });
      }
      if (req.method === "DELETE") {
        if (!isAdmin) return negado();
        const { id } = getBody(req);
        await sql`DELETE FROM pedidos_compra WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: "Método não permitido" });
    }

    return res.status(404).json({ error: "Recurso desconhecido: " + recurso });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
