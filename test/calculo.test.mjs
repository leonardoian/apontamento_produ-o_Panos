import { necessidadeItem, calcularPrograma } from '../lib/calculo.mjs';
import assert from 'node:assert';
let ok=0, fail=0;
const t=(n,f)=>{ try{f(); console.log('  ok  '+n); ok++; }catch(e){ console.log('  FALHOU '+n+': '+e.message); fail++; } };

console.log('=== casos do projeto original (portados p/ ref_cod) ===');
t('600 pcs / 6 por caixa = 100 caixas', ()=>assert.strictEqual(necessidadeItem(600,6),100));
t('fracionado arredonda pra cima (601/6=101)', ()=>assert.strictEqual(necessidadeItem(601,6),101));
t('etiqueta 1:1 (600 pcs = 600 etiquetas)', ()=>assert.strictEqual(necessidadeItem(600,1),600));

// agora a BOM e indexada por ref_cod (nossa chave), nao por material_id
const boms = new Map([
  ['SP9057', [
    { materialId:10, pcsPorUmc:6 },
    { materialId:20, pcsPorUmc:1 },
    { materialId:30, pcsPorUmc:5 },
  ]],
  ['SP9058', [ { materialId:10, pcsPorUmc:4 } ]],
]);

t('programa 1 item: 600 pcs do SP9057', ()=>{
  const r = calcularPrograma([{refCod:'SP9057',qtdProduzir:600}], boms, new Map([[10,30],[20,0],[30,50]]));
  const caixa=r.find(x=>x.materialId===10);
  assert.strictEqual(caixa.necessidadeTotal,100);
  assert.strictEqual(caixa.aComprar,70);
  assert.strictEqual(r.find(x=>x.materialId===20).aComprar,600);
  const perfil=r.find(x=>x.materialId===30);
  assert.strictEqual(perfil.necessidadeTotal,120);
  assert.strictEqual(perfil.aComprar,70);
});

t('componente compartilhado entre 2 acabados soma', ()=>{
  const r = calcularPrograma(
    [{refCod:'SP9057',qtdProduzir:600},{refCod:'SP9058',qtdProduzir:400}],
    boms, new Map());
  const caixa=r.find(x=>x.materialId===10);
  assert.strictEqual(caixa.necessidadeTotal, 100+100); // ceil(600/6)+ceil(400/4)
});

console.log('\n=== casos especificos da nossa integracao ===');
t('estoque maior que necessidade -> aComprar 0 (nunca negativo)', ()=>{
  const r = calcularPrograma([{refCod:'SP9057',qtdProduzir:600}], boms, new Map([[10,500]]));
  assert.strictEqual(r.find(x=>x.materialId===10).aComprar, 0);
});
t('referencia sem BOM e ignorada, nao quebra', ()=>{
  const r = calcularPrograma([{refCod:'DESCONHECIDA',qtdProduzir:999}], boms, new Map());
  assert.deepStrictEqual(r, []);
});
t('ordena pelo que mais precisa comprar', ()=>{
  const r = calcularPrograma([{refCod:'SP9057',qtdProduzir:600}], boms, new Map());
  assert.deepStrictEqual(r.map(x=>x.materialId), [20,30,10]); // 600 > 120 > 100
});
t('pcs_por_umc fracionario (item em KG) nao e corrompido', ()=>{
  const b = new Map([['X',[{materialId:1,pcsPorUmc:0.25}]]]);
  const r = calcularPrograma([{refCod:'X',qtdProduzir:10}], b, new Map());
  assert.strictEqual(r[0].necessidadeTotal, 40); // 10 / 0.25
});
t('programa vazio -> resultado vazio', ()=>{
  assert.deepStrictEqual(calcularPrograma([], boms, new Map()), []);
});

console.log('\n'+(fail? '>>> '+fail+' FALHA(S)' : '>>> '+ok+' TESTES PASSARAM'));
process.exit(fail?1:0);
