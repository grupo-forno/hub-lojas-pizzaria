// Envio de e-mail direto por SMTP (Google Workspace). Variáveis na Vercel:
//   SMTP_USER  a caixa que envia (ex.: acesso@grupofornopaulista.com)
//   SMTP_PASS  a "senha de app" de 16 letras dessa conta (não é a senha normal)
//   SITE_URL   https://pedeforno.grupofornopaulista.com  (o link do e-mail nasce daqui)
//   opcionais: SMTP_FROM ("Pede Forno <acesso@...>"), SMTP_HOST (padrão smtp.gmail.com), SMTP_PORT (padrão 465)
// Local (npm run dev): EMAIL_MODO=console mostra o e-mail no terminal em vez de enviar.
const nodemailer = require('nodemailer');

const caixaDeTestes = []; // só no modo console: os testes leem o link daqui

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

async function enviar({ para, assunto, texto, botao, link }) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1D1D1F">
<p style="white-space:pre-line">${esc(texto)}</p>
<p style="margin:28px 0"><a href="${esc(link)}" style="background:#581512;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px;display:inline-block">${esc(botao)}</a></p>
<p style="font-size:12px;color:#6B6B70">Se o botão não funcionar, copie este endereço no navegador:<br>${esc(link)}</p></div>`;
  const corpo = `${texto}\n\n${botao}: ${link}`;

  if (process.env.EMAIL_MODO === 'console' || process.env.EMAIL_MODO === 'teste') { // 'teste' = igual, sem escrever no terminal
    caixaDeTestes.push({ para, assunto, link });
    if (process.env.EMAIL_MODO === 'console') console.log(`\n[e-mail simulado] Para: ${para}\nAssunto: ${assunto}\n${corpo}\n`);
    return;
  }
  const { SMTP_USER: usuario, SMTP_PASS: senha, SMTP_FROM: de, SMTP_HOST: host = 'smtp.gmail.com' } = process.env;
  if (!usuario || !senha) throw new Error('envio de e-mail não configurado (SMTP_USER e SMTP_PASS)');
  const porta = Number(process.env.SMTP_PORT || 465);
  const local = process.env.SMTP_INSEGURO === '1'; // só nos testes (servidor falso na própria máquina, sem criptografia)
  const transporte = nodemailer.createTransport({
    host, port: porta, secure: porta === 465, // 465 = conexão já criptografada; 587 = começa e sobe para TLS
    requireTLS: !local && porta !== 465, ignoreTLS: local,
    auth: { user: usuario, pass: senha.replace(/\s/g, '') }, // o Google mostra a senha de app com espaços; tira
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  try {
    await transporte.sendMail({ from: de || `Pede Forno <${usuario}>`, to: para, subject: assunto, text: corpo, html, textEncoding: 'quoted-printable' });
  } finally { transporte.close(); }
}

// Endereço do site para montar o link. Em produção vem de SITE_URL (nunca do cabeçalho Host, que um atacante pode forjar
// para fazer o e-mail apontar para outro site).
function enderecoDoSite(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  if (!process.env.VERCEL) return `http://${req.headers.host || 'localhost:3000'}`;
  throw new Error('SITE_URL não configurado');
}

module.exports = { enviar, enderecoDoSite, caixaDeTestes };
