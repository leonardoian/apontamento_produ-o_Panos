// ============================================================
// Núcleo do cálculo de necessidade de compra.
// JS puro, sem dependência de banco — testável isoladamente.
// Portado de lib/calculo.js do projeto Sexta_basica_SP, trocando o
// material_id do acabado pelo nosso ref_cod (chave natural em `referencias`).
// Fica fora de api/ de propósito: só api/*.mjs vira Serverless Function.
// ============================================================

// Necessidade de UM componente para UM item do programa.
// Núcleo portado de lib/calculo.js do projeto Sexta_basica_SP.
export function necessidadeItem(qtdProduzir, pcsPorUmc, arredondar = true) {
  const bruta = qtdProduzir / pcsPorUmc;
  return arredondar ? Math.ceil(bruta) : bruta;
}

// Explode o programa e agrega a necessidade por componente.
// arredondarPorItem=true arredonda cada referência e soma — cada uma é
// produzida em separado, não compartilham a mesma caixa.
export function calcularPrograma(programaItens, boms, estoque, opts = {}) {
  const arredondarPorItem = opts.arredondarPorItem ?? true;
  const acc = new Map();

  for (const { refCod, qtdProduzir } of programaItens) {
    const bom = boms.get(refCod);
    if (!bom) continue; // referência sem BOM cadastrada
    for (const { materialId, pcsPorUmc } of bom) {
      const nec = necessidadeItem(qtdProduzir, pcsPorUmc, arredondarPorItem);
      acc.set(materialId, (acc.get(materialId) ?? 0) + nec);
    }
  }

  const resultado = [];
  for (const [materialId, necBruta] of acc) {
    const necessidadeTotal = arredondarPorItem ? necBruta : Math.ceil(necBruta);
    const estoqueAtual = estoque.get(materialId) ?? 0;
    resultado.push({
      materialId,
      necessidadeTotal,
      estoqueAtual,
      aComprar: Math.max(0, necessidadeTotal - estoqueAtual),
    });
  }
  resultado.sort((a, b) => b.aComprar - a.aComprar);
  return resultado;
}
