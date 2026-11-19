// Quem está acessando o admin? Duas formas de entrar:
//  1) conta de usuário (e-mail + senha, cadastrada na tela Usuários): fica uma sessão por cookie;
//  2) conta mestra de emergência: INSIGHTS_USER/INSIGHTS_PASS (as mesmas do /insights), também pelo formulário de entrada.
// A senha "do navegador" (Basic) NÃO vale aqui: o navegador guarda e reenvia essa senha sozinho em todas as páginas do site,
// o que impediria o "Sair" e entraria sem passar pela tela de entrada.
// autenticar() devolve { id, nome, email, papel, mestra } ou null.
const crypto = require('crypto');
const { query } = require('./db.js');
const { resumo, novoToken } = require('./senha.js');

const MESTRA = { id: null, nome: 'Conta mestra', email: null, papel: 'admin', mestra: true };
const COOKIE = 'pf_sessao';
const DIAS = 14;

const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';')
  .map(c => { const i = c.indexOf('='); return [c.slice(0, i).trim(), c.slice(i + 1).trim()]; }).filter(([k]) => k));

const conferirMestraConfigurada = () => !!(process.env.INSIGHTS_USER && process.env.INSIGHTS_PASS); // sem as variáveis, a conta mestra não existe

function iguais(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Confere usuário/senha da conta mestra (formulário de entrada).
function conferirMestra(usuario, senha) {
  const { INSIGHTS_USER: u, INSIGHTS_PASS: p } = process.env;
  return !!(u && p) && iguais(`${usuario}:${senha}`, `${u}:${p}`);
}

// Resumo do usuário+senha mestres de agora. Quem entrou com a senha antiga cai assim que ela é trocada na Vercel.
const impressaoMestra = () => resumo(`${process.env.INSIGHTS_USER}:${process.env.INSIGHTS_PASS}`);

async function autenticar(req) {
  const t = cookies(req)[COOKIE];
  if (t) {
    const r = await query(`select s.mestra, s.impressao, u.id, u.nome, u.email, u.papel, u.ativo
      from sessoes s left join usuarios u on u.id = s.usuario_id where s.hash = $1 and s.expira > now()`, [resumo(t)]);
    const x = r.rows[0];
    if (x?.mestra) return x.impressao === impressaoMestra() && conferirMestraConfigurada() ? MESTRA : null;
    if (x?.ativo) return { id: x.id, nome: x.nome, email: x.email, papel: x.papel, mestra: false };
  }
  return null;
}

async function abrirSessao(req, res, { usuarioId = null, mestra = false } = {}) {
  const token = novoToken();
  await query('delete from sessoes where expira < now()'); // limpeza de sessões vencidas
  await query(`insert into sessoes (hash, usuario_id, mestra, impressao, expira) values ($1, $2, $3, $4, now() + ($5::int * interval '1 day'))`, [resumo(token), usuarioId, mestra, mestra ? impressaoMestra() : null, DIAS]);
  const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DIAS * 86400}${seguro}`);
}

async function fecharSessao(req, res) {
  const t = cookies(req)[COOKIE];
  if (t) await query('delete from sessoes where hash = $1', [resumo(t)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

module.exports = { autenticar, abrirSessao, fecharSessao, conferirMestra, MESTRA };
