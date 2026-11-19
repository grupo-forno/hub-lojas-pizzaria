// Senhas e tokens. Senha: scrypt com sal próprio (nunca guardamos a senha). Token: aleatório; no banco só vai o resumo (SHA-256).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const MIN = 8;
const MAX = 200;

async function criarHash(senha) {
  const sal = crypto.randomBytes(16);
  return `s1$${sal.toString('base64')}$${(await scrypt(senha, sal, 64)).toString('base64')}`;
}

// Mesmo gasto de tempo quando o usuário não existe, para não revelar quais e-mails estão cadastrados.
const FALSO = criarHash('senha-falsa-para-igualar-o-tempo');

async function conferir(senha, guardado) {
  const [versao, sal, esperado] = String(guardado || (await FALSO)).split('$');
  if (versao !== 's1' || !sal || !esperado) return false;
  const obtido = await scrypt(String(senha), Buffer.from(sal, 'base64'), 64);
  const certo = Buffer.from(esperado, 'base64');
  return obtido.length === certo.length && crypto.timingSafeEqual(obtido, certo) && !!guardado;
}

// Regra de senha: tamanho mínimo e uma lista curta do que é fácil demais (a verificação de verdade é o tamanho).
const FRACAS = ['12345678', '123456789', '1234567890', 'password', 'senha123', 'qwertyui', '11111111', 'abcd1234', 'fornopaulista'];
function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < MIN) return `A senha precisa ter pelo menos ${MIN} caracteres.`;
  if (senha.length > MAX) return 'A senha é longa demais.';
  if (FRACAS.includes(senha.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  return null;
}

const novoToken = () => crypto.randomBytes(32).toString('base64url');
const resumo = t => crypto.createHash('sha256').update(String(t)).digest('hex');

module.exports = { criarHash, conferir, validarSenha, novoToken, resumo };
