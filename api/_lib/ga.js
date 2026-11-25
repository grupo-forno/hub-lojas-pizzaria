// Google Analytics 4 (Data API) do site de pedidos, com a conta de serviço.
// Mesmas variáveis do /insights na Vercel: GOOGLE_SA_EMAIL, GOOGLE_SA_KEY, GA4_PROPERTY_ID.
// ponytail: o token repete o de api/insights.js; juntar quando o /insights virar uma aba do admin.
const crypto = require('crypto');

const env = process.env;
let guardado; // o token vale 1 h; reaproveita enquanto a função estiver quente

const configurado = () => !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY && env.GA4_PROPERTY_ID);

async function token() {
  if (guardado && guardado.ate > Date.now()) return guardado.valor;
  const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: env.GOOGLE_SA_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    iat: agora,
    exp: agora + 3600,
  })}`;
  const assinatura = crypto.sign('RSA-SHA256', Buffer.from(corpo), env.GOOGLE_SA_KEY.replace(/\\n/g, '\n')).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${corpo}.${assinatura}` }),
  });
  if (!r.ok) throw new Error(`Google token: ${r.status} ${await r.text()}`);
  guardado = { valor: (await r.json()).access_token, ate: Date.now() + 50 * 60e3 };
  return guardado.valor;
}

async function chamar(versao, metodo, corpo) {
  const r = await fetch(`https://analyticsdata.googleapis.com/${versao}/properties/${env.GA4_PROPERTY_ID}:${metodo}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`GA4: ${r.status} ${await r.text()}`);
  return r.json();
}

const relatorio = corpo => chamar('v1beta', 'runReport', corpo);
// Funil por sequência de eventos do mesmo usuário (API alfa do GA4: o formato pode mudar).
const funil = corpo => chamar('v1alpha', 'runFunnelReport', corpo);

module.exports = { configurado, relatorio, funil };
