// Banco do Pede Forno (Postgres). Cria as tabelas e o conteúdo inicial na primeira chamada.
const { Pool } = require('pg');

// ponytail: sem TLS (Postgres do Easypanel não vem com isso); só guardamos contagens e configuração.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });

const ESQUEMA = `
create table if not exists config (chave text primary key, valor text not null);
create table if not exists links (
  id serial primary key,
  pai int references links(id) on delete cascade,
  tipo text not null, -- 'bloco' (item da página) ou 'acao' (link dentro do bloco)
  acao text,
  titulo text not null,
  subtitulo text,
  url text,
  loja text,
  utm boolean not null default false,
  ordem int not null default 0,
  ativo boolean not null default true
);
create table if not exists eventos (
  id bigserial primary key,
  ts timestamptz not null default now(),
  tipo text not null,
  link_id int,
  loja text,
  acao text,
  origem text,
  meio text,
  campanha text
);
create index if not exists eventos_ts on eventos (ts);
alter table links add column if not exists icone text;
alter table eventos add column if not exists dispositivo text; -- celular, computador ou tablet
alter table links add column if not exists opcoes jsonb; -- layout do bloco: clássico/card/carrossel, aberto/recolhido...
alter table links add column if not exists nome text;    -- nome do bloco no admin (o título que aparece pode ser outro)
alter table links drop constraint if exists links_tipo_check; -- tipos antigos (unidade/card/link) viraram 'bloco'
create table if not exists alteracoes (id bigserial primary key, ts timestamptz not null default now(), usuario text not null, mudancas jsonb not null);
-- ponytail: imagens no próprio banco (capa, logo, ícones; já chegam reduzidas). Trocar por Vercel Blob se passar de centenas.
create table if not exists imagens (id serial primary key, tipo text not null, dados bytea not null, criado timestamptz not null default now());
-- Acesso por e-mail: quem pode entrar, sessões abertas, links de senha (guardamos só o resumo do token) e tentativas (limite contra tentativa em massa).
create table if not exists usuarios (
  id serial primary key,
  nome text not null,
  email text not null unique, -- sempre em minúsculas
  senha text,                 -- vazio até a pessoa escolher a senha pelo link do convite
  papel text not null default 'editor' check (papel in ('admin', 'editor')),
  ativo boolean not null default true,
  criado timestamptz not null default now(),
  ultimo_acesso timestamptz
);
create table if not exists sessoes (
  hash text primary key,
  usuario_id int references usuarios(id) on delete cascade,
  mestra boolean not null default false, -- entrou com a conta mestra (INSIGHTS_USER)
  expira timestamptz not null
);
create table if not exists redefinicoes (
  hash text primary key,
  usuario_id int not null references usuarios(id) on delete cascade,
  tipo text not null default 'redefinir', -- 'convite' ou 'redefinir'
  expira timestamptz not null,
  usado boolean not null default false
);
create table if not exists tentativas (chave text not null, ts timestamptz not null default now());
create index if not exists tentativas_chave on tentativas (chave, ts);
`;

const TUIGO = 'https://fornopaulista.tuigoapp.com.br';
const wa = n => `https://wa.me/${n}`;
const UNIDADES = [
  ['Hugo Napoleão', 'fornopaulistaleste', '5586995709028', 'https://maps.app.goo.gl/ULCJ1BwbcY5JpVh86'],
  ['Dom Severino', 'fornopaulistadomseverino', '558688652928', 'https://maps.app.goo.gl/3Uw6vJfbenHqwrxB7'],
  ['Sul', 'fornopaulistasul', '558695428466', 'https://maps.app.goo.gl/aeuYFQM3SX1TRvdV7'],
  ['Dirceu', 'fornopaulistadirceu', '558681853000', 'https://maps.app.goo.gl/GcuenyDuRwcSFLRQ6'],
];

// Conteúdo inicial = a página do Beacons: cada item é um bloco de links com layout e visibilidade próprios.
async function semear(c) {
  const config = {
    titulo: 'Escolha sua unidade', capa: 'capa.jpg', logo: 'logo-branca.png',
    cor: '#581512', cor_topo: '#FFFFFF', cor_bloco: '#FFFFFF', cor_texto: '#581512',
    fonte: 'Actor', estilo: 'oval', sombra: '0', contorno: '0',
    redes: JSON.stringify([{ rede: 'instagram', url: 'https://instagram.com/fornopaulista', ativo: true }]),
    rodape: 'Não usamos cookies nem coletamos dados pessoais. Contamos só os cliques por unidade.',
  };
  for (const [k, v] of Object.entries(config)) await c.query('insert into config values ($1, $2)', [k, v]);
  const novo = async (l, ordem) => (await c.query(
    'insert into links (pai, tipo, nome, acao, titulo, subtitulo, url, loja, utm, icone, opcoes, ordem) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id',
    [l.pai ?? null, l.tipo, l.nome ?? null, l.acao ?? null, l.titulo ?? '', l.subtitulo ?? null, l.url ?? null, l.loja ?? null, !!l.utm, l.icone ?? null, l.opcoes ?? null, ordem])).rows[0].id;
  let o = 0;
  for (const [nome, loja, fone, mapa] of UNIDADES) {
    const pai = await novo({ tipo: 'bloco', nome, titulo: `Unidade ${nome}`, loja, opcoes: { layout: 'classico', visibilidade: 'recolhido' } }, o++);
    await novo({ pai, tipo: 'acao', acao: 'pedido', titulo: 'Faça Seu Pedido', url: `${TUIGO}/${loja}/pedidos`, loja, utm: true }, 0);
    await novo({ pai, tipo: 'acao', acao: 'whatsapp', titulo: 'WhatsApp', url: wa(fone), loja }, 1);
    await novo({ pai, tipo: 'acao', acao: 'mapa', titulo: 'Localização', url: mapa, loja }, 2);
  }
  const evento = await novo({ tipo: 'bloco', nome: 'Marque Seu Evento', opcoes: { layout: 'classico', visibilidade: 'aberto' } }, o++);
  await novo({ pai: evento, tipo: 'acao', acao: 'whatsapp', titulo: 'Marque Seu Evento', url: wa('558698194974'), icone: 'nenhum' }, 0);
  const cardapio = await novo({ tipo: 'bloco', nome: 'CARDÁPIO ON-LINE', opcoes: { layout: 'card', visibilidade: 'aberto', tamanho_texto: 'g' } }, o++);
  await novo({ pai: cardapio, tipo: 'acao', acao: 'link', titulo: 'CARDÁPIO ON-LINE', subtitulo: 'Combos e promoções da Forno Paulista.', url: 'https://cardapio.grupofornopaulista.com/', utm: true }, 0);
}

let pronto;
// Roda uma vez por instância; se falhar, tenta de novo na próxima chamada.
function preparar() {
  return (pronto ??= (async () => {
    const c = await pool.connect();
    try {
      await c.query('select pg_advisory_lock(7001)'); // duas instâncias frias não semeiam ao mesmo tempo
      await c.query(ESQUEMA);
      if (!(await c.query('select 1 from links limit 1')).rowCount) {
        await c.query('begin'); // tudo ou nada: semear pela metade deixaria a página incompleta para sempre
        try { await semear(c); await c.query('commit'); } catch (e) { await c.query('rollback'); throw e; }
      }
    } finally {
      await c.query('select pg_advisory_unlock(7001)').catch(() => {});
      c.release();
    }
  })().catch(e => { pronto = null; throw e; }));
}

async function query(sql, params) {
  await preparar();
  return pool.query(sql, params);
}

// Linhas de `links` -> lista de blocos, cada um com seus links em `filhos`.
function arvore(linhas) {
  const todos = linhas.map(l => ({ ...l, filhos: [] }));
  const porId = Object.fromEntries(todos.map(l => [l.id, l]));
  for (const l of todos) if (l.pai) porId[l.pai]?.filhos.push(l);
  return todos.filter(l => !l.pai);
}

module.exports = { query, pool, arvore };
