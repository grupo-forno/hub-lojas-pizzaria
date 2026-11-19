// Números da aba Resultados: o que a página registra (visitas, aberturas, cliques) + o funil do GA4 (loja, carrinho, compra).
const { query } = require('./db.js');
const ga = require('./ga.js');

const FUSO = 'America/Fortaleza'; // Teresina (UTC-3, sem horário de verão)
const METRICAS = ['sessions', 'addToCarts', 'checkouts', 'ecommercePurchases', 'purchaseRevenue'];
const vazio = () => ({ sessoes: 0, carrinho: 0, checkout: 0, compras: 0, receita: 0 });
function somar(alvo, valores) {
  const [sessoes, carrinho, checkout, compras, receita] = valores.map(Number);
  Object.assign(alvo, { sessoes: alvo.sessoes + sessoes, carrinho: alvo.carrinho + carrinho, checkout: alvo.checkout + checkout, compras: alvo.compras + compras, receita: alvo.receita + receita });
  return alvo;
}

const CONTAGENS = `count(*) filter (where tipo = 'view')::int visitas, count(*) filter (where tipo = 'abrir')::int aberturas,
  count(*) filter (where tipo = 'click')::int cliques, count(*) filter (where tipo = 'click' and acao = 'pedido')::int pedidos`;

async function resultados(dias) {
  const ate = new Date();
  const de = new Date(ate - dias * 864e5);
  const antes = new Date(de - dias * 864e5);
  const [totais, anterior, diario, links, sociais, origens, lojas, aparelhos, nomes] = await Promise.all([
    query(`select ${CONTAGENS} from eventos where ts >= $1`, [de]),
    query(`select ${CONTAGENS} from eventos where ts >= $1 and ts < $2`, [antes, de]),
    query(`select to_char(ts at time zone '${FUSO}', 'YYYY-MM-DD') dia, count(*) filter (where tipo = 'view')::int visitas, count(*) filter (where tipo = 'click')::int cliques
      from eventos where ts >= $1 group by 1 order by 1`, [de]),
    query(`select e.link_id, count(*)::int cliques, max(l.titulo) titulo, max(coalesce(nullif(b.nome, ''), b.titulo)) bloco, max(e.acao) acao
      from eventos e left join links l on l.id = e.link_id left join links b on b.id = l.pai
      where e.tipo = 'click' and e.ts >= $1 and e.link_id is not null group by e.link_id order by 2 desc limit 15`, [de]),
    query(`select acao, count(*)::int cliques from eventos where tipo = 'click' and link_id is null and acao is not null and ts >= $1 group by 1 order by 2 desc`, [de]),
    query(`select coalesce(origem, '(sem origem)') origem, coalesce(meio, '') meio, campanha, ${CONTAGENS}
      from eventos where ts >= $1 group by 1, 2, 3 order by visitas desc, cliques desc limit 30`, [de]),
    query(`select loja, count(*) filter (where tipo = 'abrir')::int aberturas, count(*) filter (where tipo = 'click' and acao = 'pedido')::int pedidos,
      count(*) filter (where tipo = 'click' and acao = 'whatsapp')::int whatsapp, count(*) filter (where tipo = 'click' and acao = 'mapa')::int mapa
      from eventos where loja is not null and ts >= $1 group by 1 order by 3 desc, 2 desc`, [de]),
    query(`select coalesce(dispositivo, 'sem informação') dispositivo, count(*)::int visitas from eventos where tipo = 'view' and ts >= $1 group by 1 order by 2 desc`, [de]),
    query(`select distinct on (loja) loja, coalesce(nullif(titulo, ''), nome) nome from links where tipo = 'bloco' and loja is not null and loja <> '' order by loja, ordem`),
  ]);
  const nomeLoja = Object.fromEntries(nomes.rows.map(n => [n.loja, n.nome]));
  const r = {
    dias, de, ate,
    totais: totais.rows[0], anterior: anterior.rows[0],
    diario: diario.rows, links: links.rows, sociais: sociais.rows, aparelhos: aparelhos.rows,
    origens: origens.rows.map(o => ({ ...o, ga: null })),
    lojas: lojas.rows.map(l => ({ ...l, nome: nomeLoja[l.loja] || l.loja, ga: null })),
    ga: { ok: false, motivo: 'O Google Analytics só aparece no site publicado (as credenciais ficam na Vercel).' },
  };
  if (!ga.configurado()) return r;

  try {
    const periodo = [{ startDate: `${dias - 1}daysAgo`, endDate: 'today' }];
    const metricas = METRICAS.map(name => ({ name }));
    const [porOrigem, porPagina] = await Promise.all([
      ga.relatorio({ dateRanges: periodo, dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }], metrics: metricas, limit: 5000 }),
      ga.relatorio({ dateRanges: periodo, dimensions: [{ name: 'landingPage' }], metrics: metricas, limit: 5000 }),
    ]);
    // O link da página leva a UTM até o site de pedidos: casamos origem + meio + campanha.
    const chave = (o, m, c) => `${o}|${m}|${c || '(not set)'}`;
    const porUtm = {};
    for (const row of porOrigem.rows || []) {
      const [o, m, c] = row.dimensionValues.map(d => d.value);
      somar(porUtm[chave(o, m, c)] ??= vazio(), row.metricValues.map(v => v.value));
    }
    const total = vazio(); // só o que veio pela página
    for (const o of r.origens) {
      o.ga = porUtm[chave(o.origem, o.meio, o.campanha)] || vazio();
      somar(total, [o.ga.sessoes, o.ga.carrinho, o.ga.checkout, o.ga.compras, o.ga.receita]);
    }
    // Por unidade: a primeira parte do endereço no site de pedidos é o código da loja (/fornopaulistasul/pedidos).
    const porLoja = {};
    for (const row of porPagina.rows || []) {
      const loja = row.dimensionValues[0].value.split('/')[1] || '';
      somar(porLoja[loja] ??= vazio(), row.metricValues.map(v => v.value));
    }
    for (const l of r.lojas) l.ga = porLoja[l.loja] || vazio();
    r.ga = { ok: true, total };
  } catch (e) {
    console.error('ga', e.message);
    r.ga = { ok: false, motivo: 'Não foi possível ler o Google Analytics agora. Os números da página continuam valendo.' };
  }
  return r;
}

module.exports = { resultados };
