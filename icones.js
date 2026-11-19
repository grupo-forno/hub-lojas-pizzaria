// Ícones da página e do admin (desenho de traço numa grade 24x24). Para um ícone novo, acrescente aqui.
const ICONES = {
  pedido: ['Caixa de pizza', '<path d="M3 8l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 16l9 4 9-4"/>'],
  cardapio: ['Cardápio', '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5zM5 20.5V4.5M9 7h6M9 11h6"/>'],
  whatsapp: ['WhatsApp', '<path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 8 19.4L3 21z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.5-1.8-1.3-2.3-2.3l.8-1-1-2L9 8.5z"/>'],
  instagram: ['Instagram', '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".9" fill="currentColor" stroke="none"/>'],
  facebook: ['Facebook', '<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6v4h3v7h4v-7h3l.5-4H13V7a1 1 0 0 1 1-1h2z"/>'],
  youtube: ['YouTube', '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>'],
  tiktok: ['TikTok', '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.4 4.6 5 5"/>'],
  mapa: ['Localização', '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'],
  telefone: ['Telefone', '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'],
  email: ['E-mail', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'],
  site: ['Site', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'],
  evento: ['Evento', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  presente: ['Presente', '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8C10 8 8 7 8 5.5S10 3.5 12 8zM12 8c2 0 4-1 4-2.5S14 3.5 12 8z"/>'],
  estrela: ['Estrela', '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'],
  carrinho: ['Carrinho', '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12h11.6L21 7H6"/>'],
};
// Redes que podem aparecer como ícone no topo da página.
const REDES = ['instagram', 'facebook', 'whatsapp', 'youtube', 'tiktok', 'email', 'telefone', 'site'];

function iconeSvg(chave, tamanho = 24, traco = 1.5) {
  const i = ICONES[chave];
  return i ? `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i[1]}</svg>` : '';
}

if (typeof module !== 'undefined') module.exports = { ICONES, REDES };
