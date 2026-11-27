// Gestão da página: GET entrega a tela (?dados = conteúdo, ?historico = últimas alterações); POST grava tudo de uma vez.
// Modelo igual ao Beacons: a página é uma lista de blocos; cada bloco tem links (filhos), um layout e aberto/recolhido.
const fs = require('fs');
const path = require('path');
const { query, pool, arvore } = require('./_lib/db.js');
const { autenticar } = require('./_lib/auth.js');
const usuarios = require('./_lib/usuarios.js');
const { ICONES, REDES } = require('../icones.js');
const { resultados, funil } = require('./_lib/resultados.js');
const campanhas = require('./_lib/campanhas.js');
const { enderecoDoSite } = require('./_lib/email.js');

const CAMPOS = ['titulo', 'rodape', 'cor', 'cor_topo', 'cor_bloco', 'cor_texto', 'fonte', 'estilo', 'sombra', 'contorno', 'capa', 'logo', 'instagram',
  'capa_tipo', 'capa_video', 'capa_fotos', 'capa_intervalo', 'logo_tamanho']; // fundo do topo (foto, vídeo ou carrossel) e tamanho da logo
const TIPOS_CAPA = ['foto', 'video', 'carrossel'];
const MAX_FOTOS = 8;
const CORES = { cor: 'Fundo da página', cor_topo: 'Texto e ícones do cabeçalho', cor_bloco: 'Fundo do bloco', cor_texto: 'Texto do bloco' };
const FONTES = ['Actor', 'Inter', 'Poppins', 'Montserrat', 'Nunito', 'Roboto', 'Lora', 'Playfair Display']; // mesma lista da tela
const ESTILOS = ['oval', 'arredondado', 'quadrado', 'largo'];
const TIPOS_ACAO = ['pedido', 'whatsapp', 'mapa', 'link'];
// Opções do bloco (abas Layout e Configurações do editor) e seus padrões.
const OPCOES = {
  layout: ['classico', 'card', 'carrossel'],
  visibilidade: ['aberto', 'recolhido'],
  tamanho: ['p', 'g'],
  alinhamento: ['centro', 'esquerda', 'direita'],
  posicao_imagem: ['esquerda', 'direita'],
  tamanho_texto: ['p', 'm', 'g', 'gg'],
  pai_tamanho: ['compacto', 'destaque'], // card pai (cabeçalho do dropdown)
};
const PADRAO_OPCOES = { layout: 'classico', visibilidade: 'aberto', tamanho: 'p', alinhamento: 'centro', posicao_imagem: 'esquerda', tamanho_texto: 'g', contorno: false, sombra: false, miniatura: '', pai_tamanho: 'compacto', pai_cor_bloco: '', pai_cor_texto: '' };

// Personalização de cada link (ferramentas no rodapé do link): animação, agenda, etiqueta e cores.
const ANIMACOES = ['', 'bounce', 'jello', 'wobble', 'pulse', 'shake', 'tada'];
const EXTRAS = ['animacao', 'inicio', 'fim', 'etiqueta', 'cor_bloco', 'cor_texto'];

const txt = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const urlOk = s => s === '' || /^https?:\/\//i.test(s);
// Imagem enviada pelo admin, endereço na internet ou arquivo do projeto (capa.jpg).
const IMAGEM = /^(\/api\/imagem\?id=\d+|https?:\/\/\S+|[\w-]+\.(jpe?g|png|webp))$/i;
// Vídeo do topo: enviado pelo admin ou um link direto para um arquivo .mp4/.webm.
const VIDEO = /^(\/api\/imagem\?id=\d+|https:\/\/[^\s?#]+\.(mp4|webm)(\?\S*)?)$/i;
// Ícone/imagem do link: um da biblioteca (i:whatsapp), uma imagem, ou "nenhum".
const iconeOk = s => s === '' || s === 'nenhum' || (s.startsWith('i:') ? Object.hasOwn(ICONES, s.slice(2)) : IMAGEM.test(s));

async function carregar() {
  const [config, links] = await Promise.all([
    query('select chave, valor from config'),
    query('select id, pai, tipo, nome, acao, titulo, subtitulo, url, loja, utm, ativo, icone, opcoes from links order by ordem, id'),
  ]);
  return { config: Object.fromEntries(config.rows.map(r => [r.chave, r.valor])), links: arvore(links.rows) };
}

function opcoes(o, erros, onde) {
  const r = { ...PADRAO_OPCOES };
  for (const [k, validos] of Object.entries(OPCOES)) if (o?.[k] != null) { if (validos.includes(o[k])) r[k] = o[k]; else erros.push(`${onde}: opção "${k}" inválida.`); }
  r.contorno = o?.contorno === true;
  r.sombra = o?.sombra === true;
  for (const k of ['pai_cor_bloco', 'pai_cor_texto']) { r[k] = txt(o?.[k], 7); if (r[k] && !/^#[0-9a-f]{6}$/i.test(r[k])) erros.push(`${onde}: cor do card pai inválida.`); }
  r.miniatura = txt(o?.miniatura, 200);
  if (r.miniatura && !IMAGEM.test(r.miniatura)) erros.push(`${onde}: imagem do botão inválida.`);
  return r;
}

function opcoesLink(o, erros, onde) {
  const r = Object.fromEntries(EXTRAS.map(k => [k, txt(o?.[k], 40)]));
  r.etiqueta = r.etiqueta.slice(0, 20);
  if (!ANIMACOES.includes(r.animacao)) erros.push(`${onde}: animação inválida.`);
  for (const k of ['inicio', 'fim']) if (r[k] && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(r[k])) erros.push(`${onde}: data do agendamento inválida.`);
  if (r.inicio && r.fim && Date.parse(r.inicio) >= Date.parse(r.fim)) erros.push(`${onde}: a data de esconder precisa ser depois da data de mostrar.`);
  for (const k of ['cor_bloco', 'cor_texto']) if (r[k] && !/^#[0-9a-f]{6}$/i.test(r[k])) erros.push(`${onde}: cor do botão inválida.`);
  return Object.values(r).some(Boolean) ? r : null; // sem personalização: nada guardado
}

// Confere e limpa o que veio da tela. Devolve { config, links } ou { erros }.
function validar(b) {
  const erros = [];
  const config = Object.fromEntries(CAMPOS.map(k => [k, txt(b?.config?.[k], 300)]));
  for (const [k, nome] of Object.entries(CORES)) if (config[k] && !/^#[0-9a-f]{6}$/i.test(config[k])) erros.push(`Cor inválida em "${nome}" (use o formato #581512).`);
  if (config.fonte && !FONTES.includes(config.fonte)) erros.push('Fonte inválida.');
  if (config.estilo && !ESTILOS.includes(config.estilo)) erros.push('Estilo de bloco inválido.');
  for (const k of ['sombra', 'contorno']) config[k] = config[k] === '1' ? '1' : '0';
  if (!urlOk(config.instagram)) erros.push('O link do Instagram precisa começar com https://');
  for (const k of ['capa', 'logo']) if (config[k] && !IMAGEM.test(config[k])) erros.push(`Imagem inválida em "${k}".`);

  // Fundo do topo: foto única, vídeo ou carrossel automático de fotos.
  if (config.capa_tipo && !TIPOS_CAPA.includes(config.capa_tipo)) erros.push('Tipo de fundo do topo inválido.');
  if (config.capa_video && !VIDEO.test(config.capa_video)) erros.push('O vídeo do topo precisa ser um arquivo enviado aqui ou um link https para um .mp4 ou .webm.');
  let fotos = b?.config?.capa_fotos;
  if (typeof fotos === 'string') { try { fotos = JSON.parse(fotos); } catch { fotos = []; } }
  fotos = (Array.isArray(fotos) ? fotos : []).map(f => txt(f, 300)).filter(Boolean);
  if (fotos.length > MAX_FOTOS) erros.push(`O carrossel do topo aceita até ${MAX_FOTOS} fotos.`);
  for (const f of fotos) if (!IMAGEM.test(f)) erros.push('Uma das fotos do carrossel do topo é inválida.');
  config.capa_fotos = JSON.stringify(fotos);
  if (config.capa_tipo === 'video' && !config.capa_video) erros.push('Escolha o vídeo do topo (ou volte para foto).');
  if (config.capa_tipo === 'carrossel' && fotos.length < 2) erros.push('O carrossel do topo precisa de pelo menos 2 fotos.');
  if (config.capa_intervalo && !(/^\d+$/.test(config.capa_intervalo) && config.capa_intervalo >= 3 && config.capa_intervalo <= 15)) erros.push('O tempo de cada foto do carrossel vai de 3 a 15 segundos.');
  if (config.logo_tamanho && !(/^\d+$/.test(config.logo_tamanho) && config.logo_tamanho >= 60 && config.logo_tamanho <= 360)) erros.push('O tamanho da logo vai de 60 a 360.');

  // Ícones sociais do topo: lista guardada como JSON.
  let redes = b?.config?.redes;
  if (typeof redes === 'string') { try { redes = JSON.parse(redes); } catch { redes = []; } }
  redes = (Array.isArray(redes) ? redes.slice(0, 12) : []).map(r => ({ rede: txt(r?.rede, 20), url: txt(r?.url, 500), ativo: r?.ativo !== false }));
  for (const r of redes) {
    if (!REDES.includes(r.rede)) erros.push('Ícone social de tipo inválido.');
    else if (!/^(https?:\/\/|mailto:|tel:)\S+$/i.test(r.url)) erros.push(`Ícone social "${ICONES[r.rede][0]}": o link precisa começar com https://, mailto: ou tel:`);
  }
  config.redes = JSON.stringify(redes);

  const base = l => ({
    id: Number.isInteger(l?.id) && l.id > 0 ? l.id : null,
    titulo: txt(l?.titulo, 100),
    subtitulo: txt(l?.subtitulo, 200) || null,
    ativo: l?.ativo !== false,
  });

  const lista = Array.isArray(b?.links) ? b.links.slice(0, 50) : [];
  if (!lista.length) erros.push('A página precisa de pelo menos um bloco.');
  const links = lista.map(l => {
    const nome = txt(l?.nome, 100) || txt(l?.titulo, 100);
    const onde = nome || 'Bloco sem nome';
    const bloco = { ...base(l), tipo: 'bloco', nome, acao: null, url: '', utm: false, icone: '', loja: txt(l?.loja, 60), opcoes: opcoes(l?.opcoes, erros, onde) };
    if (!nome) erros.push('Um bloco está sem nome.');
    if (bloco.loja && !/^[\w.-]+$/.test(bloco.loja)) erros.push(`${onde}: código da loja só aceita letras, números, ponto, traço e _.`);
    bloco.filhos = (Array.isArray(l?.filhos) ? l.filhos.slice(0, 20) : []).map(f => {
      const link = { ...base(f), tipo: 'acao', nome: null, acao: f?.acao || 'link', url: txt(f?.url, 500), utm: !!f?.utm, icone: txt(f?.icone, 200), loja: bloco.loja };
      const em = `${onde} › ${link.titulo || 'link sem título'}`;
      link.opcoes = opcoesLink(f?.opcoes, erros, em);
      if (!TIPOS_ACAO.includes(link.acao)) erros.push(`${em}: tipo inválido.`);
      if (!iconeOk(link.icone)) erros.push(`${em}: ícone ou imagem inválida.`);
      if (!link.titulo && bloco.opcoes.layout !== 'carrossel') erros.push(`${em}: falta o título.`); // no carrossel só a imagem aparece
      if (!link.url) { if (bloco.opcoes.layout !== 'carrossel') erros.push(`${em}: falta o link.`); } // no carrossel a foto pode não levar a lugar nenhum
      else if (!urlOk(link.url)) erros.push(`${em}: o link precisa começar com https://`);
      if (bloco.opcoes.layout === 'carrossel' && !/^(\/api\/imagem|https?:|[\w-]+\.)/.test(link.icone)) erros.push(`${em}: no carrossel cada link precisa de uma imagem.`);
      return link;
    });
    return bloco;
  });
  return erros.length ? { erros } : { config, links };
}

// Frases do histórico: o que mudou entre o que estava salvo e o que chegou.
const NOME_CONFIG = {
  titulo: 'o título da página', rodape: 'o rodapé', cor: 'a cor de fundo da página', cor_topo: 'a cor do cabeçalho',
  cor_bloco: 'a cor de fundo dos blocos', cor_texto: 'a cor do texto dos blocos', fonte: 'a fonte', estilo: 'o estilo dos blocos',
  sombra: 'a sombra dos blocos', contorno: 'o contorno dos blocos', capa: 'a foto de fundo', logo: 'a logo', redes: 'os ícones sociais',
  capa_tipo: 'o tipo de fundo do topo', capa_video: 'o vídeo do topo', capa_fotos: 'as fotos do carrossel do topo', capa_intervalo: 'o tempo de cada foto do topo', logo_tamanho: 'o tamanho da logo',
};
const comparavel = o => JSON.stringify(Object.keys(PADRAO_OPCOES).map(k => o?.[k] ?? PADRAO_OPCOES[k]));
const nomeBloco = l => l.nome || l.titulo;
function descrever(antes, novo) {
  const m = [];
  for (const [k, nome] of Object.entries(NOME_CONFIG)) {
    const a = antes.config[k] ?? '';
    const b = novo.config[k] ?? '';
    if (a === b) continue;
    if (k === 'sombra' || k === 'contorno') m.push(`${b === '1' ? 'Ligou' : 'Desligou'} ${nome}`);
    else if (['capa', 'logo', 'redes', 'capa_video', 'capa_fotos'].includes(k) || !a) m.push(`Alterou ${nome}`);
    else if (k === 'capa_tipo') m.push(`Mudou o fundo do topo para ${{ foto: 'foto', video: 'vídeo', carrossel: 'carrossel de fotos' }[b] || b}`);
    else m.push(`Alterou ${nome}: ${a} → ${b}`);
  }
  const plano = lista => lista.flatMap(l => [{ ...l, onde: nomeBloco(l) }, ...l.filhos.map(f => ({ ...f, onde: `${nomeBloco(l)} › ${f.titulo || 'imagem'}` }))]);
  const velhos = new Map(plano(antes.links).map(l => [l.id, l]));
  const ficaram = new Set();
  for (const l of plano(novo.links)) {
    const v = l.id && velhos.get(l.id);
    if (!v) { m.push(`Adicionou "${l.onde}"`); continue; }
    ficaram.add(l.id);
    const bloco = l.tipo === 'bloco';
    if (bloco && nomeBloco(v) !== nomeBloco(l)) m.push(`Renomeou o bloco "${nomeBloco(v)}" para "${nomeBloco(l)}"`);
    if (v.titulo !== l.titulo) m.push(bloco ? `Mudou o título de "${l.onde}"` : `Renomeou "${v.onde}" para "${l.titulo}"`);
    if ((v.url || '') !== (l.url || '')) m.push(`Mudou o link de "${l.onde}"`);
    if ((v.subtitulo || '') !== (l.subtitulo || '')) m.push(`Mudou o subtítulo de "${l.onde}"`);
    if (v.ativo !== l.ativo) m.push(`${l.ativo ? 'Mostrou' : 'Escondeu'} "${l.onde}"`);
    if ((v.icone || '') !== (l.icone || '')) m.push(`Trocou a imagem/ícone de "${l.onde}"`);
    if (v.utm !== l.utm) m.push(`${l.utm ? 'Ligou' : 'Desligou'} a UTM em "${l.onde}"`);
    if ((v.acao || '') !== (l.acao || '')) m.push(`Mudou o tipo de "${l.onde}"`);
    if (bloco && (v.loja || '') !== (l.loja || '')) m.push(`Mudou o código da loja de "${l.onde}"`);
    if (bloco && comparavel(v.opcoes) !== comparavel(l.opcoes)) m.push(`Mudou o layout de "${l.onde}"`);
    if (!bloco) {
      const mudou = (...ks) => ks.some(k => (v.opcoes?.[k] || '') !== (l.opcoes?.[k] || ''));
      if (mudou('animacao')) m.push(l.opcoes?.animacao ? `Animou "${l.onde}"` : `Tirou a animação de "${l.onde}"`);
      if (mudou('inicio', 'fim')) m.push(`Mudou o agendamento de "${l.onde}"`);
      if (mudou('etiqueta')) m.push(l.opcoes?.etiqueta ? `Pôs a etiqueta "${l.opcoes.etiqueta}" em "${l.onde}"` : `Tirou a etiqueta de "${l.onde}"`);
      if (mudou('cor_bloco', 'cor_texto')) m.push(`Mudou as cores do botão "${l.onde}"`);
    }
  }
  for (const [id, v] of velhos) if (!ficaram.has(id)) m.push(`Removeu "${v.onde}"`);
  const ordem = (lista, ids) => lista.map(l => l.id).filter(id => ids.has(id)).join();
  if (ordem(antes.links, ficaram) !== ordem(novo.links, ficaram)) m.push('Mudou a ordem dos blocos');
  for (const l of novo.links) {
    const v = l.id && velhos.get(l.id);
    if (v?.filhos && ordem(v.filhos, ficaram) !== ordem(l.filhos, ficaram)) m.push(`Mudou a ordem dos links de "${nomeBloco(l)}"`);
  }
  return m;
}

// Tudo ou nada: se algo falhar no meio, a página pública continua como estava.
async function salvar({ config, links }, usuario) {
  const antes = await carregar();
  const mudancas = descrever(antes, { config, links });
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const [k, v] of Object.entries(config)) {
      await c.query('insert into config (chave, valor) values ($1, $2) on conflict (chave) do update set valor = excluded.valor', [k, v]);
    }
    const manter = [];
    const gravar = async (l, pai, ordem) => {
      const v = [pai, l.tipo, l.nome, l.acao, l.titulo, l.subtitulo, l.url || null, l.loja || null, l.utm, ordem, l.ativo, l.icone || null, l.opcoes];
      let id = l.id && (await c.query(
        'update links set pai=$1, tipo=$2, nome=$3, acao=$4, titulo=$5, subtitulo=$6, url=$7, loja=$8, utm=$9, ordem=$10, ativo=$11, icone=$12, opcoes=$13 where id=$14 returning id', [...v, l.id])).rows[0]?.id;
      id ||= (await c.query(
        'insert into links (pai, tipo, nome, acao, titulo, subtitulo, url, loja, utm, ordem, ativo, icone, opcoes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id', v)).rows[0].id;
      manter.push(id);
      return id;
    };
    for (const [i, l] of links.entries()) {
      const id = await gravar(l, null, i);
      for (const [j, f] of l.filhos.entries()) await gravar(f, id, j);
    }
    await c.query('delete from links where id <> all($1::int[])', [manter]); // o que saiu da tela sai do banco
    if (mudancas.length) await c.query('insert into alteracoes (usuario, mudancas) values ($1, $2)', [usuario, JSON.stringify(mudancas)]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const siteOuNulo = req => { try { return enderecoDoSite(req); } catch { return null; } }; // sem SITE_URL a tela mostra só o link completo

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const eu = await autenticar(req);
    const q = new URL(req.url, 'http://x').searchParams;
    if (!eu) { // sem sessão: a página mostra a tela de entrada; as chamadas de dados recebem 401
      if (req.method === 'GET' && !['dados', 'resultados', 'funil', 'campanhas', 'campanha', 'historico', 'usuarios'].some(k => q.has(k))) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(fs.readFileSync(path.join(__dirname, '_login.html')));
      }
      return res.status(401).json({ erro: 'Sua sessão acabou. Entre de novo.' });
    }
    const usuario = eu.nome; // é o nome que vai para o Histórico
    if (req.method === 'GET') {
      if (q.has('dados')) return res.status(200).json({ ...(await carregar()), usuario, eu: { id: eu.id, nome: eu.nome, email: eu.email, papel: eu.papel, mestra: eu.mestra } });
      if (q.has('usuarios')) return eu.papel === 'admin' ? res.status(200).json({ usuarios: await usuarios.listar() }) : res.status(403).json({ erro: 'Só administradores gerenciam usuários.' });
      const dias = [7, 30, 90].includes(Number(q.get('dias'))) ? Number(q.get('dias')) : 30;
      // filtros: só códigos simples (letras, números, ponto, traço, _); a campanha é o utm_id cadastrado (pf_ + 10 hex)
      const filtros = {};
      for (const k of ['unidade', 'botao', 'origem']) if (/^[\w.-]{1,80}$/.test(q.get(k) || '')) filtros[k] = q.get(k);
      if (q.get('campanha')) { if (!campanhas.UID.test(q.get('campanha'))) return res.status(400).json({ erro: 'Campanha inválida.' }); filtros.campanha = q.get('campanha'); }
      if (q.has('resultados')) return res.status(200).json(await resultados(dias, filtros));
      if (q.has('funil')) return res.status(200).json(await funil(dias, filtros));
      if (q.has('campanhas')) return res.status(200).json({ campanhas: await campanhas.listar(dias, siteOuNulo(req)), dias });
      if (q.has('campanha')) { const d = filtros.campanha && await campanhas.detalhe(filtros.campanha, dias, siteOuNulo(req)); return d ? res.status(200).json(d) : res.status(404).json({ erro: 'Campanha não encontrada.' }); }
      if (q.has('historico')) return res.status(200).json((await query('select ts, usuario, mudancas from alteracoes order by id desc limit 100')).rows);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(fs.readFileSync(path.join(__dirname, '_admin.html')));
    }
    if (req.method !== 'POST') return res.status(405).end();
    // O navegador manda a senha sozinho para qualquer site; este cabeçalho só existe em chamadas da nossa tela.
    if (req.headers['x-requested-with'] !== 'admin') return res.status(403).json({ erro: 'Requisição não permitida.' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    if (q.has('campanhas')) {
      let site;
      try { site = enderecoDoSite(req); } catch { return res.status(503).json({ erro: 'Configure SITE_URL (domínio público do hub) na Vercel para gerar links de campanha.' }); }
      const r = await campanhas.operar(b || {}, site);
      return res.status(r.status).json(r.corpo);
    }
    if (q.has('usuarios')) {
      const r = await usuarios.operar(req, res, eu, b || {});
      return res.status(r.status).json(r.corpo);
    }
    const v = validar(b);
    if (v.erros) return res.status(400).json({ erro: v.erros.join(' ') });
    await salvar(v, usuario);
    res.status(200).json({ ...(await carregar()), usuario, eu: { id: eu.id, nome: eu.nome, email: eu.email, papel: eu.papel, mestra: eu.mestra } });
  } catch (e) {
    console.error('admin', e.message);
    if (e.status) return res.status(e.status).json({ erro: e.message });
    res.status(500).json({ erro: 'Algo deu errado no servidor. Tente de novo em instantes.' });
  }
};

module.exports.teste = { descrever };
