// Campanhas do hub: cadastro (nome, UTMs, utm_id estável, link), listagem com resultados e detalhe.
// O utm_id liga tudo: o link leva o utm_id até a página e até a Tuigo; as vendas só entram na campanha pelo utm_id
// (ver resultados-ga.js). Origem/meio/campanha/link não mudam depois de criados: links já distribuídos seguem valendo.
const crypto = require('crypto');
const { query } = require('./db.js');
const ga = require('./ga.js');
const rga = require('./resultados-ga.js');
const { inicio } = require('./periodo.js');
const { identificar } = require('../../analytics.js');
const { lojas: LOJAS } = require('../../lojas.js');

const SLUG = /^[a-z0-9][a-z0-9_.-]{0,59}$/; // o mesmo formato que a página aceita gravar (api/evento.js)
const UID = /^pf_[0-9a-f]{10}$/;
const COLUNAS = 'id, uid, nome, origem, meio, campanha, conteudo, termo, link, criado, arquivada';
const SEM_GA = { estado: 'indisponivel', motivo: 'O Google Analytics só aparece no site publicado (as credenciais ficam na Vercel).' };

// Eventos da campanha: os que trazem o utm_id dela; e os ANTIGOS (sem utm_id) cujos origem/meio/campanha são exatamente os dela
// (os três são únicos entre campanhas, então a correspondência é verificável). Venda nunca usa essa ponte: só o utm_id.
const DA_CAMPANHA = `(e.campanha_id = c.uid or (e.campanha_id is null and e.origem = c.origem and e.meio = c.meio and e.campanha = c.campanha))`;

const slug = v => String(v ?? '').trim();
function linkDaCampanha(site, c) {
  const u = new URL('/', site);
  for (const [k, v] of [['utm_source', c.origem], ['utm_medium', c.meio], ['utm_campaign', c.campanha], ['utm_id', c.uid], ['utm_content', c.conteudo], ['utm_term', c.termo]]) if (v) u.searchParams.set(k, v);
  return u.href; // URLSearchParams já codifica
}

async function criar(b, site) {
  const nome = slug(b.nome);
  if (!nome || nome.length > 80) return { status: 400, corpo: { erro: 'Dê um nome interno de até 80 letras.' } };
  const c = { nome, origem: slug(b.origem).toLowerCase(), meio: slug(b.meio).toLowerCase(), campanha: slug(b.campanha).toLowerCase(), conteudo: slug(b.conteudo).toLowerCase() || null, termo: slug(b.termo).toLowerCase() || null };
  for (const [k, rotulo, obrigatorio] of [['origem', 'Origem', 1], ['meio', 'Meio', 1], ['campanha', 'Campanha', 1], ['conteudo', 'Conteúdo'], ['termo', 'Termo']]) {
    if (!c[k] ? obrigatorio : !SLUG.test(c[k])) return { status: 400, corpo: { erro: `${rotulo}: use letras minúsculas, números, ponto, traço ou _ (até 60).` } };
  }
  const igual = await query('select nome from campanhas where origem = $1 and meio = $2 and campanha = $3', [c.origem, c.meio, c.campanha]);
  if (igual.rowCount) return { status: 409, corpo: { erro: `Já existe a campanha "${igual.rows[0].nome}" com essa origem, meio e campanha. Mude um deles.` } };
  for (let i = 0; i < 5; i++) { // o utm_id é sorteado; colisão é quase impossível, mas se houver tentamos outro
    c.uid = `pf_${crypto.randomBytes(5).toString('hex')}`;
    c.link = linkDaCampanha(site, c);
    try {
      const r = await query(`insert into campanhas (uid, nome, origem, meio, campanha, conteudo, termo, link) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${COLUNAS}`,
        [c.uid, c.nome, c.origem, c.meio, c.campanha, c.conteudo, c.termo, c.link]);
      return { status: 200, corpo: { campanha: r.rows[0] } };
    } catch (e) { if (e.code !== '23505' || !/uid/.test(e.constraint || e.detail || '')) throw e; }
  }
  throw new Error('não foi possível gerar um utm_id único');
}

// Só o nome e o arquivamento mudam; arquivar não apaga eventos nem vendas e o link continua valendo.
async function mudar(b) {
  if (!UID.test(b.uid || '')) return { status: 400, corpo: { erro: 'Campanha inválida.' } };
  const sets = [], v = [];
  if ('nome' in b) { const nome = slug(b.nome); if (!nome || nome.length > 80) return { status: 400, corpo: { erro: 'Dê um nome interno de até 80 letras.' } }; v.push(nome); sets.push(`nome = $${v.length}`); }
  if ('arquivada' in b) { v.push(!!b.arquivada); sets.push(`arquivada = $${v.length}`); }
  if (!sets.length) return { status: 400, corpo: { erro: 'Nada para mudar.' } };
  v.push(b.uid);
  const r = await query(`update campanhas set ${sets.join(', ')} where uid = $${v.length} returning ${COLUNAS}`, v);
  return r.rowCount ? { status: 200, corpo: { campanha: r.rows[0] } } : { status: 404, corpo: { erro: 'Campanha não encontrada.' } };
}

const todas = async () => (await query(`select ${COLUNAS} from campanhas order by arquivada, criado desc, id desc`)).rows;

// Campanhas em foco para vendas e funil: a escolhida ou TODAS AS CADASTRADAS (arquivadas contam: o histórico é delas).
// Retorna null se a escolhida não existe (a API responde 400 em vez de cair no total).
async function idsEmFoco(uid, origem) {
  if (uid) return (await query('select 1 from campanhas where uid = $1', [uid])).rowCount ? [uid] : null;
  if (origem) return (await query('select uid from campanhas where origem = $1', [origem])).rows.map(r => r.uid);
  return (await query('select uid from campanhas')).rows.map(r => r.uid);
}

// Lista com resultados do período: visitas e cliques do hub (banco) + pedidos e receita (GA4, só pelo utm_id).
async function listar(dias) {
  const DE = inicio(dias - 1);
  const [lista, hub] = await Promise.all([
    todas(),
    query(`select c.uid, count(*) filter (where e.tipo = 'view')::int visitas, count(*) filter (where e.tipo = 'click')::int cliques,
      count(*) filter (where e.tipo = 'click' and e.acao = 'pedido')::int cliques_pedido, count(*) filter (where e.id is not null and e.campanha_id is null)::int antigos
      from campanhas c left join eventos e on ${DA_CAMPANHA} and e.ts >= ${DE} group by c.uid`),
  ]);
  const porUid = Object.fromEntries(hub.rows.map(r => [r.uid, r]));
  let vendas = null;
  if (ga.configurado() && lista.length) {
    try { vendas = await rga.vendasDe(ga, dias, lista.map(c => c.uid)); } catch (e) { console.error('campanhas ga', e.message); }
  }
  const medida = (c, campo) => {
    if (!ga.configurado()) return SEM_GA;
    if (!vendas?.vendas.porCampanha) return { estado: 'indisponivel' };
    return rga.medida(vendas.vendas.porCampanha[c.uid]?.[campo] ?? 0, vendas.cobertura, 'purchase');
  };
  return lista.map(c => ({ ...c, ...(porUid[c.uid] || { visitas: 0, cliques: 0, cliques_pedido: 0, antigos: 0 }), pedidos: medida(c, 'compras'), receita: medida(c, 'receita') }));
}

// Uma campanha: cliques por botão e unidade, vendas (só pelo utm_id) e as etapas disponíveis da jornada.
async function detalhe(uid, dias) {
  const c = (await query(`select ${COLUNAS} from campanhas where uid = $1`, [uid])).rows[0];
  if (!c) return null;
  const DE = inicio(dias - 1);
  const [botoesDb, orfaos, totais, nomes] = await Promise.all([
    query(`select l.id, l.acao, l.titulo, l.url, l.loja, l.ativo, b.nome bnome, b.titulo btitulo, b.loja bloja,
      (select count(*)::int from eventos e, campanhas c where c.uid = $1 and ${DA_CAMPANHA} and e.link_id = l.id and e.tipo = 'click' and e.ts >= ${DE}) cliques
      from links l left join links b on b.id = l.pai where l.tipo = 'acao' order by b.ordem, b.id, l.ordem, l.id`, [uid]),
    query(`select e.link_id, count(*)::int cliques from eventos e, campanhas c where c.uid = $1 and ${DA_CAMPANHA} and e.tipo = 'click' and e.link_id is not null and e.ts >= ${DE}
      and not exists (select 1 from links l where l.id = e.link_id) group by 1 order by 2 desc`, [uid]),
    query(`select count(*) filter (where e.tipo = 'view')::int visitas, count(*) filter (where e.tipo = 'abrir')::int aberturas, count(*) filter (where e.tipo = 'click')::int cliques,
      count(*) filter (where e.tipo = 'click' and e.acao = 'pedido')::int cliques_pedido, count(*) filter (where e.campanha_id is null)::int antigos
      from eventos e, campanhas c where c.uid = $1 and ${DA_CAMPANHA} and e.ts >= ${DE}`, [uid]),
    query(`select distinct on (loja) loja, coalesce(nullif(titulo, ''), nome) nome from links where tipo = 'bloco' and loja is not null and loja <> '' order by loja, ordem`),
  ]);
  const nomeLoja = Object.fromEntries(nomes.rows.map(n => [n.loja, n.nome]));
  const configurado = ga.configurado();
  let vendas = null, jornada = null;
  if (configurado) {
    [vendas, jornada] = await Promise.all([
      rga.vendasDe(ga, dias, [uid]).catch(() => null),
      rga.funil(ga, dias, { ids: [uid] }, { entreDominios: process.env.GA4_ENTRE_DOMINIOS === '1' }).catch(() => null),
    ]);
  }
  const v = vendas?.vendas, cob = vendas?.cobertura;
  const med = (x, campo) => (!configurado ? SEM_GA : !x ? { estado: 'indisponivel' } : rga.medida(x[campo] ?? 0, cob, 'purchase'));
  // Venda por botão só com evidência: o hub grava o id do botão em utm_term quando a campanha não define termo.
  // Se a campanha define o próprio termo, não há como distinguir os botões: as vendas ficam só no total.
  const semEvidencia = !!c.termo;
  const botoes = botoesDb.rows.map(b => {
    const id = identificar({ id: b.id, acao: b.acao, loja: b.loja, url: b.url, titulo: b.titulo }, { nome: b.bnome, titulo: b.btitulo, loja: b.bloja }, LOJAS);
    const unidade = id.unit_id || '';
    const x = v?.porBotao ? (v.porBotao[`${uid}|${id.button_id}`] || {}) : null;
    const levaALoja = ['pedido', 'promocional'].includes(id.button_type);
    const motivo = semEvidencia ? 'A campanha define utm_term: as vendas ficam só no total da campanha.' : 'Esse botão não leva à loja.';
    const vendaBotao = campo => (!levaALoja || semEvidencia ? { estado: 'indisponivel', motivo } : med(x, campo));
    return { link_id: b.id, button_id: id.button_id, button_type: id.button_type, unidade, unidade_nome: nomeLoja[unidade] || '', ativo: b.ativo, cliques: b.cliques,
      nome: !b.titulo ? (b.bnome || `Link ${b.id}`) : !b.bnome || b.bnome === b.titulo ? b.titulo : `${b.bnome} › ${b.titulo}`, pedidos: vendaBotao('compras'), receita: vendaBotao('receita') };
  }).filter(b => b.cliques > 0 || b.pedidos.valor > 0).concat(orfaos.rows.map(o => ({ link_id: o.link_id, nome: `Link ${o.link_id} (removido)`, removido: true, cliques: o.cliques })));
  const porUnidade = {};
  for (const b of botoes) if (b.unidade) porUnidade[b.unidade] = (porUnidade[b.unidade] || 0) + b.cliques;
  return {
    campanha: c, dias, hub: totais.rows[0], botoes,
    unidades: Object.entries(porUnidade).map(([loja, cliques]) => ({ loja, nome: nomeLoja[loja] || loja, cliques })).filter(u => u.cliques),
    vendas: { pedidos: med(v?.total, 'compras'), receita: med(v?.total, 'receita'), compradores: med(v?.total, 'compradores') },
    jornada,
  };
}

async function operar(b, site) {
  if (b.acao === 'criar') return criar(b, site);
  if (b.acao === 'renomear') return mudar({ uid: b.uid, nome: b.nome });
  if (b.acao === 'arquivar' || b.acao === 'restaurar') return mudar({ uid: b.uid, arquivada: b.acao === 'arquivar' });
  return { status: 400, corpo: { erro: 'Ação desconhecida.' } };
}

module.exports = { operar, listar, todas, detalhe, idsEmFoco, linkDaCampanha, UID };
