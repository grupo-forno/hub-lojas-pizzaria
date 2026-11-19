// Peças compartilhadas do acesso por e-mail: limite de tentativas e os links de convite / nova senha.
const { query } = require('./db.js');
const { novoToken, resumo } = require('./senha.js');
const { enviar, enderecoDoSite } = require('./email.js');

const ipDe = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();

// Limite contra tentativa em massa: `chave` já teve `max` registros nos últimos `minutos`?
async function atingiuLimite(chave, max, minutos) {
  const r = await query(`select count(*)::int n from tentativas where chave = $1 and ts > now() - ($2::int * interval '1 minute')`, [chave, minutos]);
  return r.rows[0].n >= max;
}
async function registrar(chave) {
  await query('insert into tentativas (chave) values ($1)', [chave]);
  if (Math.random() < 0.02) query(`delete from tentativas where ts < now() - interval '1 day'`).catch(() => {});
}

const VALIDADE = { convite: 72, redefinir: 1 }; // horas

// Cria o link (token de uso único), invalida os anteriores da mesma pessoa e manda o e-mail.
async function enviarLink(req, usuario, tipo, quem) {
  const token = novoToken();
  await query('delete from redefinicoes where usuario_id = $1 and not usado', [usuario.id]);
  await query(`insert into redefinicoes (hash, usuario_id, tipo, expira) values ($1, $2, $3, now() + ($4::int * interval '1 hour'))`, [resumo(token), usuario.id, tipo, VALIDADE[tipo]]);
  const link = `${enderecoDoSite(req)}/admin?redefinir=${token}`;
  const convite = tipo === 'convite';
  await enviar({
    para: usuario.email,
    assunto: convite ? 'Seu acesso à gestão do Pede Forno' : 'Troque a sua senha do Pede Forno',
    texto: convite
      ? `Olá, ${usuario.nome}!\n\n${quem} deu a você acesso à gestão da página Pede Forno. Clique no botão para escolher a sua senha. O link vale ${VALIDADE.convite} horas e só funciona uma vez.`
      : `Olá, ${usuario.nome}!\n\nRecebemos um pedido para trocar a senha da sua conta. Clique no botão para escolher uma nova. O link vale 1 hora e só funciona uma vez.\n\nSe não foi você, ignore este e-mail: a sua senha continua a mesma.`,
    botao: convite ? 'Escolher minha senha' : 'Trocar minha senha',
    link,
  });
}

module.exports = { ipDe, atingiuLimite, registrar, enviarLink };
