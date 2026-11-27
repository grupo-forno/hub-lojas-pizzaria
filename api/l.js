// Link curto: /l/codigo -> página com todos os UTMs e o utm_id da campanha (o visitante cai no mesmo link completo de sempre).
const { query } = require('./_lib/db.js');
const { CODIGO } = require('./_lib/campanhas.js');

module.exports = async (req, res) => {
  const codigo = String(new URL(req.url, 'http://x').searchParams.get('codigo') || '').toLowerCase();
  try {
    const r = CODIGO.test(codigo) ? await query('select link from campanhas where codigo = $1', [codigo]) : { rowCount: 0 };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.writeHead(302, { Location: r.rowCount ? r.rows[0].link : '/' }); // código desconhecido: vai para a página inicial
    res.end();
  } catch (e) {
    console.error('l', e.message);
    res.writeHead(302, { Location: '/' }).end(); // banco fora do ar: a página abre, só sem o rastreio da campanha
  }
};
