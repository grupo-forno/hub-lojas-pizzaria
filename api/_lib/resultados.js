// Números da aba Resultados: o que a página registra (visitas, aberturas, cliques) + o que o GA4 mede (usuários, funil, compras).
// Visitas e cliques vêm do banco (a página não usa cookie: cada abertura é uma visita, a mesma pessoa pode contar mais de uma vez).
// Usuários, compradores e pedidos vêm do GA4; sem o GA4 (ou sem o evento chegando) a tela mostra o estado, nunca um zero inventado.
const { query } = require('./db.js');
const ga = require('./ga.js');
const rga = require('./resultados-ga.js');
const campanhas = require('./campanhas.js');
const { identificar } = require('../../analytics.js');
const { lojas: LOJAS } = require('../../lojas.js');

const { FUSO, inicio } = require('./periodo.js');

const CONTAGENS = `count(*) filter (where tipo = 'view')::int visitas, count(*) filter (where tipo = 'abrir')::int aberturas,
  count(*) filter (where tipo = 'click')::int cliques, count(*) filter (where tipo = 'click' and acao = 'pedido')::int pedidos`;

const ESTADO_NAO_CONFIGURADO = { estado: 'indisponivel', motivo: 'O Google Analytics só aparece no site publicado (as credenciais ficam na Vercel).' };
const taxa = (usuarios, base) => {
  if (usuarios.valor == null) return { estado: usuarios.estado };
  if (base.valor == null) return { estado: base.estado };
  return base.valor > 0 ? { valor: usuarios.valor / base.valor } : { estado: 'indisponivel', motivo: 'Ninguém foi exposto ao botão no período.' };
};

// filtros: { campanha (utm_id), unidade (código da loja) } valem para vendas e funil. Sem campanha escolhida = TODAS AS CADASTRADAS.
// As vendas só chegam pelo utm_id de campanha cadastrada; nada aqui devolve o total da loja.
async function resultados(dias, filtros = {}) {
  const ids = await campanhas.idsEmFoco(filtros.campanha);
  if (!ids) throw Object.assign(new Error('Campanha não encontrada.'), { status: 400 });
  const DE = inicio(dias - 1), ANTES = inicio(2 * dias - 1);
  const [totais, anterior, diario, links, sociais, origens, lojas, aparelhos, nomes, botoesDb, orfaos, deLinha] = await Promise.all([
    query(`select ${CONTAGENS} from eventos where ts >= ${DE}`),
    query(`select ${CONTAGENS} from eventos where ts >= ${ANTES} and ts < ${DE}`),
    query(`select to_char(ts at time zone '${FUSO}', 'YYYY-MM-DD') dia, count(*) filter (where tipo = 'view')::int visitas, count(*) filter (where tipo = 'click')::int cliques
      from eventos where ts >= ${DE} group by 1 order by 1`),
    query(`select e.link_id, count(*)::int cliques, max(l.titulo) titulo, max(coalesce(nullif(b.nome, ''), b.titulo)) bloco, max(e.acao) acao
      from eventos e left join links l on l.id = e.link_id left join links b on b.id = l.pai
      where e.tipo = 'click' and e.ts >= ${DE} and e.link_id is not null group by e.link_id order by 2 desc limit 15`),
    query(`select acao, count(*)::int cliques from eventos where tipo = 'click' and link_id is null and acao is not null and ts >= ${DE} group by 1 order by 2 desc`),
    query(`select coalesce(origem, '(sem origem)') origem, coalesce(meio, '') meio, campanha, ${CONTAGENS}
      from eventos where ts >= ${DE} group by 1, 2, 3 order by visitas desc, cliques desc limit 30`),
    query(`select loja, count(*) filter (where tipo = 'abrir')::int aberturas, count(*) filter (where tipo = 'click' and acao = 'pedido')::int pedidos,
      count(*) filter (where tipo = 'click' and acao = 'whatsapp')::int whatsapp, count(*) filter (where tipo = 'click' and acao = 'mapa')::int mapa
      from eventos where loja is not null and ts >= ${DE} group by 1 order by 3 desc, 2 desc`),
    query(`select coalesce(dispositivo, 'sem informação') dispositivo, count(*)::int visitas from eventos where tipo = 'view' and ts >= ${DE} group by 1 order by 2 desc`),
    query(`select distinct on (loja) loja, coalesce(nullif(titulo, ''), nome) nome from links where tipo = 'bloco' and loja is not null and loja <> '' order by loja, ordem`),
    // Todos os botões cadastrados (inclusive os de zero cliques), com o bloco a que pertencem.
    query(`select l.id, l.acao, l.titulo, l.url, l.loja, l.ativo, b.nome bnome, b.titulo btitulo, b.loja bloja, b.opcoes bopcoes,
      (select count(*)::int from eventos e where e.link_id = l.id and e.tipo = 'click' and e.ts >= ${DE}) cliques
      from links l left join links b on b.id = l.pai where l.tipo = 'acao' order by b.ordem, b.id, l.ordem, l.id`),
    // Botões removidos que ainda têm histórico de cliques no período.
    query(`select e.link_id, count(*)::int cliques from eventos e where e.tipo = 'click' and e.link_id is not null and e.ts >= ${DE}
      and not exists (select 1 from links l where l.id = e.link_id) group by 1 order by 2 desc`),
    query(`select ${DE} de`),
  ]);
  const cadastradas = await campanhas.todas();
  const nomeLoja = Object.fromEntries(nomes.rows.map(n => [n.loja, n.nome]));
  const r = {
    dias, de: deLinha.rows[0].de, ate: new Date(),
    totais: totais.rows[0], anterior: anterior.rows[0],
    diario: diario.rows, links: links.rows, sociais: sociais.rows, aparelhos: aparelhos.rows,
    origens: origens.rows.map(o => ({ ...o, ga: null })),
    lojas: lojas.rows.map(l => ({ ...l, nome: nomeLoja[l.loja] || l.loja, ga: null })),
    ga: { ok: false, motivo: ESTADO_NAO_CONFIGURADO.motivo },
  };

  // Botões já com o id que a página manda ao GA4 (mesma função do navegador: o id nunca diverge).
  const botoes = botoesDb.rows.map(b => {
    const bloco = { nome: b.bnome, titulo: b.btitulo, loja: b.bloja };
    const id = identificar({ id: b.id, acao: b.acao, loja: b.loja, url: b.url, titulo: b.titulo }, bloco, LOJAS);
    const unidade = id.unit_id || '';
    return { link_id: b.id, ...id, ativo: b.ativo, cliques: b.cliques, unidade, unidade_nome: nomeLoja[unidade] || '',
      nome: !b.titulo ? (b.bnome || `Link ${b.id}`) : !b.bnome || b.bnome === b.titulo ? b.titulo : `${b.bnome} › ${b.titulo}`,
      // Card recolhido: só vê o botão quem abriu o card. Bloco já aberto: exposição automática, tratada à parte.
      base_tipo: b.bloja && b.bopcoes?.visibilidade === 'recolhido' ? 'card' : 'automatica' };
  });
  r.opcoes = {
    unidades: nomes.rows.map(n => ({ loja: n.loja, nome: n.nome })),
    botoes: botoes.filter(b => rga.TIPOS_PEDIDO.includes(b.button_type)).map(b => ({ id: b.button_id, nome: b.nome, unidade: b.unidade })),
    campanhas: cadastradas.map(c => ({ uid: c.uid, nome: c.nome, arquivada: c.arquivada })),
    origens: [...new Set(cadastradas.map(c => c.origem))],
  };
  r.filtros = { campanha: filtros.campanha || '', unidade: filtros.unidade || '' };

  const semGA = () => {
    const nd = ESTADO_NAO_CONFIGURADO;
    r.visao = { usuarios: nd, pedidoUsuarios: nd, compradores: nd, pedidos: nd, receita: nd };
    r.botoes = botoes.filter(b => b.ativo || b.cliques).map(b => ({ ...b, usuarios: nd, base: { tipo: b.base_tipo, ...nd }, taxa: nd }))
      .concat(orfaos.rows.map(o => ({ link_id: o.link_id, nome: `Link ${o.link_id} (removido)`, removido: true, cliques: o.cliques, usuarios: nd, base: nd, taxa: nd })));
    r.unidades = r.opcoes.unidades.map(u => ({ ...u, abriram: nd, pedido: nd, whatsapp: nd, localizacao: nd, chegadas: nd, compradores: nd }));
  };
  if (!ga.configurado()) { semGA(); return r; }

  try {
    const g = await rga.medir(ga, dias, { ids, unidade: filtros.unidade });
    const cob = g.cobertura;
    const m = (v, ...ev) => rga.medida(v, cob, ...ev);
    r.ga = { ok: true, erros: g.erros, dimensoes: g.dimensoes, existe: Object.fromEntries(Object.entries(cob || {}).map(([k, n]) => [k, n > 0])) }; // só "existe": o total de eventos da loja não sai daqui
    r.visao = {
      usuarios: g.hubView ? m(g.hubView.usuarios, 'hub_view') : { estado: 'indisponivel' },
      pedidoUsuarios: g.pedidoUsuarios || { estado: 'indisponivel' },
      // Vendas: só de campanhas cadastradas (utm_id). Falha na consulta = indisponível, nunca o total da loja.
      compradores: g.vendas.total ? m(g.vendas.total.compradores, 'purchase') : { estado: 'indisponivel' },
      pedidos: g.vendas.total ? m(g.vendas.total.compras, 'purchase') : { estado: 'indisponivel' },
      receita: g.vendas.total ? m(g.vendas.total.receita, 'purchase') : { estado: 'indisponivel' },
    };
    // Unidades: usuários que abriram o card / clicaram em cada botão, chegadas à Tuigo e compradores atribuídos.
    const pu = g.porUnidade;
    const usu = (u, tipo) => (pu ? m(pu[u]?.[tipo]?.usuarios ?? 0, 'hub_button_click') : { estado: 'indisponivel' });
    r.unidades = r.opcoes.unidades.map(u => ({
      ...u,
      abriram: pu ? m(pu[u.loja]?.abriram ?? 0, 'hub_unit_open') : { estado: 'indisponivel' },
      pedido: usu(u.loja, 'pedido'), whatsapp: usu(u.loja, 'whatsapp'), localizacao: usu(u.loja, 'localizacao'),
      chegadas: g.vendas.porUnidade ? m(g.vendas.porUnidade[u.loja]?.sessoes ?? 0, 'page_view') : { estado: 'indisponivel' },
      compradores: g.vendas.porUnidade ? m(g.vendas.porUnidade[u.loja]?.compradores ?? 0, 'purchase') : { estado: 'indisponivel' },
    }));

    // Botões: todos, mais os removidos que ainda têm dados. Taxa = usuários que clicaram ÷ usuários expostos ao botão.
    const baseHub = g.hubView ? m(g.hubView.usuarios, 'hub_view') : { estado: 'indisponivel' };
    const conhecidos = new Set();
    const lista = botoes.filter(b => b.ativo || b.cliques || g.porBotao?.[b.button_id]).map(b => {
      conhecidos.add(b.button_id);
      const usuarios = g.porBotao ? m(g.porBotao[b.button_id]?.usuarios ?? 0, 'hub_button_click') : { estado: 'indisponivel' };
      const base = b.base_tipo === 'card'
        ? (pu ? m(pu[b.unidade]?.abriram ?? 0, 'hub_unit_open') : { estado: 'indisponivel' })
        : baseHub;
      return { ...b, usuarios, base: { tipo: b.base_tipo, ...base }, taxa: taxa(usuarios, base) };
    });
    for (const [id, x] of Object.entries(g.porBotao || {})) if (!conhecidos.has(id)) {
      lista.push({ button_id: id, nome: `${id} (removido)`, removido: true, cliques: 0, cliques_ga: x.cliques, usuarios: { valor: x.usuarios }, base: { tipo: 'automatica', estado: 'indisponivel' }, taxa: { estado: 'indisponivel', motivo: 'Botão removido: sem base de exposição.' } });
    }
    for (const o of orfaos.rows) lista.push({ link_id: o.link_id, nome: `Link ${o.link_id} (removido)`, removido: true, cliques: o.cliques, usuarios: { estado: 'indisponivel' }, base: { estado: 'indisponivel' }, taxa: { estado: 'indisponivel' } });
    r.botoes = lista;

  } catch (e) {
    console.error('ga', e.message);
    r.ga = { ok: false, motivo: 'Não foi possível ler o Google Analytics agora. Os números da página continuam valendo.' };
    semGA();
    for (const k of Object.keys(r.visao)) r.visao[k] = { estado: 'indisponivel', motivo: r.ga.motivo };
  }
  return r;
}

// Funil filtrado (unidade, botão de pedido, origem, campanha): chamado a cada mudança de filtro na tela.
async function funil(dias, filtros = {}) {
  if (!ga.configurado()) return { indisponivel: true, ...ESTADO_NAO_CONFIGURADO };
  const ids = await campanhas.idsEmFoco(filtros.campanha, filtros.origem);
  if (!ids) throw Object.assign(new Error('Campanha não encontrada.'), { status: 400 });
  try { return await rga.funil(ga, dias, { unidade: filtros.unidade, botao: filtros.botao, ids }, { entreDominios: process.env.GA4_ENTRE_DOMINIOS === '1' }); }
  catch (e) { console.error('funil', e.message); return { indisponivel: true, estado: 'indisponivel', motivo: 'Não foi possível ler o Google Analytics agora.' }; }
}

module.exports = { resultados, funil };
