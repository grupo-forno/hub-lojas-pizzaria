// GA4 de mentira para testar a aba Resultados e Campanhas sem credenciais: um mini "runReport" sobre eventos inventados.
// Cenário (nada disso foi visto em produção; os eventos hub_* e purchase ainda estão em validação). Valores todos diferentes,
// para qualquer soma indevida aparecer na conta:
//  - campanha A (cadastrada, WhatsApp, utm_id A): u1 botão REGULAR, abre o card, compra R$ 89,90; u2 botão PROMOCIONAL, põe no carrinho e não compra;
//  - campanha B (cadastrada, Instagram, utm_id B): u3 botão regular da Dom Severino compra R$ 123,45; u6 Hugo compra R$ 55,50; u4 só WhatsApp do Hugo;
//  - campanha EXTERNA (utm_id de fora do hub, MESMOS nomes de origem/meio/campanha da A): 2 compras de R$ 5.000 (fora);
//  - link ANTIGO do hub, sem utm_id (utm_content=pedeforno): compra de R$ 777 (fora: sem utm_id não há prova);
//  - 108 acessos diretos à Tuigo da Dom Severino (R$ 70) e 12 do Hugo (R$ 60): fora.
// Uso: GA_FALSO=1 npm run dev   (ou require('./scripts/ga-falso.js').instalar(ga) nos testes)
const SEV = '/fornopaulistadomseverino/pedidos', HUGO = '/fornopaulistaleste/pedidos';
const base = { sessionSource: '(direct)', sessionMedium: '(none)', sessionCampaignName: '(not set)', sessionManualAdContent: '(not set)', sessionManualTerm: '(not set)', sessionManualCampaignId: '(not set)' };
const REGULAR = 'domseverino_pedido', PROMO = 'promocional_domseverino_41';
const CAMPANHA_A = 'pf_aaaaaaaaaa', CAMPANHA_B = 'pf_bbbbbbbbbb', EXTERNA = 'black_friday_ext';

function dados() {
  const e = [];
  const hub = (user, sessao, utm, nome, extra = {}) => e.push({ ...base, ...utm, user, sessao, eventName: nome, ...extra });
  const tuigo = (user, sessao, utm, landing, nome, extra = {}) => e.push({ ...base, ...utm, user, sessao, eventName: nome, landingPage: landing, ...extra });
  const A = { sessionSource: 'whatsapp', sessionMedium: 'messaging', sessionCampaignName: 'black_friday_2026', sessionManualCampaignId: CAMPANHA_A };
  const B = { sessionSource: 'instagram', sessionMedium: 'organic_social', sessionCampaignName: 'bio', sessionManualCampaignId: CAMPANHA_B };
  const ext = { ...A, sessionManualCampaignId: EXTERNA };
  const clique = (u, s, utm, id, tipo, unit) => hub(u, s, utm, 'hub_button_click', { 'customEvent:button_id': id, 'customEvent:button_type': tipo, 'customEvent:unit_id': unit });
  const compra = (u, s, utm, landing, valor) => {
    for (const n of ['page_view', 'add_to_cart', 'begin_checkout']) tuigo(u, s, utm, landing, n);
    tuigo(u, s, utm, landing, 'purchase', { valor });
  };
  // A — botão regular (compra) e promocional (sem compra)
  hub('u1', 'h1', A, 'hub_view'); hub('u1', 'h1', A, 'hub_unit_open', { 'customEvent:unit_id': 'fornopaulistadomseverino' });
  clique('u1', 'h1', A, REGULAR, 'pedido', 'fornopaulistadomseverino');
  compra('u1', 't1', { ...A, sessionManualAdContent: 'pedeforno', sessionManualTerm: REGULAR }, SEV, 89.9);
  hub('u2', 'h2', A, 'hub_view'); clique('u2', 'h2', A, PROMO, 'promocional', 'fornopaulistadomseverino');
  for (const n of ['page_view', 'add_to_cart']) tuigo('u2', 't2', { ...A, sessionManualAdContent: 'pedeforno', sessionManualTerm: PROMO }, SEV, n);
  // B
  hub('u3', 'h3', B, 'hub_view'); hub('u3', 'h3', B, 'hub_unit_open', { 'customEvent:unit_id': 'fornopaulistadomseverino' });
  clique('u3', 'h3', B, REGULAR, 'pedido', 'fornopaulistadomseverino');
  compra('u3', 't3', { ...B, sessionManualAdContent: 'pedeforno', sessionManualTerm: REGULAR }, SEV, 123.45);
  hub('u4', 'h4', B, 'hub_view'); hub('u4', 'h4', B, 'hub_unit_open', { 'customEvent:unit_id': 'fornopaulistaleste' });
  clique('u4', 'h4', B, 'leste_whatsapp', 'whatsapp', 'fornopaulistaleste');
  hub('u6', 'h6', B, 'hub_view'); clique('u6', 'h6', B, 'leste_pedido', 'pedido', 'fornopaulistaleste');
  compra('u6', 't6', { ...B, sessionManualAdContent: 'pedeforno', sessionManualTerm: 'leste_pedido' }, HUGO, 55.5);
  // campanha externa (mesmos nomes da A, outro utm_id), link antigo sem utm_id, acessos diretos
  hub('u7', 'h7', ext, 'hub_view');
  for (const i of [1, 2]) compra('x' + i, 'tx' + i, ext, SEV, 5000);
  compra('o1', 'to1', { sessionSource: 'whatsapp', sessionMedium: 'messaging', sessionCampaignName: 'black_friday_2026', sessionManualAdContent: 'pedeforno' }, SEV, 777);
  for (let i = 0; i < 108; i++) for (const n of ['page_view', 'purchase']) tuigo('d' + i, 'td' + i, {}, SEV, n, { valor: 70 });
  for (let i = 0; i < 12; i++) for (const n of ['page_view', 'purchase']) tuigo('l' + i, 'tl' + i, {}, HUGO, n, { valor: 60 });
  return e;
}

// Filtros da Data API (só o que o Resultados usa) avaliados sobre um registro.
function passa(f, r) {
  if (!f) return true;
  if (f.andGroup) return f.andGroup.expressions.every(x => passa(x, r));
  const { fieldName, stringFilter: s, inListFilter: l } = f.filter;
  const v = String(r[fieldName] ?? '(not set)');
  if (l) return l.values.includes(v);
  return { EXACT: v === s.value, CONTAINS: v.includes(s.value), BEGINS_WITH: v.startsWith(s.value) }[s.matchType];
}
const METRICAS = {
  eventCount: g => g.length,
  totalUsers: g => new Set(g.map(r => r.user)).size,
  sessions: g => new Set(g.map(r => r.sessao)).size,
  addToCarts: g => g.filter(r => r.eventName === 'add_to_cart').length,
  checkouts: g => g.filter(r => r.eventName === 'begin_checkout').length,
  ecommercePurchases: g => g.filter(r => r.eventName === 'purchase').length,
  purchaseRevenue: g => g.filter(r => r.eventName === 'purchase').reduce((s, r) => s + (r.valor || 0), 0),
  totalPurchasers: g => new Set(g.filter(r => r.eventName === 'purchase').map(r => r.user)).size,
};

function criar(opcoes = {}) {
  const eventos = opcoes.eventos || dados();
  const chamadas = [];
  const relatorio = async corpo => {
    chamadas.push(corpo);
    if (opcoes.falharEm && JSON.stringify(corpo).includes(opcoes.falharEm)) throw new Error('GA4: 400 consulta recusada (' + opcoes.falharEm + ')');
    if (opcoes.semDimensoesPersonalizadas && JSON.stringify(corpo).includes('customEvent:')) throw new Error('GA4: 400 dimensão customEvent não cadastrada');
    const dims = corpo.dimensions.map(d => d.name);
    const grupos = new Map();
    for (const r of eventos.filter(r => passa(corpo.dimensionFilter, r))) {
      const k = dims.map(d => String(r[d] ?? '(not set)'));
      const g = grupos.get(k.join('\u0001')) || { k, linhas: [] };
      g.linhas.push(r); grupos.set(k.join('\u0001'), g);
    }
    const rows = [...grupos.values()].map(g => ({ dimensionValues: g.k.map(value => ({ value })), metricValues: corpo.metrics.map(m => ({ value: String(METRICAS[m.name](g.linhas)) })) }));
    return { rows };
  };
  return { relatorio, chamadas, configurado: () => true };
}

// Liga o falso no módulo ga.js real (resultados.js lê as funções pelo objeto).
function instalar(ga, opcoes) { const f = criar(opcoes); Object.assign(ga, { relatorio: f.relatorio, configurado: f.configurado }); return f; }

module.exports = { criar, instalar, dados, REGULAR, PROMO, CAMPANHA_A, CAMPANHA_B, EXTERNA };
