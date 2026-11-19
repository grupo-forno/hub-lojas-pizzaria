// Arquivos enviados pelo admin: imagens (capa, logo, ícones) e vídeos curtos do topo.
// GET é público, fica em cache e aceita pedaços (Range): o iPhone só toca vídeo se o servidor responder assim. POST exige login.
const { query } = require('./_lib/db.js');
const { autenticar } = require('./_lib/auth.js');

// Confere os primeiros bytes: não basta o navegador dizer que é imagem ou vídeo. SVG fica de fora (pode carregar script).
const FORMATOS = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b.readUInt32BE(0) === 0x89504e47,
  'image/webp': b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'video/mp4': b => b.toString('ascii', 4, 8) === 'ftyp',
  'video/webm': b => b.readUInt32BE(0) === 0x1a45dfa3,
};
const MAX_IMAGEM = 3 * 1024 * 1024;
// ponytail: o envio passa por uma função da Vercel (limite de 4,5 MB por requisição, e o base64 engorda 1/3), então vídeo vai até ~3 MB.
// Vídeo maior: colar o link de um arquivo hospedado em outro lugar, ou ligar o Vercel Blob.
const MAX_VIDEO = 3_100_000;

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
      if (!Number.isInteger(id) || id < 1) return res.status(404).end();
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable'); // cada envio ganha um id novo
      const pedido = req.headers.range;
      if (!pedido) {
        const r = await query('select tipo, dados from imagens where id = $1', [id]);
        if (!r.rowCount) return res.status(404).end();
        res.setHeader('Content-Type', r.rows[0].tipo);
        return res.status(200).end(r.rows[0].dados);
      }
      const meta = (await query('select tipo, length(dados)::int as n from imagens where id = $1', [id])).rows[0];
      if (!meta) return res.status(404).end();
      const m = /^bytes=(\d*)-(\d*)$/.exec(pedido);
      let ini = 0, fim = meta.n - 1;
      if (m && m[1] !== '') { ini = Number(m[1]); fim = m[2] === '' ? meta.n - 1 : Math.min(Number(m[2]), meta.n - 1); }
      else if (m && m[2] !== '') ini = Math.max(0, meta.n - Number(m[2])); // "últimos N bytes"
      else ini = fim + 1; // pedido que não entendemos: tratado como fora do arquivo
      if (ini > fim || ini >= meta.n) { res.setHeader('Content-Range', `bytes */${meta.n}`); return res.status(416).end(); }
      const pedaco = (await query('select substring(dados from $2::int for $3::int) as p from imagens where id = $1', [id, ini + 1, fim - ini + 1])).rows[0].p;
      res.setHeader('Content-Type', meta.tipo);
      res.setHeader('Content-Range', `bytes ${ini}-${fim}/${meta.n}`);
      res.setHeader('Content-Length', String(pedaco.length));
      return res.status(206).end(pedaco);
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await autenticar(req))) return res.status(401).json({ erro: 'Sua sessão acabou. Entre de novo.' });
    if (req.headers['x-requested-with'] !== 'admin') return res.status(403).json({ erro: 'Requisição não permitida.' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    const video = typeof b?.tipo === 'string' && b.tipo.startsWith('video/');
    const limite = video ? MAX_VIDEO : MAX_IMAGEM;
    const texto = typeof b?.dados === 'string' ? b.dados : '';
    if (texto.length > Math.ceil(limite / 3) * 4 + 8) return res.status(413).json({ erro: video ? 'Vídeo grande demais (máximo 3 MB). Comprima o vídeo ou cole o link de um arquivo hospedado.' : 'Imagem muito grande (máximo 3 MB).' });
    const dados = Buffer.from(texto, 'base64');
    if (dados.length > limite) return res.status(413).json({ erro: video ? 'Vídeo grande demais (máximo 3 MB). Comprima o vídeo ou cole o link de um arquivo hospedado.' : 'Imagem muito grande (máximo 3 MB).' });
    if (dados.length < 12 || !FORMATOS[b.tipo]?.(dados)) return res.status(400).json({ erro: video ? 'Use um vídeo MP4 ou WebM.' : 'Use uma imagem JPG, PNG ou WebP.' });
    const r = await query('insert into imagens (tipo, dados) values ($1, $2) returning id', [b.tipo, dados]);
    res.status(200).json({ url: `/api/imagem?id=${r.rows[0].id}` });
  } catch (e) {
    console.error('imagem', e.message);
    res.status(500).json({ erro: 'Não foi possível enviar o arquivo agora.' });
  }
};
