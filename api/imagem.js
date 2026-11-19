// Imagens enviadas pelo admin (capa, logo, ícones). GET é público e fica em cache; POST exige login.
const { query } = require('./_lib/db.js');
const { autenticar } = require('./_lib/auth.js');

// Confere os primeiros bytes: não basta o navegador dizer que é imagem. SVG fica de fora (pode carregar script).
const FORMATOS = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b.readUInt32BE(0) === 0x89504e47,
  'image/webp': b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
const MAXIMO = 3 * 1024 * 1024;

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
      if (!Number.isInteger(id) || id < 1) return res.status(404).end();
      const r = await query('select tipo, dados from imagens where id = $1', [id]);
      if (!r.rowCount) return res.status(404).end();
      res.setHeader('Content-Type', r.rows[0].tipo);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // cada envio ganha um id novo
      return res.status(200).end(r.rows[0].dados);
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await autenticar(req))) return res.status(401).json({ erro: 'Sua sessão acabou. Entre de novo.' });
    if (req.headers['x-requested-with'] !== 'admin') return res.status(403).json({ erro: 'Requisição não permitida.' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    const dados = Buffer.from(typeof b?.dados === 'string' ? b.dados : '', 'base64');
    if (dados.length > MAXIMO) return res.status(413).json({ erro: 'Imagem muito grande (máximo 3 MB).' });
    if (dados.length < 12 || !FORMATOS[b.tipo]?.(dados)) return res.status(400).json({ erro: 'Use uma imagem JPG, PNG ou WebP.' });
    const r = await query('insert into imagens (tipo, dados) values ($1, $2) returning id', [b.tipo, dados]);
    res.status(200).json({ url: `/api/imagem?id=${r.rows[0].id}` });
  } catch (e) {
    console.error('imagem', e.message);
    res.status(500).json({ erro: 'Não foi possível enviar a imagem agora.' });
  }
};
