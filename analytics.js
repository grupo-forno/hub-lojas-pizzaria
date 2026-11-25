// Lógica da página pública que não depende do DOM: repasse de UTMs e eventos do GA4.
// Carregado pelo index.html (script comum) e pelo teste-analytics.js (Node).

const GA4_ID = 'G-TM7PJ4Y7N3'; // fluxo web encontrado na página pública da Tuigo
const MARCA = 'pedeforno';      // utm_content: o Resultados só conta no GA4 quem passou por esta página

// Destino do botão + UTMs. Ordem de prioridade: UTMs recebidas pelo hub > UTMs já escritas no destino > padrão (hub/direto).
// Os demais parâmetros do destino ficam como estão. `recebidas` = só o que veio na URL do hub (sem o padrão).
// `botao` (id do botão) vai em utm_term quando ninguém definiu um: o Resultados separa botão regular e promocional
// também do lado da Tuigo, sem depender do _gl.
function destinoComUtm(href, recebidas, padrao = {}, botao = '') {
  const u = new URL(href);
  for (const [k, v] of recebidas) if (k.startsWith('utm_') && v) u.searchParams.set(k, v);
  for (const [k, v] of Object.entries(padrao)) if (!u.searchParams.get(k)) u.searchParams.set(k, v);
  if (botao && !u.searchParams.get('utm_term')) u.searchParams.set('utm_term', botao);
  // Link de campanha (tem utm_id): utm_content fica como foi definido; a campanha se identifica pelo utm_id, não pela marca.
  if (!u.searchParams.get('utm_id')) {
    const conteudo = u.searchParams.get('utm_content');
    if (!(conteudo || '').split('_').includes(MARCA)) u.searchParams.set('utm_content', conteudo ? `${conteudo}_${MARCA}` : MARCA);
  }
  return u.href;
}

// Identifica o botão para o GA4. `l` = link, `bloco` = bloco que o contém, `lojas` = CONFIG.lojas.
// Botão de unidade (bloco com código de loja) leva o id fixo "<unidade>_<tipo>"; os demais levam o id do cadastro,
// então o botão promocional da mesma loja nunca se confunde com o regular.
function identificar(l, bloco, lojas = []) {
  const slugDe = s => s?.replace(/^fornopaulista/, '') || '';
  const noBloco = !!bloco?.loja;
  const unidade = l.loja || lojas.find(x => (l.url || '').includes(`/${x.slug}/`))?.slug || '';
  const nome = `${bloco?.nome || ''} ${bloco?.titulo || ''} ${l.titulo || ''}`;
  let tipo;
  if (noBloco) tipo = { pedido: 'pedido', whatsapp: 'whatsapp', mapa: 'localizacao' }[l.acao] || 'outro';
  else if (/card[aá]pio/i.test(nome) || /^cardapio\./i.test((l.url || '').replace(/^https?:\/\//, ''))) tipo = 'cardapio';
  else if (/evento/i.test(nome)) tipo = 'evento';
  else tipo = 'promocional';
  const id = noBloco ? `${slugDe(unidade) || 'geral'}_${tipo}` : [tipo, slugDe(unidade) || 'geral', l.id ?? l.acao].join('_');
  return { button_id: id, button_type: tipo, ...(unidade ? { unit_id: unidade } : {}) };
}

// GA4 com Consent Mode: nasce NEGADO (sem cookie, como diz o rodapé). Só vira "granted" se a pessoa já consentiu
// (localStorage pf_consent_analytics = "granted") ou quando a página chamar window.pfConsentimento(true).
// Sem consentimento o GA4 mede sem cookie e não decora o link com _gl.
// Se já houver gtag/GA instalado na página, reaproveita em vez de instalar outro.
function iniciarGA(id = GA4_ID) {
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) window.gtag = function () { window.dataLayer.push(arguments); };
  if (window.google_tag_manager?.[id] || window.__pfGA) return;
  window.__pfGA = true;
  let aceito = false;
  try { aceito = localStorage.getItem('pf_consent_analytics') === 'granted'; } catch {}
  const estado = ok => ({ analytics_storage: ok ? 'granted' : 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('consent', 'default', estado(aceito));
  window.pfConsentimento = ok => {
    try { localStorage.setItem('pf_consent_analytics', ok ? 'granted' : 'denied'); } catch {}
    gtag('consent', 'update', estado(ok));
  };
  gtag('js', new Date());
  // O GA4 decora sozinho os links para a Tuigo com _gl no clique; nada aqui mexe no href depois de pronto.
  gtag('config', id, { send_page_view: false, linker: { domains: ['fornopaulista.tuigoapp.com.br'] } });
  document.head.append(Object.assign(document.createElement('script'), { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` }));
}

// beacon: o evento sai mesmo que a página seja trocada logo em seguida.
const eventoGA = (nome, params = {}) => { try { window.gtag?.('event', nome, { transport_type: 'beacon', ...params }); } catch {} };

if (typeof module !== 'undefined') module.exports = { GA4_ID, MARCA, destinoComUtm, identificar, iniciarGA, eventoGA };
