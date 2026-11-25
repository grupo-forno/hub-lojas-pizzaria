// Consultas do Resultados ao GA4: eventos do hub (hub_view, hub_unit_open, hub_button_click) + vendas e funil da Tuigo.
// Cada consulta falha sozinha: o que não veio fica null ("Dados indisponíveis") e o resto da tela continua.
// Recebe o módulo `ga` por parâmetro para o teste usar dados de mentira.
//
// REGRA DAS VENDAS: pedido e receita só entram se a sessão da Tuigo trouxer o utm_id de uma campanha CADASTRADA no hub
// (dimensão sessionManualCampaignId = "Session manual campaign ID", preenchida pelo utm_id da URL de entrada).
// UTM parecida, nome de campanha igual ou utm_content=pedeforno NÃO autorizam incluir venda. Compra direta, sem campanha
// e campanha de fora do hub ficam fora, e nenhuma função daqui devolve total da loja como alternativa.
//
// Pendências externas (sem elas as consultas voltam erro e a tela mostra "Dados indisponíveis"):
//  - cadastrar button_id, button_type e unit_id como dimensões personalizadas de EVENTO (Admin › Definições personalizadas);
//  - confirmar com checkCompatibility que sessionManualCampaignId combina com sessions/ecommercePurchases/purchaseRevenue/totalPurchasers;
//  - a Tuigo emitir purchase (e view_item/select_item, hoje ausentes) com transaction_id, value e BRL.
const FUSO = 'America/Sao_Paulo';
const JANELA = 1800; // segundos: "mesma sessão" para a conversão imediata (30 min, o tempo de sessão do GA4)
const EVENTOS = ['hub_view', 'hub_unit_open', 'hub_button_click', 'page_view', 'select_item', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'];
const METRICAS_LOJA = ['sessions', 'addToCarts', 'checkouts', 'ecommercePurchases', 'purchaseRevenue', 'totalPurchasers'];
const TIPOS_PEDIDO = ['pedido', 'promocional']; // botões que levam à loja da Tuigo
const ID_CAMPANHA = 'sessionManualCampaignId';
const LOJA_TUIGO = '/fornopaulista'; // as páginas da Tuigo são /<código-da-loja>/pedidos; o hub pousa em /

const dia = atras => new Date(Date.now() - atras * 864e5).toLocaleDateString('sv-SE', { timeZone: FUSO }); // AAAA-MM-DD
const periodo = dias => [{ startDate: dia(dias - 1), endDate: dia(0) }]; // o GA4 conta o dia no fuso da propriedade

const F = {
  igual: (campo, valor) => ({ filter: { fieldName: campo, stringFilter: { matchType: 'EXACT', value: valor } } }),
  comeca: (campo, valor) => ({ filter: { fieldName: campo, stringFilter: { matchType: 'BEGINS_WITH', value: valor } } }),
  lista: (campo, valores) => ({ filter: { fieldName: campo, inListFilter: { values: valores } } }),
  e: (...x) => { const l = x.filter(Boolean); return l.length === 1 ? l[0] : { andGroup: { expressions: l } }; },
};
const linhas = r => (r?.rows || []).map(l => ({ d: l.dimensionValues.map(x => x.value), m: l.metricValues.map(x => Number(x.value)) }));
const vazioLoja = () => ({ sessoes: 0, carrinho: 0, checkout: 0, compras: 0, receita: 0, compradores: 0 });
const deLinha = m => ({ sessoes: m[0], carrinho: m[1], checkout: m[2], compras: m[3], receita: m[4], compradores: m[5] });
const slugDe = pagina => (pagina || '').split('/')[1] || '';
const semVazio = v => (v === '(not set)' ? '' : v);

// Valor de um indicador: null = consulta falhou ("Dados indisponíveis"); evento que nunca chegou = "Rastreamento em validação".
// Zero só aparece quando a consulta deu certo e o evento existe.
function medida(valor, cobertura, ...eventos) {
  if (valor == null) return { estado: 'indisponivel' };
  if (cobertura && eventos.some(e => cobertura[e] === 0)) return { estado: 'validando' };
  return { valor };
}

// Quantas vezes cada evento chegou no período: só para saber se o evento já existe antes de interpretar um zero.
// (Fica aqui dentro: o total da loja nunca sai desta camada.)
async function cobertura(ga, dias) {
  const r = linhas(await ga.relatorio({ dateRanges: periodo(dias), dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], dimensionFilter: F.lista('eventName', EVENTOS), limit: 100 }));
  const c = Object.fromEntries(EVENTOS.map(e => [e, 0]));
  const usuarios = Object.fromEntries(EVENTOS.map(e => [e, 0]));
  for (const { d, m } of r) { c[d[0]] = m[0]; usuarios[d[0]] = m[1]; }
  return { eventos: c, usuarios };
}

// Vendas das campanhas cadastradas (`ids` = utm_id de cada uma). Sem campanha cadastrada: zero válido, sem consulta.
// `unidade` (código da loja) filtra pela página de entrada na Tuigo. Tudo exige o utm_id: não há caminho sem ele.
async function vendas(ga, dias, ids, unidade, tentar) {
  if (!ids.length) return { total: vazioLoja(), porCampanha: {}, porUnidade: {}, porBotao: {} };
  // O hub também carrega o utm_id (as sessões do hub têm a mesma campanha): só entram sessões que pousaram na Tuigo.
  const filtro = F.e(F.lista(ID_CAMPANHA, ids), F.comeca('landingPage', unidade ? `/${unidade}/` : LOJA_TUIGO));
  const rel = dimensions => ga.relatorio({ dateRanges: periodo(dias), dimensions: dimensions.map(name => ({ name })), metrics: METRICAS_LOJA.map(name => ({ name })), dimensionFilter: filtro, limit: 10000 });
  const [total, porCampanha, porUnidade, porBotao] = await Promise.all([
    tentar('vendas_total', async () => deLinha(linhas(await rel([]))[0]?.m || [0, 0, 0, 0, 0, 0])), // usuários distintos de todas as campanhas juntas
    tentar('vendas_campanha', async () => Object.fromEntries(linhas(await rel([ID_CAMPANHA])).map(({ d, m }) => [d[0], deLinha(m)]))),
    tentar('vendas_unidade', async () => Object.fromEntries(linhas(await rel(['landingPage'])).map(({ d, m }) => [slugDe(d[0]), deLinha(m)]))),
    // Botão: só há evidência quando o utm_term é o id de um botão (o hub o põe quando a campanha não definiu termo).
    tentar('vendas_botao', async () => Object.fromEntries(linhas(await rel([ID_CAMPANHA, 'sessionManualTerm'])).map(({ d, m }) => [`${d[0]}|${semVazio(d[1])}`, deLinha(m)]))),
  ]);
  return { total, porCampanha, porUnidade, porBotao };
}

// Só as vendas (com a cobertura dos eventos para distinguir zero de "ainda não medido"): usado pela lista de campanhas.
async function vendasDe(ga, dias, ids, unidade) {
  const erros = {};
  const tentar = async (nome, f) => { try { return await f(); } catch (e) { erros[nome] = String(e.message).slice(0, 300); return null; } };
  const [cob, v] = await Promise.all([tentar('cobertura', () => cobertura(ga, dias)), vendas(ga, dias, ids, unidade, tentar)]);
  return { vendas: v, cobertura: cob?.eventos || null, erros };
}

async function medir(ga, dias, { ids = [], unidade } = {}) {
  const erros = {};
  const tentar = async (nome, f) => { try { return await f(); } catch (e) { erros[nome] = String(e.message).slice(0, 300); return null; } };
  const rel = (dimensions, metrics, dimensionFilter) => ga.relatorio({ dateRanges: periodo(dias), dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })), dimensionFilter, limit: 10000 });

  const [cob, pedidoUsuarios, unidades, botoes, v] = await Promise.all([
    tentar('cobertura', () => cobertura(ga, dias)),
    tentar('pedido_usuarios', async () => linhas(await rel([], ['totalUsers'], F.e(F.igual('eventName', 'hub_button_click'), F.lista('customEvent:button_type', TIPOS_PEDIDO))))[0]?.m[0] ?? 0),
    tentar('por_unidade', async () => linhas(await rel(['customEvent:unit_id', 'customEvent:button_type', 'eventName'], ['totalUsers', 'eventCount'], F.lista('eventName', ['hub_unit_open', 'hub_button_click'])))),
    tentar('por_botao', async () => linhas(await rel(['customEvent:button_id'], ['eventCount', 'totalUsers'], F.igual('eventName', 'hub_button_click')))),
    vendas(ga, dias, ids, unidade, tentar),
  ]);
  const ev = cob?.eventos || null;
  const hubView = cob ? { visitas: ev.hub_view, usuarios: cob.usuarios.hub_view } : null;

  // Hub por unidade e por botão (usuários únicos de cada recorte; não se soma entre linhas).
  const porUnidade = {};
  for (const { d, m } of unidades || []) {
    const [unit, tipo, evento] = d;
    const u = porUnidade[unit] ??= {};
    if (evento === 'hub_unit_open') u.abriram = m[0]; else u[tipo] = { usuarios: m[0], cliques: m[1] };
  }
  const porBotao = Object.fromEntries((botoes || []).map(({ d, m }) => [d[0], { cliques: m[0], usuarios: m[1] }]));

  return {
    ok: true, erros, cobertura: ev, hubView, dimensoes: !erros.por_unidade && !erros.por_botao,
    pedidoUsuarios: pedidoUsuarios == null ? null : medida(pedidoUsuarios, ev, 'hub_button_click'),
    porUnidade: unidades ? porUnidade : null, porBotao: botoes ? porBotao : null,
    vendas: v,
  };
}

// Funil filtrado. `f` = { unidade, botao, ids } (ids = utm_id das campanhas em foco: todas as cadastradas ou a escolhida). Duas partes, cada uma no seu escopo:
//  - hub: usuários que entraram e que clicaram em pedido (eventos do hub), só de sessões com o utm_id da campanha;
//  - Tuigo: usuários das sessões com o mesmo utm_id, etapa a etapa.
// A conversão HUB → TUIGO só existe numa jornada medida de ponta a ponta (_gl aceito pela Tuigo); enquanto isso
// não for validado (GA4_ENTRE_DOMINIOS=1), ela fica indisponível: juntar contagens só por UTM não prova a sequência.
async function funil(ga, dias, f = {}, { entreDominios = false } = {}) {
  const dr = periodo(dias);
  const ids = f.ids || [];
  const campanha = F.lista(ID_CAMPANHA, ids.length ? ids : ['(nenhuma)']);
  const rel = (dimensions, filtro) => ga.relatorio({ dateRanges: dr, dimensions: dimensions.map(name => ({ name })), metrics: [{ name: 'totalUsers' }], dimensionFilter: filtro, limit: 100 });
  const erros = {};
  const tentar = async (nome, fn) => { try { return await fn(); } catch (e) { erros[nome] = String(e.message).slice(0, 300); return null; } };
  const semCampanha = !ids.length; // nenhuma campanha cadastrada: zero válido, sem consulta
  const [cob, entrou, clicou, tuigo] = await Promise.all([
    tentar('cobertura', () => cobertura(ga, dias)),
    semCampanha ? 0 : tentar('hub_view', async () => linhas(await rel([], F.e(F.igual('eventName', 'hub_view'), campanha)))[0]?.m[0] ?? 0),
    semCampanha ? 0 : tentar('hub_clique', async () => linhas(await rel([], F.e(F.igual('eventName', 'hub_button_click'), F.lista('customEvent:button_type', TIPOS_PEDIDO),
      f.unidade && F.igual('customEvent:unit_id', f.unidade), f.botao && F.igual('customEvent:button_id', f.botao), campanha)))[0]?.m[0] ?? 0),
    semCampanha ? {} : tentar('tuigo', async () => Object.fromEntries(linhas(await rel(['eventName'], F.e(campanha,
      F.lista('eventName', ['page_view', 'select_item', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase']),
      F.comeca('landingPage', f.unidade ? `/${f.unidade}/` : LOJA_TUIGO), f.botao && F.igual('sessionManualTerm', f.botao)))).map(({ d, m }) => [d[0], m[0]]))),
  ]);
  const ev = cob?.eventos || null;
  const passo = (nome, escopo, valor, ...eventos) => ({ nome, escopo, ...medida(valor, ev, ...eventos) });
  const produto = tuigo && Math.max(tuigo.select_item || 0, tuigo.view_item || 0);
  const passos = [
    passo('Entrou no hub', 'hub', entrou, 'hub_view'),
    passo('Clicou em pedido', 'hub', clicou, 'hub_view', 'hub_button_click'),
    passo('Chegou à unidade na Tuigo', 'tuigo', tuigo && (tuigo.page_view || 0), 'page_view'),
    // A Tuigo não emite select_item nem view_item: a etapa só existe quando um dos dois chegar.
    passo('Abriu ou selecionou produto', 'tuigo', produto, 'select_item', 'view_item'),
    passo('Colocou no carrinho', 'tuigo', tuigo && (tuigo.add_to_cart || 0), 'add_to_cart'),
    passo('Iniciou checkout', 'tuigo', tuigo && (tuigo.begin_checkout || 0), 'begin_checkout'),
    passo('Comprou', 'tuigo', tuigo && (tuigo.purchase || 0), 'purchase'),
  ];
  // Conversão sobre a etapa anterior do MESMO escopo (a última com número). Entre hub e Tuigo: indisponível.
  let anterior = null;
  for (const p of passos) {
    if (anterior && anterior.escopo !== p.escopo) p.conversao = { estado: 'indisponivel', motivo: 'A jornada hub → Tuigo ainda não é medida ponta a ponta.' };
    else if (anterior && p.valor != null) p.conversao = anterior.valor ? { valor: p.valor / anterior.valor } : { estado: 'indisponivel', motivo: 'Etapa anterior sem usuários.' };
    if (p.valor != null) anterior = p;
  }
  const filtrosHub = { unidade: !!f.unidade, botao: !!f.botao };
  let jornada = { disponivel: false, motivo: 'A Tuigo ainda não aceita o _gl do hub (cada lado cria seu próprio usuário). Cadastre os dois domínios no GA4 e valide; depois ligue GA4_ENTRE_DOMINIOS=1.' };
  // Mesmo com GA4_ENTRE_DOMINIOS ligada a jornada não é consultada aqui: uma consulta sem filtro de campanha devolveria
  // compras de toda a propriedade. Falta validar no GA4 real o filtro por utm_id na API de funil (alfa) antes de implementar.
  if (entreDominios) jornada = { disponivel: false, motivo: 'Jornada hub → Tuigo por campanha ainda não implementada: falta validar o filtro por utm_id na consulta de funil do GA4 real.' };
  return { dias, janela: `${JANELA / 60} min`, filtros: { unidade: f.unidade, botao: f.botao }, filtrosHub, passos, jornada, erros };
}

module.exports = { medir, vendasDe, funil, medida, TIPOS_PEDIDO, ID_CAMPANHA };
