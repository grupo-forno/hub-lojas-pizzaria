// Checagem do repasse de UTMs e dos eventos do GA4. Não precisa de Docker nem de internet.
//   node teste-analytics.js
// Parte 1: funções puras (analytics.js). Parte 2: a página de verdade num Edge sem janela, com API de mentira
// (sem Edge instalado, só a parte 1 roda). O GA4 não é carregado: lemos o que a página põe no dataLayer.
const assert = require('assert');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { destinoComUtm, identificar } = require('./analytics.js');
const { lojas } = require('./lojas.js');

const SEV = 'https://fornopaulista.tuigoapp.com.br/fornopaulistadomseverino/pedidos';
const P = { utm_source: 'hub', utm_medium: 'direto' };
const q = u => Object.fromEntries(new URL(u).searchParams);

// ---- Parte 1: UTMs
const bio = new URLSearchParams('utm_source=instagram&utm_medium=organic_social&utm_campaign=bio');
let r = q(destinoComUtm(SEV, bio, P));
assert.deepStrictEqual(r, { utm_source: 'instagram', utm_medium: 'organic_social', utm_campaign: 'bio', utm_content: 'pedeforno' }, 'completas');
r = q(destinoComUtm(SEV, new URLSearchParams('utm_source=whatsapp&utm_medium=messaging&utm_campaign=black_friday_2026'), P));
assert.strictEqual(r.utm_campaign, 'black_friday_2026'); assert.strictEqual(r.utm_medium, 'messaging');
r = q(destinoComUtm(SEV, new URLSearchParams('utm_campaign=bio'), P)); // parciais: o que veio vence, o resto cai no padrão
assert.deepStrictEqual([r.utm_source, r.utm_medium, r.utm_campaign], ['hub', 'direto', 'bio']);
r = q(destinoComUtm(SEV, new URLSearchParams(), P)); // sem UTMs
assert.deepStrictEqual(r, { utm_source: 'hub', utm_medium: 'direto', utm_content: 'pedeforno' });
// destino com parâmetros próprios: ficam; UTM escrita no destino vence o padrão, mas perde para a recebida
const comParam = `${SEV}?mesa=7&utm_source=cadastro&utm_term=pizza`;
r = q(destinoComUtm(comParam, new URLSearchParams(), P));
assert.deepStrictEqual([r.mesa, r.utm_source, r.utm_term, r.utm_medium], ['7', 'cadastro', 'pizza', 'direto']);
r = q(destinoComUtm(comParam, bio, P));
assert.deepStrictEqual([r.mesa, r.utm_source, r.utm_term], ['7', 'instagram', 'pizza']);
assert.strictEqual(q(destinoComUtm(SEV, new URLSearchParams('utm_source=&utm_medium=x'), P)).utm_source, 'hub', 'UTM vazia não conta');
assert.strictEqual(q(destinoComUtm(SEV, new URLSearchParams('utm_content=story'), P)).utm_content, 'story_pedeforno');
assert.strictEqual(q(destinoComUtm(SEV, new URLSearchParams('utm_content=story_pedeforno'), P)).utm_content, 'story_pedeforno', 'marca não duplica');
assert.ok(destinoComUtm(SEV, bio, P).startsWith(SEV + '?'));
// Link de campanha (utm_id): o id viaja até a Tuigo e o utm_content/utm_term definidos na campanha ficam como estão
const camp = new URLSearchParams('utm_source=whatsapp&utm_medium=messaging&utm_campaign=black_friday_2026&utm_id=pf_aaaaaaaaaa&utm_content=story_1');
r = q(destinoComUtm(SEV, camp, P, 'domseverino_pedido'));
assert.deepStrictEqual(r, { utm_source: 'whatsapp', utm_medium: 'messaging', utm_campaign: 'black_friday_2026', utm_id: 'pf_aaaaaaaaaa', utm_content: 'story_1', utm_term: 'domseverino_pedido' });
r = q(destinoComUtm(SEV, new URLSearchParams(camp + '&utm_term=combo'), P, 'domseverino_pedido'));
assert.deepStrictEqual([r.utm_term, r.utm_content, r.utm_id], ['combo', 'story_1', 'pf_aaaaaaaaaa'], 'termo da campanha vence o id do botão');
assert.strictEqual(q(destinoComUtm(SEV, new URLSearchParams('utm_id=pf_aaaaaaaaaa'), P)).utm_content, undefined, 'campanha identificada pelo utm_id: sem marca no utm_content');
assert.strictEqual(q(destinoComUtm(SEV, bio, P)).utm_id, undefined, 'link antigo continua sem utm_id (nada inventado)');
assert.strictEqual(q(destinoComUtm(SEV, new URLSearchParams(), P, 'domseverino_pedido')).utm_term, 'domseverino_pedido', 'botão em utm_term');
assert.strictEqual(q(destinoComUtm(SEV, new URLSearchParams('utm_term=x'), P, 'domseverino_pedido')).utm_term, 'x', 'utm_term recebida vence');
assert.strictEqual(q(destinoComUtm(SEV + '?utm_term=cad', new URLSearchParams(), P, 'b')).utm_term, 'cad', 'utm_term do destino fica');

// ---- Parte 1: ids dos botões
const un = { nome: 'Dom Severino', titulo: 'Unidade Dom Severino', loja: 'fornopaulistadomseverino' };
const reg = identificar({ id: 5, acao: 'pedido', loja: un.loja, url: SEV }, un, lojas);
const promo = identificar({ id: 40, acao: 'pedido', url: SEV, titulo: 'Peça na Dom Severino' }, { nome: 'BLACK FORNO', titulo: '' }, lojas);
assert.deepStrictEqual(reg, { button_id: 'domseverino_pedido', button_type: 'pedido', unit_id: un.loja });
assert.deepStrictEqual(promo, { button_id: 'promocional_domseverino_40', button_type: 'promocional', unit_id: un.loja });
assert.notStrictEqual(reg.button_id, promo.button_id);
assert.strictEqual(identificar({ id: 6, acao: 'whatsapp', loja: un.loja }, un, lojas).button_id, 'domseverino_whatsapp');
assert.strictEqual(identificar({ id: 7, acao: 'mapa', loja: un.loja }, un, lojas).button_type, 'localizacao');
assert.strictEqual(identificar({ id: 8, acao: 'link', titulo: 'CARDÁPIO ON-LINE', url: 'https://cardapio.grupofornopaulista.com/' }, { nome: 'CARDÁPIO ON-LINE' }, lojas).button_type, 'cardapio');
assert.strictEqual(identificar({ id: 9, acao: 'whatsapp', titulo: 'Marque Seu Evento' }, { nome: 'Marque Seu Evento' }, lojas).button_type, 'evento');
console.log('ok: UTMs e ids de botão');

// ---- Parte 2: página real
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if (!EDGE) { console.log('Edge não encontrado: parte da página pulada.'); process.exit(0); }

const unidade = (id, nome, loja, aberto) => ({ id, pai: null, tipo: 'bloco', nome, titulo: `Unidade ${nome}`, loja, opcoes: { visibilidade: aberto ? 'aberto' : 'recolhido' }, filhos: [
  { id: id + 1, tipo: 'acao', acao: 'pedido', titulo: 'Faça Seu Pedido', url: `https://fornopaulista.tuigoapp.com.br/${loja}/pedidos?mesa=7`, loja, utm: true },
  { id: id + 2, tipo: 'acao', acao: 'whatsapp', titulo: 'WhatsApp', url: 'https://wa.me/558688652928', loja },
  { id: id + 3, tipo: 'acao', acao: 'mapa', titulo: 'Localização', url: 'https://maps.app.goo.gl/x', loja }] });
const FIXTURE = { config: {}, links: [
  unidade(10, 'Hugo Napoleão', 'fornopaulistaleste', false),
  unidade(20, 'Dom Severino', 'fornopaulistadomseverino', false),
  unidade(30, 'Sul', 'fornopaulistasul', true), // aberta desde o início: exposição, não abertura
  { id: 40, tipo: 'bloco', nome: 'BLACK FORNO', titulo: '', opcoes: { visibilidade: 'aberto' }, filhos: [
    { id: 41, tipo: 'acao', acao: 'pedido', titulo: 'Peça na Dom Severino', url: SEV, utm: true }] },
  { id: 50, tipo: 'bloco', nome: 'Marque Seu Evento', titulo: '', opcoes: { visibilidade: 'aberto' }, filhos: [
    { id: 51, tipo: 'acao', acao: 'whatsapp', titulo: 'Marque Seu Evento', url: 'https://wa.me/558698194974' }] },
  { id: 60, tipo: 'bloco', nome: 'CARDÁPIO ON-LINE', titulo: '', opcoes: { visibilidade: 'aberto', layout: 'card' }, filhos: [
    { id: 61, tipo: 'acao', acao: 'link', titulo: 'CARDÁPIO ON-LINE', url: 'https://cardapio.grupofornopaulista.com/', utm: true }] },
] };

const eventosLegados = [];
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/pagina') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(FIXTURE)); }
  if (url.pathname === '/api/evento') { let b = ''; req.on('data', d => (b += d)); return req.on('end', () => { eventosLegados.push(JSON.parse(b)); res.statusCode = 204; res.end(); }); }
  const f = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(__dirname) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-edge-'));
  const porta = 9300 + Math.floor(Math.random() * 500);
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--no-first-run', '--disable-gpu', '--disable-extensions',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  const fim = async code => { edge.kill(); servidor.close(); await new Promise(r => setTimeout(r, 300)); try { fs.rmSync(perfil, { recursive: true, force: true }); } catch {} process.exit(code); };
  setTimeout(() => { console.error('teste da página: passou de 60 s'); fim(1); }, 60000).unref();
  try {
    let alvo;
    for (let i = 0; i < 50 && !alvo; i++) {
      await new Promise(r => setTimeout(r, 200));
      try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find(t => t.type === 'page' && t.url === 'about:blank'); } catch {}
    }
    assert.ok(alvo, 'Edge não abriu');
    const ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise(ok => (ws.onopen = ok));
    let n = 0; const pend = new Map();
    ws.onmessage = m => { const d = JSON.parse(m.data); pend.get(d.id)?.(d); };
    const cdp = (method, params = {}) => new Promise(ok => { const id = ++n; pend.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
    const js = async expr => { const d = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails)); return d.result.result.value; };
    const pausa = ms => new Promise(r => setTimeout(r, ms));
    // eventos do GA4 = entradas 'event' do dataLayer (gtag empurra o objeto arguments)
    const ga = () => js(`[...dataLayer].map(a => [...a]).filter(a => a[0] === 'event').map(a => [a[1], a[2]])`);
    const abrir = async url => {
      eventosLegados.length = 0;
      await cdp('Page.enable');
      await cdp('Page.navigate', { url: origem + url });
      await js(`new Promise(ok => { const t = setInterval(() => { if (document.querySelectorAll('#lojas a').length >= 10) { clearInterval(t); ok(); } }, 50); })`);
      await pausa(300);
      await js(`document.addEventListener('click', e => e.preventDefault())`); // a navegação para a Tuigo fica de fora do teste
    };

    // UTMs completas
    await abrir('/?utm_source=instagram&utm_medium=organic_social&utm_campaign=bio');
    let ev = await ga();
    assert.deepStrictEqual(ev.map(e => e[0]), ['hub_view'], 'só hub_view na abertura: nem a unidade aberta por padrão conta');
    const hrefs = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#lojas a')].map(a => [a.textContent.trim(), a.href]))`));
    const sev = hrefs.filter(([, h]) => h.includes('domseverino') && h.includes('/pedidos'));
    assert.strictEqual(sev.length, 2, 'Dom Severino: regular + BLACK FORNO');
    for (const [, h] of sev) assert.deepStrictEqual(q(h), { utm_source: 'instagram', utm_medium: 'organic_social', utm_campaign: 'bio', utm_term: h.includes('mesa') ? 'domseverino_pedido' : 'promocional_domseverino_41', utm_content: 'pedeforno', ...(h.includes('mesa') ? { mesa: '7' } : {}) });
    const black = hrefs.find(([t]) => t.includes('Peça na Dom Severino'))[1];
    assert.ok(black.includes('/fornopaulistadomseverino/pedidos') && !black.includes('leste'));

    // Abrir unidade: um clique abre (1 evento), outro fecha (nenhum)
    const abrirUnidade = nome => js(`[...document.querySelectorAll('summary')].find(s => s.textContent.includes(${JSON.stringify(nome)})).click()`);
    await abrirUnidade('Dom Severino'); await pausa(600);
    await abrirUnidade('Dom Severino'); await pausa(600);
    ev = (await ga()).filter(e => e[0] === 'hub_unit_open');
    assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0][1].unit_id, 'fornopaulistadomseverino');
    assert.deepStrictEqual(['view', 'abrir'].map(t => eventosLegados.filter(e => e.tipo === t).length), [1, 1], 'legado: 1 view, 1 abrir');

    // Um clique em cada botão: um hub_button_click por clique, ids únicos
    const total = Number(await js(`document.querySelectorAll('#lojas a').length`));
    for (let i = 0; i < total; i++) await js(`document.querySelectorAll('#lojas a')[${i}].click()`);
    await pausa(500);
    const cliques = (await ga()).filter(e => e[0] === 'hub_button_click').map(e => e[1]);
    assert.strictEqual(cliques.length, total, 'um evento por clique');
    assert.strictEqual(new Set(cliques.map(c => c.button_id)).size, total, 'ids distintos');
    assert.ok(cliques.every(c => c.transport_type === 'beacon'));
    const tipos = new Set(cliques.map(c => c.button_type));
    for (const t of ['pedido', 'whatsapp', 'localizacao', 'promocional', 'cardapio', 'evento']) assert.ok(tipos.has(t), t);
    const ids = cliques.map(c => c.button_id);
    assert.ok(ids.includes('domseverino_pedido') && ids.includes('promocional_domseverino_41'));
    assert.strictEqual(cliques.find(c => c.button_id === 'domseverino_pedido').unit_id, 'fornopaulistadomseverino');
    assert.strictEqual(eventosLegados.filter(e => e.tipo === 'click').length, total, 'legado: um click por botão, sem duplicar');

    // Nova aba (botão do meio) e _gl: a página não pode desfazer nenhum dos dois
    const antes = (await ga()).length;
    await js(`(() => { const a = document.querySelector('a[href*="domseverino/pedidos"]'); a.target = '_blank'; a.rel = 'noopener';
      a.href += '&_gl=1*abc'; // o GA4 decora o href assim, no clique
      a.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
      a.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true })); a.click(); })()`);
    assert.deepStrictEqual(JSON.parse(await js(`(() => { const a = document.querySelector('a[href*="domseverino/pedidos"]'); return JSON.stringify([a.target, a.rel, a.href.includes('_gl=1*abc'), a.href.includes('utm_source=instagram')]); })()`)), ['_blank', 'noopener', true, true]);
    assert.strictEqual((await ga()).length - antes, 2, 'auxclick do meio + click = 2; botão direito não conta');

    // Teclado: Enter num link focado vira 'click' nativo (um evento só)
    const antesTeclado = (await ga()).length;
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await js(`document.querySelector('a[href*="558698194974"]').focus()`);
    for (const type of ['rawKeyDown', 'char', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'char' ? { text: '\r' } : {}) });
    await pausa(300);
    assert.strictEqual((await ga()).length - antesTeclado, 1, 'Enter = 1 evento');

    // Consentimento: nasce negado, sem cookie, uma instalação só
    const consent = JSON.parse(await js(`JSON.stringify([...dataLayer].map(a => [...a]).find(a => a[0] === 'consent' && a[1] === 'default'))`));
    assert.strictEqual(consent[2].analytics_storage, 'denied');
    assert.strictEqual(await js('document.cookie'), '');
    assert.strictEqual(Number(await js(`document.querySelectorAll('script[src*="googletagmanager"]').length`)), 1, 'uma instalação só');

    // UTMs parciais e ausentes
    await abrir('/?utm_campaign=black_friday_2026');
    let u = q(await js(`document.querySelector('a[href*="domseverino/pedidos"]').href`));
    assert.deepStrictEqual([u.utm_source, u.utm_medium, u.utm_campaign], ['hub', 'direto', 'black_friday_2026']);
    await abrir('/');
    u = q(await js(`document.querySelector('a[href*="domseverino/pedidos"]').href`));
    assert.deepStrictEqual([u.utm_source, u.utm_medium, u.utm_campaign, u.mesa], ['hub', 'direto', undefined, '7']);

    // Link de campanha copiado do admin: utm_id e utm_content chegam à Tuigo nos dois botões (regular e promocional); a coleta guarda o utm_id
    await abrir('/?utm_source=whatsapp&utm_medium=messaging&utm_campaign=black_friday_2026&utm_id=pf_aaaaaaaaaa&utm_content=story_1');
    const hrefsCamp = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#lojas a')].filter(a => a.href.includes('/pedidos')).map(a => a.href))`));
    assert.ok(hrefsCamp.length >= 4);
    for (const h of hrefsCamp) assert.deepStrictEqual([q(h).utm_id, q(h).utm_content, q(h).utm_source, q(h).utm_medium, q(h).utm_campaign], ['pf_aaaaaaaaaa', 'story_1', 'whatsapp', 'messaging', 'black_friday_2026']);
    const termos = hrefsCamp.filter(h => h.includes('domseverino')).map(h => q(h).utm_term).sort();
    assert.deepStrictEqual(termos, ['domseverino_pedido', 'promocional_domseverino_41'], 'o botão regular e o promocional se distinguem pelo utm_term');
    assert.strictEqual(eventosLegados.find(e => e.tipo === 'view').utm_id, 'pf_aaaaaaaaaa');
    await abrir('/?utm_source=whatsapp&utm_medium=messaging&utm_campaign=x&utm_id=pf_aaaaaaaaaa&utm_term=combo');
    assert.ok((JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#lojas a')].filter(a => a.href.includes('/pedidos')).map(a => new URL(a.href).searchParams.get('utm_term')))`))).every(t => t === 'combo'), 'utm_term da campanha preservado');

    // Prévia do admin: nada de GA4 nem de contador legado
    await abrir('/?previa=1');
    assert.strictEqual(Number(await js(`(window.dataLayer || []).length`)), 0);
    assert.strictEqual(Number(await js(`document.querySelectorAll('script[src*="googletagmanager"]').length`)), 0);
    assert.strictEqual(eventosLegados.length, 0);
    console.log('ok: página (eventos, UTMs, nova aba, _gl, teclado, consentimento, prévia)');
    await fim(0);
  } catch (e) { console.error(e); await fim(1); }
})();
