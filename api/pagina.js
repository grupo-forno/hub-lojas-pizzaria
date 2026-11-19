// Conteúdo público da página: configuração + links ativos já agrupados (unidade -> ações).
const { query, arvore } = require('./_lib/db.js');

module.exports = async (req, res) => {
  try {
    const [config, links] = await Promise.all([
      query('select chave, valor from config'),
      query('select id, pai, tipo, nome, acao, titulo, subtitulo, url, loja, utm, icone, opcoes from links where ativo order by ordem, id'),
    ]);
    // Cache de 1 minuto na Vercel: o banco não leva um acesso por visita. A prévia do admin não usa cache.
    const previa = new URL(req.url, 'http://x').searchParams.has('previa');
    res.setHeader('Cache-Control', previa ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      config: Object.fromEntries(config.rows.map(r => [r.chave, r.valor])),
      links: arvore(links.rows),
    });
  } catch (e) {
    console.error('pagina', e.message);
    res.status(503).json({ erro: 'indisponivel' }); // a página usa a lista de reserva (lojas.js)
  }
};
