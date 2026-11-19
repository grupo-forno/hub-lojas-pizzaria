// Checagem da API do Pede Forno. Usa o Postgres do `npm run dev` (deixe-o aberto em outra janela), mas num banco
// SEPARADO (pedeforno_teste), apagado e recriado a cada execução: nunca toca nos dados que você edita no admin.
//   npm test
const SERVIDOR = 'postgres://postgres:teste@localhost:54330';
process.env.DATABASE_URL = `${SERVIDOR}/pedeforno_teste`;
const assert = require('assert');
const { Client } = require('pg');
const { servidorSmtpFalso } = require('./scripts/smtp-falso.js');
let query, pool, pagina, evento, admin, imagem, acesso, caixaDeTestes;
process.env.EMAIL_MODO = 'teste'; // nenhum e-mail sai de verdade; o teste lê o link da caixa simulada
process.env.INSIGHTS_USER ||= 'admin';
process.env.INSIGHTS_PASS ||= 'admin';
const basic = (u, s) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${s}`).toString('base64') });
let login, NOSSA_TELA; // sessão da conta mestra, aberta pelo formulário de entrada logo no início
const comoCookie = c => ({ cookie: c, 'x-requested-with': 'admin' });
const cookieDe = r => String(r.h['Set-Cookie'] || '').split(';')[0];
const tokenDe = email => { const m = [...caixaDeTestes].reverse().find(x => x.para === email); return m && new URL(m.link).searchParams.get('redefinir'); };
const emailsPara = (email, assunto) => caixaDeTestes.filter(x => x.para === email && x.assunto.includes(assunto)).length;

const chamar = (h, req) => new Promise(ok => {
  const r = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; },
    json(d) { ok({ ...this, d }); }, send(d) { ok({ ...this, d }); }, end(d) { ok({ ...this, d }); } };
  h({ method: 'POST', headers: {}, url: '/', ...req }, r);
});

(async () => {
  const c = new Client(`${SERVIDOR}/postgres`);
  await c.connect().catch(() => { console.error('teste-hub: abra o `npm run dev` (ele sobe o banco de teste) e rode de novo.'); process.exit(1); });
  await c.query('drop database if exists pedeforno_teste with (force)');
  await c.query('create database pedeforno_teste');
  await c.end();
  ({ query, pool } = require('./api/_lib/db.js'));
  pagina = require('./api/pagina.js');
  evento = require('./api/evento.js');
  admin = require('./api/admin.js');
  imagem = require('./api/imagem.js');
  acesso = require('./api/acesso.js');
  ({ caixaDeTestes } = require('./api/_lib/email.js'));
  const entradaMestra = await chamar(acesso, { url: '/api/acesso', headers: { 'x-requested-with': 'admin' }, body: { acao: 'entrar', email: process.env.INSIGHTS_USER, senha: process.env.INSIGHTS_PASS } });
  login = { cookie: String(entradaMestra.h['Set-Cookie']).split(';')[0] };
  NOSSA_TELA = { ...login, 'x-requested-with': 'admin' };

  // Migração: um banco no formato da PRIMEIRA versão (o que está em produção hoje) vira blocos, sem perder ids nem cliques.
  {
    const { ESQUEMA, migrarLegado, arvore } = require('./api/_lib/db.js');
    const g = new Client(`${SERVIDOR}/postgres`);
    await g.connect();
    await g.query('drop database if exists pedeforno_legado with (force)');
    await g.query('create database pedeforno_legado');
    await g.end();
    const v1 = new Client(`${SERVIDOR}/pedeforno_legado`);
    await v1.connect();
    await v1.query(`
      create table config (chave text primary key, valor text not null);
      create table links (id serial primary key, pai int references links(id) on delete cascade,
        tipo text not null check (tipo in ('unidade', 'acao', 'link', 'card')), acao text, titulo text not null, subtitulo text, url text,
        loja text, utm boolean not null default false, ordem int not null default 0, ativo boolean not null default true);
      create table eventos (id bigserial primary key, ts timestamptz not null default now(), tipo text not null, link_id int, loja text, acao text, origem text, meio text, campanha text);
      insert into links (pai, tipo, acao, titulo, subtitulo, url, loja, utm, ordem) values
        (null, 'unidade', null, 'Unidade Hugo Napoleão', 'Rua Hugo Napoleão, 1778, Fátima', null, 'fornopaulistaleste', false, 0),
        (1, 'acao', 'pedido', 'Faça seu pedido', null, 'https://fornopaulista.tuigoapp.com.br/fornopaulistaleste/pedidos', 'fornopaulistaleste', true, 0),
        (1, 'acao', 'whatsapp', 'WhatsApp', null, 'https://wa.me/5586995709028', 'fornopaulistaleste', false, 1),
        (null, 'card', null, 'Marque seu evento', null, 'https://wa.me/558698194974', null, false, 1),
        (null, 'card', null, 'Cardápio on-line', 'Combos e promoções da Forno Paulista.', 'https://cardapio.grupofornopaulista.com/', null, true, 2);
      insert into config values ('cor', '#86201B'), ('titulo', 'Escolha sua unidade'), ('instagram', 'https://instagram.com/fornopaulista');
      insert into eventos (tipo, link_id, loja, acao, origem, meio) values ('click', 2, 'fornopaulistaleste', 'pedido', 'instagram', 'bio'), ('click', 5, null, null, 'hub', 'direto');`);
    await v1.query(ESQUEMA); // o código novo cria as colunas que faltam (nome, opcoes, icone...) e solta a trava antiga de tipos
    await migrarLegado(v1);
    const blocos = arvore((await v1.query('select * from links order by ordem, id')).rows);
    assert.deepEqual(blocos.map(b => [b.id, b.tipo, b.nome, b.opcoes.layout, b.opcoes.visibilidade]), [
      [1, 'bloco', 'Hugo Napoleão', 'classico', 'recolhido'],
      [4, 'bloco', 'Marque Seu Evento', 'classico', 'aberto'],
      [5, 'bloco', 'CARDÁPIO ON-LINE', 'card', 'aberto'],
    ]);
    assert.equal(blocos[0].titulo, 'Unidade Hugo Napoleão'); // o texto do botão não muda
    assert.deepEqual(blocos[0].filhos.map(f => [f.id, f.acao, f.titulo]), [[2, 'pedido', 'Faça Seu Pedido'], [3, 'whatsapp', 'WhatsApp']]); // os links da unidade mantêm os ids
    assert.equal(blocos[0].filhos[0].utm, true);
    const evento = blocos[1].filhos[0], cardapio = blocos[2].filhos[0];
    assert.deepEqual([evento.acao, evento.titulo, evento.icone, evento.url], ['whatsapp', 'Marque Seu Evento', 'nenhum', 'https://wa.me/558698194974']);
    assert.deepEqual([cardapio.acao, cardapio.titulo, cardapio.subtitulo, cardapio.utm, cardapio.url], ['link', 'CARDÁPIO ON-LINE', 'Combos e promoções da Forno Paulista.', true, 'https://cardapio.grupofornopaulista.com/']);
    assert.equal(blocos[2].url, null); // a URL foi para dentro do link do bloco
    assert.equal((await v1.query('select count(*)::int n from eventos where link_id in (2, 5)')).rows[0].n, 2); // o histórico de cliques continua lá
    const cfg = Object.fromEntries((await v1.query('select chave, valor from config')).rows.map(r => [r.chave, r.valor]));
    assert.equal(cfg.cor, '#581512'); // o vinho antigo virou o do Beacons
    assert.deepEqual([cfg.fonte, cfg.estilo, cfg.cor_bloco], ['Actor', 'oval', '#FFFFFF']); // opções novas entram com o padrão
    assert.deepEqual(JSON.parse(cfg.redes), [{ rede: 'instagram', url: 'https://instagram.com/fornopaulista', ativo: true }]); // o Instagram antigo vira o 1º ícone
    const antes = (await v1.query('select count(*)::int n from links')).rows[0].n;
    await migrarLegado(v1); // rodar de novo não muda nada
    assert.equal((await v1.query('select count(*)::int n from links')).rows[0].n, antes);
    await v1.end();
  }

  // Página pública: 6 blocos como no Beacons (4 unidades recolhidas, evento, cardápio em card).
  const p = await chamar(pagina, { method: 'GET', url: '/api/pagina' });
  assert.equal(p.c, 200);
  assert.equal(p.d.links.length, 6);
  const unidades = p.d.links.filter(l => l.opcoes.visibilidade === 'recolhido');
  assert.equal(unidades.length, 4);
  assert.equal(unidades[0].titulo, 'Unidade Hugo Napoleão');
  assert.deepEqual(unidades[0].filhos.map(f => f.acao), ['pedido', 'whatsapp', 'mapa']);
  const cardapio = p.d.links.at(-1);
  assert.equal(cardapio.opcoes.layout, 'card');
  assert.equal(cardapio.filhos[0].subtitulo, 'Combos e promoções da Forno Paulista.');
  assert.equal(p.d.config.titulo, 'Escolha sua unidade');

  // Eventos: só os válidos e de gente entram.
  const antes = (await query('select count(*)::int n from eventos')).rows[0].n;
  const pedido = unidades[0].filhos[0];
  assert.equal((await chamar(evento, { body: { tipo: 'click', link_id: pedido.id, loja: pedido.loja, acao: 'pedido', origem: 'instagram', meio: 'bio', campanha: 'bio' } })).c, 204);
  assert.equal((await chamar(evento, { body: JSON.stringify({ tipo: 'view', origem: 'hub' }) })).c, 204); // texto, como no sendBeacon
  assert.equal((await chamar(evento, { body: { tipo: 'hack' } })).c, 400);
  assert.equal((await chamar(evento, { method: 'GET' })).c, 405);
  assert.equal((await chamar(evento, { headers: { 'user-agent': 'facebookexternalhit/1.1' }, body: { tipo: 'view' } })).c, 204);
  assert.equal((await query('select count(*)::int n from eventos')).rows[0].n - antes, 2);
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';
  await chamar(evento, { headers: { 'user-agent': iphone }, body: { tipo: 'view', origem: 'instagram', meio: 'bio' } });
  await chamar(evento, { headers: { 'user-agent': iphone }, body: { tipo: 'abrir', link_id: unidades[0].id, loja: unidades[0].loja, origem: 'instagram', meio: 'bio' } });
  assert.equal((await query('select dispositivo from eventos order by id desc limit 1')).rows[0].dispositivo, 'celular');

  // Resultados (aba do admin): contagens do período, por dia, origem, unidade e link; GA desligado fora da Vercel.
  const { resultados } = require('./api/_lib/resultados.js');
  const res = await resultados(30);
  assert.deepEqual(res.totais, { visitas: 2, aberturas: 1, cliques: 1, pedidos: 1 });
  assert.equal(res.anterior.visitas, 0);
  assert.equal(res.diario.reduce((s, d) => s + d.visitas, 0), 2);
  const insta = res.origens.find(o => o.origem === 'instagram' && o.meio === 'bio' && !o.campanha);
  assert.equal(insta.visitas, 1);
  assert.equal(res.lojas[0].nome, 'Unidade Hugo Napoleão');
  assert.deepEqual([res.lojas[0].aberturas, res.lojas[0].pedidos], [1, 1]);
  assert.equal(res.links[0].titulo, 'Faça Seu Pedido');
  assert.equal(res.links[0].bloco, 'Hugo Napoleão');
  assert.equal(res.ga.ok, false);

  // Imagens: só JPG/PNG/WebP de verdade, com login; a devolução é igual ao que foi enviado (sem perda).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await chamar(imagem, { headers: NOSSA_TELA, body: { tipo: 'image/png', dados: Buffer.from('<svg/>').toString('base64') } })).c, 400);
  assert.equal((await chamar(imagem, { headers: login, body: { tipo: 'image/png', dados: png.toString('base64') } })).c, 403);
  const enviada = await chamar(imagem, { headers: NOSSA_TELA, body: { tipo: 'image/png', dados: png.toString('base64') } });
  assert.equal(enviada.c, 200);
  const devolvida = await chamar(imagem, { method: 'GET', url: enviada.d.url });
  assert.ok(Buffer.compare(devolvida.d, png) === 0, 'a imagem devolvida mudou');
  const foto = enviada.d.url;
  assert.equal(devolvida.h['Accept-Ranges'], 'bytes');
  // Em pedaços (Range): o iPhone só toca vídeo se o servidor responder assim.
  const pedaco = (range) => chamar(imagem, { method: 'GET', url: foto, headers: { range } });
  const p1 = await pedaco('bytes=0-3');
  assert.equal(p1.c, 206);
  assert.equal(p1.h['Content-Range'], `bytes 0-3/${png.length}`);
  assert.ok(Buffer.compare(p1.d, png.subarray(0, 4)) === 0);
  const p2 = await pedaco('bytes=-4'); // os últimos 4 bytes
  assert.ok(p2.c === 206 && Buffer.compare(p2.d, png.subarray(png.length - 4)) === 0);
  const p3 = await pedaco(`bytes=10-`); // do byte 10 até o fim
  assert.ok(p3.c === 206 && Buffer.compare(p3.d, png.subarray(10)) === 0);
  assert.equal((await pedaco('bytes=99999-')).c, 416); // além do fim
  assert.equal((await pedaco('lixo')).c, 416);
  // Vídeo do topo: MP4 e WebM de verdade (pelos primeiros bytes), até ~3 MB; o resto é recusado.
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40)]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]);
  const subir = (tipo, dados) => chamar(imagem, { headers: NOSSA_TELA, body: { tipo, dados: dados.toString('base64') } });
  const videoMp4 = await subir('video/mp4', mp4);
  assert.equal(videoMp4.c, 200, videoMp4.d?.erro);
  assert.equal((await subir('video/webm', webm)).c, 200);
  assert.equal((await subir('video/mp4', Buffer.alloc(50))).c, 400); // diz que é MP4 mas não é
  assert.equal((await subir('video/webm', mp4)).c, 400);
  assert.equal((await subir('image/png', mp4)).c, 400); // vídeo disfarçado de imagem
  assert.equal((await subir('video/x-msvideo', mp4)).c, 400); // formato que não aceitamos
  const grande = Buffer.concat([mp4, Buffer.alloc(3_200_000)]);
  const demais = await subir('video/mp4', grande);
  assert.equal(demais.c, 413);
  assert.ok(demais.d.erro.includes('3 MB'));
  const lido = await chamar(imagem, { method: 'GET', url: videoMp4.d.url });
  assert.equal(lido.h['Content-Type'], 'video/mp4');

  // Admin: login, proteção contra site de fora, validação.
  const entrada = await chamar(admin, { method: 'GET', url: '/admin' }); // sem sessão: a página é a tela de entrada
  assert.equal(entrada.c, 200);
  assert.ok(String(entrada.d).includes('Esqueci minha senha'));
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1' })).c, 401); // e os dados são negados
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: basic('x', 'y') })).c, 401);
  // A senha "do navegador" (Basic), mesmo a certa, NÃO abre o admin: o navegador a reenvia sozinho e o "Sair" nunca funcionaria.
  const senhaDoNavegador = basic(process.env.INSIGHTS_USER, process.env.INSIGHTS_PASS);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: senhaDoNavegador })).c, 401);
  assert.ok(String((await chamar(admin, { method: 'GET', url: '/admin', headers: senhaDoNavegador })).d).includes('Esqueci minha senha')); // continua vendo a tela de entrada
  assert.equal((await chamar(imagem, { headers: { ...senhaDoNavegador, 'x-requested-with': 'admin' }, body: { tipo: 'image/png', dados: 'AAAA' } })).c, 401);
  const tela = await chamar(admin, { method: 'GET', url: '/admin', headers: login });
  assert.equal(tela.c, 200);
  assert.ok(String(tela.d).includes('Pede Forno'));
  const orig = (await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: login })).d;
  assert.equal(orig.links.length, 6);
  const post = (body, headers = NOSSA_TELA) => chamar(admin, { method: 'POST', url: '/api/admin', headers, body });
  assert.equal((await post(orig, login)).c, 403); // sem o cabeçalho da nossa tela
  const clone = () => JSON.parse(JSON.stringify(orig));
  const recusa = async (mudar, porque) => { const r = clone(); mudar(r); assert.equal((await post(r)).c, 400, porque); };
  await recusa(r => { r.config.cor = 'vermelho'; }, 'cor');
  await recusa(r => { r.links[0].filhos[0].url = 'javascript:alert(1)'; }, 'link perigoso');
  await recusa(r => { r.links = []; }, 'página vazia');
  await recusa(r => { r.config.fonte = 'Comic Sans'; }, 'fonte');
  await recusa(r => { r.config.estilo = 'estrela'; }, 'estilo');
  await recusa(r => { r.links[0].opcoes = { layout: 'mosaico' }; }, 'layout');
  await recusa(r => { r.links[0].filhos[0].icone = 'i:toString'; }, 'ícone herdado do JavaScript');
  await recusa(r => { r.links[0].nome = ''; r.links[0].titulo = ''; }, 'bloco sem nome');
  await recusa(r => { r.links[5].opcoes.layout = 'carrossel'; }, 'carrossel sem imagem');
  await recusa(r => { r.links[0].filhos[0].opcoes = { animacao: 'girar' }; }, 'animação');
  await recusa(r => { r.links[0].filhos[0].opcoes = { inicio: '2026-12-02T10:00:00.000Z', fim: '2026-12-01T10:00:00.000Z' }; }, 'agenda invertida');
  await recusa(r => { r.links[0].filhos[0].opcoes = { cor_bloco: 'azul' }; }, 'cor do botão');
  assert.equal((await query('select count(*)::int n from links')).rows[0].n, 20); // 6 blocos + 14 links; recusados não gravam

  // Contas por e-mail: a conta mestra convida a Ana, ela escolhe a senha pelo link e entra com o nome dela.
  const usuarios = (headers, body) => chamar(admin, { method: 'POST', url: '/api/admin?usuarios=1', headers, body });
  const acessar = (body, headers = {}) => chamar(acesso, { method: 'POST', url: '/api/acesso', headers: { 'x-requested-with': 'admin', ...headers }, body });
  const convite = await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Ana', email: 'ana@exemplo.com', papel: 'editor' });
  assert.equal(convite.c, 200, convite.d?.erro);
  assert.ok(convite.d.aviso.includes('Convite enviado'));
  assert.equal(emailsPara('ana@exemplo.com', 'Seu acesso'), 1);
  const tokenAna = tokenDe('ana@exemplo.com');
  const valido = await chamar(acesso, { method: 'GET', url: `/api/acesso?token=${tokenAna}` });
  assert.deepEqual([valido.c, valido.d.tipo, valido.d.nome], [200, 'convite', 'Ana']);
  assert.equal((await chamar(acesso, { method: 'GET', url: '/api/acesso?token=inventado' })).c, 404);
  assert.equal((await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'qualquer-coisa' })).c, 401); // convite pendente: ainda sem senha
  assert.equal((await acessar({ acao: 'redefinir', token: tokenAna, senha: 'curta' })).c, 400); // senha curta
  assert.equal((await acessar({ acao: 'redefinir', token: tokenAna, senha: '12345678' })).c, 400); // senha comum
  assert.equal((await acessar({ acao: 'redefinir', token: tokenAna, senha: 'Senha-da-Ana-1' })).c, 200);
  assert.equal((await acessar({ acao: 'redefinir', token: tokenAna, senha: 'Outra-senha-2' })).c, 400); // o link só vale uma vez
  assert.equal((await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'errada-errada' })).c, 401);
  const entrou = await acessar({ acao: 'entrar', email: ' ANA@exemplo.com ', senha: 'Senha-da-Ana-1' }); // e-mail sem diferença de maiúsculas
  assert.equal(entrou.c, 200);
  assert.ok(/HttpOnly/.test(entrou.h['Set-Cookie']) && /SameSite=Lax/.test(entrou.h['Set-Cookie']) && !/Secure/.test(entrou.h['Set-Cookie']));
  assert.ok(/Secure/.test((await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'Senha-da-Ana-1' }, { 'x-forwarded-proto': 'https' })).h['Set-Cookie'])); // no ar o cookie é Secure
  const comoAna = comoCookie(cookieDe(entrou));
  const dadosAna = (await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoAna })).d;
  assert.deepEqual([dadosAna.usuario, dadosAna.eu.papel, dadosAna.eu.mestra], ['Ana', 'editor', false]);
  assert.equal((await acessar({ acao: 'entrar', email: 'x@y.com', senha: 'x' }, {})).c, 401); // e-mail que não existe: mesma resposta
  const semCabecalho = await chamar(acesso, { method: 'POST', url: '/api/acesso', headers: {}, body: { acao: 'entrar', email: 'ana@exemplo.com', senha: 'Senha-da-Ana-1' } });
  assert.equal(semCabecalho.c, 403); // de outro site não passa
  const mestre = await acessar({ acao: 'entrar', email: process.env.INSIGHTS_USER, senha: process.env.INSIGHTS_PASS }); // conta mestra pelo formulário
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: { cookie: cookieDe(mestre) } })).d.eu.mestra, true);
  // A conta mestra não é de uso único: dá para entrar de novo e as sessões são independentes. Trocou a senha na Vercel: todas caem.
  const mestre2 = await acessar({ acao: 'entrar', email: process.env.INSIGHTS_USER, senha: process.env.INSIGHTS_PASS });
  assert.equal(mestre2.c, 200);
  await acessar({ acao: 'sair' }, { cookie: cookieDe(mestre2) });
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: { cookie: cookieDe(mestre) } })).c, 200); // sair de uma sessão não derruba a outra
  const senhaMestra = process.env.INSIGHTS_PASS;
  process.env.INSIGHTS_PASS = 'senha-nova-na-vercel';
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: { cookie: cookieDe(mestre) } })).c, 401);
  assert.equal((await acessar({ acao: 'entrar', email: process.env.INSIGHTS_USER, senha: senhaMestra })).c, 401); // a senha antiga também não entra mais
  process.env.INSIGHTS_PASS = senhaMestra;

  // Salvar: renomear, esconder, reordenar, novo bloco em carrossel, card com imagem própria, design.
  const novo = clone();
  novo.links[0].nome = 'Hugo (renomeado)';
  novo.links[0].titulo = 'Hugo Napoleão (novo título)';
  novo.links[0].filhos[1].ativo = false;
  novo.links[0].filhos[0].icone = 'i:carrinho';
  [novo.links[1], novo.links[2]] = [novo.links[2], novo.links[1]];
  novo.links[5].filhos[0].icone = foto; // imagem do card, diferente da logo
  novo.links[5].filhos[0].opcoes = { animacao: 'tada', etiqueta: 'NOVO', cor_bloco: '#FFE08A', inicio: '2026-01-01T03:00:00.000Z', fim: '' };
  novo.links.push({ tipo: 'bloco', nome: 'Promoções', opcoes: { layout: 'carrossel' }, ativo: true, filhos: [
    { tipo: 'acao', acao: 'link', titulo: '', url: '', icone: foto, ativo: true }, // no carrossel a foto pode não ter link
    { tipo: 'acao', acao: 'link', titulo: 'Esfirra', url: 'https://exemplo.com/b', icone: foto, ativo: true }] });
  Object.assign(novo.config, { fonte: 'Poppins', estilo: 'quadrado', sombra: 'sim', cor_bloco: '#EEEEEE' });
  const salvo = await post(novo, comoAna);
  assert.equal(salvo.c, 200, salvo.d?.erro);
  assert.equal(salvo.d.config.fonte, 'Poppins');
  assert.equal(salvo.d.config.sombra, '0'); // só '1' liga
  assert.equal(salvo.d.links[0].nome, 'Hugo (renomeado)');
  assert.equal(salvo.d.links[1].loja, 'fornopaulistasul');
  assert.equal(salvo.d.links.length, 7);
  assert.equal(salvo.d.links[6].opcoes.layout, 'carrossel');
  assert.equal(salvo.d.links[6].opcoes.visibilidade, 'aberto'); // o que não veio fica no padrão
  const publica = (await chamar(pagina, { method: 'GET', url: '/api/pagina' })).d;
  assert.equal(publica.links[0].filhos.length, 2); // link escondido não aparece
  assert.equal(publica.links[0].filhos[0].icone, 'i:carrinho');
  assert.equal(publica.links[5].filhos[0].icone, foto);
  assert.deepEqual(publica.links[5].filhos[0].opcoes, { animacao: 'tada', inicio: '2026-01-01T03:00:00.000Z', fim: '', etiqueta: 'NOVO', cor_bloco: '#FFE08A', cor_texto: '' });
  assert.equal(publica.links[0].filhos[0].opcoes, null); // sem personalização: nada guardado
  assert.equal(publica.links[6].filhos.length, 2);
  assert.equal(publica.links[6].filhos[0].url, null);
  await recusa(r => { r.links[0].filhos[0].url = ''; }, 'fora do carrossel o link continua obrigatório');

  // Histórico: quem salvou e o que mudou; salvar sem mudança não registra.
  const hist = (await chamar(admin, { method: 'GET', url: '/api/admin?historico=1', headers: login })).d;
  assert.equal(hist[0].usuario, 'Ana');
  const frases = hist[0].mudancas.join(' | ');
  for (const f of ['Renomeou o bloco "Hugo Napoleão" para "Hugo (renomeado)"', 'Mudou o título de', 'Escondeu "', 'Adicionou "Promoções"', 'Mudou a ordem dos blocos', 'Alterou a fonte', 'Trocou a imagem/ícone de',
    'Animou "CARDÁPIO ON-LINE', 'Pôs a etiqueta "NOVO"', 'Mudou o agendamento de', 'Mudou as cores do botão'])
    assert.ok(frases.includes(f), `faltou no histórico: ${f}\n${frases}`);
  const total = hist.length;
  assert.equal((await post(salvo.d)).c, 200);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?historico=1', headers: login })).d.length, total);

  // ---- E-mail de verdade (SMTP): o convite sai pela conta configurada, com o link no corpo; se o envio falha, a pessoa fica cadastrada ----
  {
    const CHAVES = ['EMAIL_MODO', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_HOST', 'SMTP_FROM', 'SMTP_INSEGURO', 'SITE_URL'];
    const antes = Object.fromEntries(CHAVES.map(k => [k, process.env[k]]));
    const smtp = await servidorSmtpFalso();
    delete process.env.EMAIL_MODO;
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.porta), SMTP_INSEGURO: '1', SMTP_USER: 'acesso@grupo.exemplo', SMTP_PASS: 'abcd efgh ijkl mnop', SITE_URL: 'https://pedeforno.exemplo/' });
    const ok = await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Carla Silva', email: 'carla@exemplo.com', papel: 'editor' });
    assert.equal(ok.c, 200, ok.d?.erro);
    assert.ok(!ok.d.problema, ok.d.aviso);
    assert.equal(smtp.recebidos.length, 1);
    const m = smtp.recebidos[0];
    assert.deepEqual(m.para, ['carla@exemplo.com']);
    assert.equal(m.de, 'acesso@grupo.exemplo');
    assert.deepEqual(m.login, ['acesso@grupo.exemplo', 'abcdefghijklmnop']); // a senha de app vai sem os espaços
    const texto = m.texto.replace(/=\r\n/g, '').replace(/=3D/g, '='); // desfaz a codificação do e-mail
    assert.ok(/https:\/\/pedeforno\.exemplo\/admin\?redefinir=[\w-]{43}/.test(texto), 'o link do convite não está no corpo (endereço do SITE_URL, sem barra dupla)');
    assert.ok(texto.includes('Pede Forno'));
    await smtp.parar(); // servidor fora do ar: o envio falha, mas a pessoa foi cadastrada e o administrador é avisado
    const falhou = await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Dani Souza', email: 'dani@exemplo.com', papel: 'editor' });
    assert.equal(falhou.c, 200);
    assert.equal(falhou.d.problema, true);
    assert.ok(falhou.d.usuarios.some(u => u.email === 'dani@exemplo.com' && u.convite_pendente));
    delete process.env.SMTP_PASS; // sem configuração: o administrador também é avisado, nada quebra
    assert.equal((await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Eva', email: 'eva@exemplo.com', papel: 'editor' })).d.problema, true);
    for (const k of CHAVES) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }


  // ---- Usuários: níveis, últimos administradores, desativar, remover ----
  const lista = async h => (await chamar(admin, { method: 'POST', url: '/api/admin?usuarios=1', headers: h, body: { op: 'listar' } }));
  assert.equal((await lista(comoAna)).c, 403); // editor não gerencia usuários
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?usuarios=1', headers: comoAna })).c, 403);
  assert.equal((await usuarios(comoAna, { op: 'criar', nome: 'X', email: 'x@exemplo.com', papel: 'admin' })).c, 403);
  assert.equal((await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Outra Ana', email: 'ANA@exemplo.com', papel: 'editor' })).c, 400); // e-mail repetido
  assert.equal((await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Sem Nivel', email: 'sn@exemplo.com', papel: 'dono' })).c, 400);
  assert.equal((await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Mail Ruim', email: 'sem-arroba', papel: 'editor' })).c, 400);

  await usuarios(NOSSA_TELA, { op: 'criar', nome: 'Bruno', email: 'bruno@exemplo.com', papel: 'admin' });
  await acessar({ acao: 'redefinir', token: tokenDe('bruno@exemplo.com'), senha: 'Senha-do-Bruno-1' });
  const comoBruno = comoCookie(cookieDe(await acessar({ acao: 'entrar', email: 'bruno@exemplo.com', senha: 'Senha-do-Bruno-1' })));
  const veBruno = await lista(comoBruno);
  assert.deepEqual(veBruno.d.usuarios.map(u => u.nome), ['Ana', 'Bruno', 'Carla Silva', 'Dani Souza', 'Eva']); // em ordem alfabética
  assert.equal(veBruno.d.usuarios.every(u => !('senha' in u)), true); // a senha nunca sai do servidor
  const idBruno = veBruno.d.usuarios.find(u => u.nome === 'Bruno').id, idAna = veBruno.d.usuarios.find(u => u.nome === 'Ana').id;
  assert.equal((await usuarios(comoBruno, { op: 'editar', id: idBruno, nome: 'Bruno', papel: 'editor', ativo: true })).c, 400); // ninguém muda o próprio nível
  assert.equal((await usuarios(comoBruno, { op: 'remover', id: idBruno })).c, 400);
  assert.equal((await usuarios(NOSSA_TELA, { op: 'editar', id: idBruno, nome: 'Bruno', papel: 'editor', ativo: true })).c, 400); // Bruno é o único administrador
  assert.equal((await usuarios(NOSSA_TELA, { op: 'remover', id: idBruno })).c, 400);
  assert.equal((await usuarios(NOSSA_TELA, { op: 'editar', id: idBruno, nome: 'Bruno', papel: 'admin', ativo: false })).c, 400);

  // Desativar derruba a sessão na hora e bloqueia o login; reativar devolve o acesso.
  assert.equal((await usuarios(comoBruno, { op: 'editar', id: idAna, nome: 'Ana', papel: 'editor', ativo: false })).c, 200);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoAna })).c, 401);
  assert.equal((await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'Senha-da-Ana-1' })).c, 401);
  assert.equal((await usuarios(comoBruno, { op: 'editar', id: idAna, nome: 'Ana', papel: 'editor', ativo: true })).c, 200);
  const comoAna2 = comoCookie(cookieDe(await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'Senha-da-Ana-1' })));
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoAna2 })).c, 200);

  // "Esqueci minha senha": mesma resposta com e-mail cadastrado ou não, link de uso único, vale 1 hora, derruba as sessões antigas.
  const semConta = await acessar({ acao: 'esqueci', email: 'fantasma@exemplo.com' });
  const comConta = await acessar({ acao: 'esqueci', email: 'ana@exemplo.com' });
  assert.deepEqual(semConta.d, comConta.d); // ninguém descobre quem tem conta
  assert.equal(caixaDeTestes.filter(x => x.para === 'fantasma@exemplo.com').length, 0);
  assert.equal(emailsPara('ana@exemplo.com', 'Troque a sua senha'), 1);
  assert.equal((await acessar({ acao: 'esqueci', email: 'sem-arroba' })).c, 400);
  const tokenTroca = tokenDe('ana@exemplo.com');
  assert.equal((await chamar(acesso, { method: 'GET', url: `/api/acesso?token=${tokenTroca}` })).d.tipo, 'redefinir');
  assert.equal((await acessar({ acao: 'redefinir', token: tokenTroca, senha: 'Nova-senha-da-Ana-3' })).c, 200);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoAna2 })).c, 401); // sessão antiga caiu
  assert.equal((await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'Senha-da-Ana-1' })).c, 401); // senha antiga não vale
  const comoAna3 = comoCookie(cookieDe(await acessar({ acao: 'entrar', email: 'ana@exemplo.com', senha: 'Nova-senha-da-Ana-3' })));
  await acessar({ acao: 'esqueci', email: 'ana@exemplo.com' });
  await acessar({ acao: 'esqueci', email: 'ana@exemplo.com' });
  await acessar({ acao: 'esqueci', email: 'ana@exemplo.com' }); // o 4º pedido na hora já passou do limite (3)
  assert.equal(emailsPara('ana@exemplo.com', 'Troque a sua senha'), 3);
  await query(`update redefinicoes set expira = now() - interval '1 minute'`); // link vencido
  assert.equal((await acessar({ acao: 'redefinir', token: tokenDe('ana@exemplo.com'), senha: 'Mais-uma-senha-4' })).c, 400);
  assert.equal((await chamar(acesso, { method: 'GET', url: `/api/acesso?token=${tokenDe('ana@exemplo.com')}` })).c, 404);

  // Minha conta: trocar a própria senha exige a atual; as outras sessões caem e esta continua.
  assert.equal((await usuarios(comoAna3, { op: 'minha_senha', atual: 'errada', nova: 'Senha-nova-da-Ana-5' })).c, 400);
  assert.equal((await usuarios(comoAna3, { op: 'minha_senha', atual: 'Nova-senha-da-Ana-3', nova: 'curta' })).c, 400);
  const trocou = await usuarios(comoAna3, { op: 'minha_senha', atual: 'Nova-senha-da-Ana-3', nova: 'Senha-nova-da-Ana-5' });
  assert.equal(trocou.c, 200);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoAna3 })).c, 401);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoCookie(cookieDe(trocou)) })).c, 200);

  // Limite de tentativas: 8 erros seguidos no mesmo e-mail bloqueiam por um tempo (mesmo com a senha certa depois).
  for (let i = 0; i < 8; i++) assert.equal((await acessar({ acao: 'entrar', email: 'alvo@exemplo.com', senha: `errada-${i}` })).c, 401);
  assert.equal((await acessar({ acao: 'entrar', email: 'alvo@exemplo.com', senha: 'errada-9' })).c, 429);

  // Remover tira o acesso na hora; sair encerra a sessão.
  assert.equal((await usuarios(NOSSA_TELA, { op: 'editar', id: idAna, nome: 'Ana', papel: 'admin', ativo: true })).c, 200); // agora há 2 administradores
  assert.equal((await usuarios(NOSSA_TELA, { op: 'remover', id: idBruno })).c, 200);
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoBruno })).c, 401);
  const saida = await acessar({ acao: 'sair' }, { cookie: cookieDe(trocou) });
  assert.ok(/Max-Age=0/.test(saida.h['Set-Cookie']));
  assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: comoCookie(cookieDe(trocou)) })).c, 401);
  assert.equal((await query('select count(*)::int n from sessoes where usuario_id = $1', [idBruno])).rows[0].n, 0);

  // ---- Fundo do topo: foto única, vídeo ou carrossel automático; tamanho da logo ----
  {
    const urlVideo = videoMp4.d.url;
    const base = clone();
    const tenta = async (mudar, porque) => { const r = JSON.parse(JSON.stringify(base)); mudar(r.config); assert.equal((await post(r)).c, 400, porque); };
    await tenta(c => { c.capa_tipo = 'filme'; }, 'tipo desconhecido');
    await tenta(c => { c.capa_tipo = 'video'; c.capa_video = ''; }, 'vídeo escolhido sem vídeo');
    await tenta(c => { c.capa_video = 'http://exemplo.com/a.mp4'; }, 'vídeo sem https');
    await tenta(c => { c.capa_video = 'https://exemplo.com/a.mov'; }, 'formato de vídeo');
    await tenta(c => { c.capa_video = 'javascript:alert(1)'; }, 'vídeo perigoso');
    await tenta(c => { c.capa_tipo = 'carrossel'; c.capa_fotos = [foto]; }, 'carrossel com 1 foto');
    await tenta(c => { c.capa_fotos = Array(9).fill(foto); }, 'fotos demais');
    await tenta(c => { c.capa_fotos = ['javascript:alert(1)']; }, 'foto perigosa');
    await tenta(c => { c.capa_intervalo = '2'; }, 'tempo curto demais');
    await tenta(c => { c.capa_intervalo = '99'; }, 'tempo longo demais');
    await tenta(c => { c.logo_tamanho = '500'; }, 'logo grande demais');
    await tenta(c => { c.logo_tamanho = '10'; }, 'logo pequena demais');
    await tenta(c => { c.logo_tamanho = 'grande'; }, 'logo fora do formato');

    const comVideo = JSON.parse(JSON.stringify(base));
    Object.assign(comVideo.config, { capa_tipo: 'video', capa_video: urlVideo, logo_tamanho: '240' });
    const v1 = await post(comVideo);
    assert.equal(v1.c, 200, v1.d?.erro);
    assert.deepEqual([v1.d.config.capa_tipo, v1.d.config.capa_video, v1.d.config.logo_tamanho], ['video', urlVideo, '240']);
    const comLink = JSON.parse(JSON.stringify(comVideo));
    comLink.config.capa_video = 'https://cdn.exemplo.com/topo.webm?v=3'; // também aceita um link direto
    assert.equal((await post(comLink)).c, 200);

    const carrossel = JSON.parse(JSON.stringify(base));
    Object.assign(carrossel.config, { capa_tipo: 'carrossel', capa_fotos: [foto, foto, foto], capa_intervalo: '6' });
    const v2 = await post(carrossel);
    assert.equal(v2.c, 200, v2.d?.erro);
    assert.deepEqual(JSON.parse(v2.d.config.capa_fotos), [foto, foto, foto]);
    const pub = (await chamar(pagina, { method: 'GET', url: '/api/pagina' })).d.config;
    assert.deepEqual([pub.capa_tipo, pub.capa_intervalo, JSON.parse(pub.capa_fotos).length], ['carrossel', '6', 3]);
    const h2 = (await chamar(admin, { method: 'GET', url: '/api/admin?historico=1', headers: login })).d[0].mudancas.join(' | ');
    assert.ok(h2.includes('Mudou o fundo do topo para carrossel de fotos'), h2);
    assert.ok(h2.includes('Alterou as fotos do carrossel do topo'), h2);
    const antes = (await chamar(admin, { method: 'GET', url: '/api/admin?historico=1', headers: login })).d.length;
    assert.equal((await post(carrossel)).c, 200); // salvar igual não gera registro
    assert.equal((await chamar(admin, { method: 'GET', url: '/api/admin?historico=1', headers: login })).d.length, antes);
  }

  // Volta ao original (mesmos ids; o bloco novo some).
  const volta = clone();
  for (const k of ['fonte', 'estilo', 'sombra', 'cor_bloco']) volta.config[k] ??= '';
  assert.equal((await post(volta)).c, 200);
  const fim = (await chamar(admin, { method: 'GET', url: '/api/admin?dados=1', headers: login })).d;
  assert.equal(fim.links.length, 6);
  assert.equal(fim.links[0].nome, orig.links[0].nome);
  assert.deepEqual(fim.links.map(l => l.id), orig.links.map(l => l.id));
  console.log('ok');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
