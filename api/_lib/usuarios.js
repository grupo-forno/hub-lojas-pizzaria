// Tela "Usuários" do admin: cadastrar pessoas, mudar nível, desativar, reenviar convite e trocar a própria senha.
// Cada operação devolve { status, corpo }. Só administrador mexe nos outros; qualquer usuário troca a própria senha.
const { query } = require('./db.js');
const { conferir, criarHash, validarSenha } = require('./senha.js');
const { abrirSessao } = require('./auth.js');
const { enviarLink } = require('./contas.js');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAPEIS = ['admin', 'editor'];
const erro = (status, mensagem) => ({ status, corpo: { erro: mensagem } });

async function listar() {
  return (await query(`select id, nome, email, papel, ativo, criado, ultimo_acesso, (senha is null) as convite_pendente from usuarios order by lower(nome)`)).rows;
}
const resposta = async extra => ({ status: 200, corpo: { usuarios: await listar(), ...extra } });

// Sempre deve sobrar pelo menos um administrador ativo (fora a conta mestra).
async function eUltimoAdmin(id) {
  const r = await query(`select count(*)::int n from usuarios where papel = 'admin' and ativo and id <> $1`, [id]);
  return r.rows[0].n === 0;
}

async function operar(req, res, eu, b) {
  if (b.op === 'minha_senha') { // qualquer pessoa troca a própria senha (sabendo a atual)
    if (eu.mestra) return erro(400, 'A conta mestra troca a senha na Vercel (INSIGHTS_PASS).');
    const u = (await query('select senha from usuarios where id = $1', [eu.id])).rows[0];
    if (!(await conferir(b.atual, u?.senha))) return erro(400, 'A senha atual não confere.');
    const ruim = validarSenha(b.nova);
    if (ruim) return erro(400, ruim);
    await query('update usuarios set senha = $2 where id = $1', [eu.id, await criarHash(b.nova)]);
    await query('delete from sessoes where usuario_id = $1', [eu.id]); // sai de todos os outros aparelhos
    await abrirSessao(req, res, { usuarioId: eu.id }); // e continua logada neste
    return { status: 200, corpo: { ok: true } };
  }

  if (eu.papel !== 'admin') return erro(403, 'Só administradores gerenciam usuários.');
  if (b.op === 'listar') return resposta();

  const nome = typeof b.nome === 'string' ? b.nome.trim().slice(0, 80) : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase().slice(0, 200) : '';
  const alvo = Number.isInteger(b.id) ? (await query('select id, nome, email, papel, ativo, (senha is null) as pendente from usuarios where id = $1', [b.id])).rows[0] : null;

  if (b.op === 'criar') {
    if (!nome) return erro(400, 'Digite o nome da pessoa.');
    if (!EMAIL.test(email)) return erro(400, 'Digite um e-mail válido.');
    if (!PAPEIS.includes(b.papel)) return erro(400, 'Escolha o nível de acesso.');
    let novo;
    try {
      novo = (await query('insert into usuarios (nome, email, papel) values ($1, $2, $3) returning id, nome, email', [nome, email, b.papel])).rows[0];
    } catch (e) {
      if (e.code === '23505') return erro(400, 'Esse e-mail já está cadastrado.');
      throw e;
    }
    try {
      await enviarLink(req, novo, 'convite', eu.nome);
      return resposta({ aviso: `Convite enviado para ${email}. A pessoa escolhe a própria senha pelo link.` });
    } catch (e) {
      console.error('convite', e.message);
      return resposta({ aviso: 'A pessoa foi cadastrada, mas não deu para enviar o e-mail agora. Use "Reenviar convite" quando o envio estiver funcionando.', problema: true });
    }
  }

  if (!alvo) return erro(404, 'Usuário não encontrado.');

  if (b.op === 'editar') {
    if (!nome) return erro(400, 'O nome não pode ficar vazio.');
    if (!PAPEIS.includes(b.papel)) return erro(400, 'Nível de acesso inválido.');
    const ativo = b.ativo !== false;
    const mudaAcesso = alvo.papel !== b.papel || alvo.ativo !== ativo;
    if (mudaAcesso && alvo.id === eu.id) return erro(400, 'Você não pode mudar o seu próprio nível nem se desativar.');
    if (mudaAcesso && alvo.papel === 'admin' && alvo.ativo && (b.papel !== 'admin' || !ativo) && await eUltimoAdmin(alvo.id)) return erro(400, 'Precisa sobrar pelo menos um administrador ativo.');
    await query('update usuarios set nome = $2, papel = $3, ativo = $4 where id = $1', [alvo.id, nome, b.papel, ativo]);
    if (!ativo) await query('delete from sessoes where usuario_id = $1', [alvo.id]); // desativou: sai na hora
    return resposta();
  }

  if (b.op === 'reenviar') {
    if (!alvo.ativo) return erro(400, 'Reative o usuário antes de enviar o link.');
    try {
      await enviarLink(req, alvo, alvo.pendente ? 'convite' : 'redefinir', eu.nome);
    } catch (e) {
      console.error('reenviar', e.message);
      return erro(502, 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.');
    }
    return resposta({ aviso: alvo.pendente ? `Convite reenviado para ${alvo.email}.` : `Enviamos para ${alvo.email} um link para trocar a senha.` });
  }

  if (b.op === 'remover') {
    if (alvo.id === eu.id) return erro(400, 'Você não pode remover a si mesma.');
    if (alvo.papel === 'admin' && alvo.ativo && await eUltimoAdmin(alvo.id)) return erro(400, 'Precisa sobrar pelo menos um administrador ativo.');
    await query('delete from usuarios where id = $1', [alvo.id]); // sessões e links vão junto (cascade)
    return resposta();
  }
  return erro(400, 'Pedido inválido.');
}

module.exports = { operar, listar };
