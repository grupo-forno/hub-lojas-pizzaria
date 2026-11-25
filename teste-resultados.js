// Checagem das consultas do Resultados ao GA4, com o GA4 de mentira (scripts/ga-falso.js). Não precisa de Docker nem de internet.
//   node teste-resultados.js
// O caso que estava errado: vendas só podem vir de campanhas CADASTRADAS (utm_id). Compra direta, campanha de fora do hub com
// os mesmos nomes, link antigo sem utm_id e utm_content=pedeforno não entram; e uma falha do GA4 nunca vira "vendas gerais".
const assert = require('assert');
const rga = require('./api/_lib/resultados-ga.js');
const { criar, dados, REGULAR, PROMO, CAMPANHA_A: A, CAMPANHA_B: B, EXTERNA } = require('./scripts/ga-falso.js');
const SEV = 'fornopaulistadomseverino', HUGO = 'fornopaulistaleste';
const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

(async () => {
  const f = criar();
  const medirCom = (ids, unidade) => rga.medir(f, 30, { ids, unidade });

  // "Todas as campanhas" = só as duas cadastradas (89,90 + 123,45 + 55,50). Fora: 2 × 5.000 externos, 777 antigo, 108 × 70 e 12 × 60 diretos.
  const todas = (await medirCom([A, B])).vendas;
  assert.deepStrictEqual([todas.total.compras, todas.total.compradores], [3, 3]);
  perto(todas.total.receita, 268.85);
  perto(todas.porCampanha[A].receita, 89.9); perto(todas.porCampanha[B].receita, 178.95);
  assert.strictEqual(todas.porCampanha[EXTERNA], undefined, 'campanha de fora do hub não aparece');
  // Uma campanha só devolve as vendas dela
  const soA = (await medirCom([A])).vendas;
  assert.strictEqual(soA.total.compras, 1); perto(soA.total.receita, 89.9);
  const soB = (await medirCom([B])).vendas;
  assert.strictEqual(soB.total.compras, 2); perto(soB.total.receita, 178.95);
  // A campanha externa tem os mesmos nomes da A, mas utm_id diferente: não é da A
  assert.strictEqual(soA.porCampanha[EXTERNA], undefined);
  // Unidade
  const sev = (await medirCom([A, B], `${SEV}`)).vendas;
  assert.strictEqual(sev.total.compras, 2); perto(sev.total.receita, 213.35);
  const hugo = (await medirCom([A, B], HUGO)).vendas;
  assert.strictEqual(hugo.total.compras, 1); perto(hugo.total.receita, 55.5);
  assert.deepStrictEqual(Object.keys(todas.porUnidade).sort(), [HUGO, SEV].sort());
  // Botões da mesma campanha para a mesma loja: venda por botão só com evidência (utm_term = id do botão)
  assert.strictEqual(todas.porBotao[`${A}|${REGULAR}`].compras, 1);
  assert.strictEqual(todas.porBotao[`${A}|${PROMO}`].compras, 0, 'o promocional chegou à loja e não comprou: zero real');
  assert.strictEqual(todas.porBotao[`${A}|${PROMO}`].sessoes, 1);
  // Sem campanha cadastrada: zero válido, sem nem perguntar ao GA4 (e jamais total da loja)
  const antes = f.chamadas.length;
  const nenhuma = (await rga.medir(f, 30, { ids: [] })).vendas;
  assert.deepStrictEqual([nenhuma.total.compras, nenhuma.total.receita], [0, 0]);
  assert.strictEqual(f.chamadas.slice(antes).filter(c => JSON.stringify(c).includes('ecommercePurchases')).length, 0);
  // Toda consulta de venda exige o utm_id: nenhuma sai sem o filtro por sessionManualCampaignId
  const consultasDeVenda = f.chamadas.filter(c => c.metrics.some(m => m.name === 'ecommercePurchases'));
  assert.ok(consultasDeVenda.length > 0 && consultasDeVenda.every(c => JSON.stringify(c.dimensionFilter).includes('sessionManualCampaignId')), 'venda sem filtro de utm_id');
  assert.ok(!JSON.stringify(f.chamadas).includes('sessionManualAdContent'), 'utm_content não autoriza venda');

  // Falha do GA4 na consulta de vendas: indisponível, nunca o total da loja
  const quebrado = await rga.medir(criar({ falharEm: 'sessionManualCampaignId' }), 30, { ids: [A, B] });
  assert.strictEqual(quebrado.vendas.total, null); assert.strictEqual(quebrado.vendas.porCampanha, null);
  assert.strictEqual(quebrado.vendas.porUnidade, null); assert.strictEqual(quebrado.vendas.porBotao, null);
  assert.ok(quebrado.erros.vendas_total);
  assert.strictEqual(quebrado.hubView.usuarios, 6, 'o que não depende da consulta quebrada continua');
  const caiu = await rga.medir({ relatorio: async () => { throw new Error('GA4: 503'); } }, 30, { ids: [A] });
  assert.strictEqual(caiu.vendas.total, null); assert.strictEqual(caiu.hubView, null);
  assert.ok(!JSON.stringify(quebrado).includes('5000') && !JSON.stringify(caiu).includes('7649'), 'nenhum total da loja no retorno');

  // Estados: purchase nunca chegou → "em validação"; zero só com evento existente
  const semCompra = await rga.medir(criar({ eventos: dados().filter(e => e.eventName !== 'purchase') }), 30, { ids: [A, B] });
  assert.deepStrictEqual(rga.medida(semCompra.vendas.total.compras, semCompra.cobertura, 'purchase'), { estado: 'validando' });
  assert.deepStrictEqual(rga.medida(todas.total.compras, (await medirCom([A])).cobertura, 'purchase'), { valor: 3 });
  const semHub = await rga.medir(criar({ eventos: dados().filter(e => !e.eventName.startsWith('hub_')) }), 30, { ids: [A, B] });
  assert.deepStrictEqual(rga.medida(semHub.hubView.usuarios, semHub.cobertura, 'hub_view'), { estado: 'validando' });
  const semDim = await rga.medir(criar({ semDimensoesPersonalizadas: true }), 30, { ids: [A, B] });
  assert.strictEqual(semDim.dimensoes, false); assert.strictEqual(semDim.porUnidade, null); assert.strictEqual(semDim.vendas.total.compras, 3, 'vendas não dependem das dimensões do hub');

  // Datas: 30 dias inteiros no fuso de São Paulo
  const [{ startDate, endDate }] = f.chamadas[0].dateRanges;
  assert.strictEqual(Math.round((Date.parse(endDate) - Date.parse(startDate)) / 864e5), 29);
  assert.strictEqual(endDate, new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }));

  // Funil: só sessões das campanhas cadastradas, nos dois escopos
  const valores = fu => fu.passos.map(p => p.valor);
  const fu = await rga.funil(criar(), 30, { ids: [A, B] });
  assert.deepStrictEqual(valores(fu), [5, 4, 4, undefined, 4, 3, 3]);
  assert.deepStrictEqual(valores(await rga.funil(criar(), 30, { ids: [A] })), [2, 2, 2, undefined, 2, 1, 1]);
  assert.deepStrictEqual(valores(await rga.funil(criar(), 30, { ids: [A, B], unidade: SEV })), [5, 3, 3, undefined, 3, 2, 2]);
  assert.deepStrictEqual(valores(await rga.funil(criar(), 30, { ids: [A], botao: PROMO })), [2, 1, 1, undefined, 1, 0, 0]);
  assert.deepStrictEqual(valores(await rga.funil(criar(), 30, { ids: [] })), [0, 0, 0, undefined, 0, 0, 0], 'sem campanha cadastrada: zero, nunca total da loja');
  const p = nome => fu.passos.find(x => x.nome === nome);
  assert.strictEqual(p('Abriu ou selecionou produto').estado, 'validando', 'a Tuigo não emite select_item/view_item');
  assert.strictEqual(p('Chegou à unidade na Tuigo').conversao.estado, 'indisponivel', 'hub → Tuigo não é conversão sem jornada medida');
  assert.strictEqual(p('Clicou em pedido').conversao.valor, 0.8);
  assert.strictEqual(p('Colocou no carrinho').conversao.valor, 1);
  assert.strictEqual(p('Iniciou checkout').conversao.valor, 0.75);
  // GA4_ENTRE_DOMINIOS ligada não inventa jornada sem filtro de campanha
  const ligada = await rga.funil(criar(), 30, { ids: [A, B] }, { entreDominios: true });
  assert.strictEqual(ligada.jornada.disponivel, false);
  assert.ok(!JSON.stringify(ligada).includes('funnelTable'));
  console.log('ok: vendas só de campanhas cadastradas (utm_id), estados e funil');
})().catch(e => { console.error(e); process.exit(1); });
