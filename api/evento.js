// Registra visita, abertura de unidade e clique. Sem cookie, sem IP, sem identificar pessoa.
const { query } = require('./_lib/db.js');

const TIPOS = ['view', 'abrir', 'click'];
const texto = s => (typeof s === 'string' && /^[\w.-]{1,60}$/.test(s) ? s : null);
const BOT = /bot|crawl|spider|preview|facebookexternalhit|slurp|headless/i;
// Só o tipo de aparelho (deduzido do navegador); nada que identifique a pessoa.
const aparelho = ua => (/ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'celular' : 'computador');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (BOT.test(req.headers['user-agent'] || '')) return res.status(204).end(); // prévia de link não é visita
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } } // sendBeacon manda texto
  if (!b || !TIPOS.includes(b.tipo)) return res.status(400).end();
  const linkId = Number.isInteger(b.link_id) && b.link_id > 0 ? b.link_id : null;
  try {
    await query(
      'insert into eventos (tipo, link_id, loja, acao, origem, meio, campanha, dispositivo) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [b.tipo, linkId, texto(b.loja), texto(b.acao), texto(b.origem), texto(b.meio), texto(b.campanha), aparelho(req.headers['user-agent'] || '')],
    );
    res.status(204).end();
  } catch (e) {
    console.error('evento', e.message);
    res.status(204).end(); // quem navega não precisa saber que o registro falhou
  }
};
