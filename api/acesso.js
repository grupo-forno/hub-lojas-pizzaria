// Entrar, sair e trocar a senha por e-mail. Aberto ao público (é a porta de entrada), por isso tudo aqui tem limite de tentativas.
const { query } = require('./_lib/db.js');
const { abrirSessao, fecharSessao, conferirMestra } = require('./_lib/auth.js');
const { conferir, criarHash, validarSenha, resumo } = require('./_lib/senha.js');
const { ipDe, atingiuLimite, registrar, enviarLink } = require('./_lib/contas.js');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normal = e => String(e || '').trim().toLowerCase().slice(0, 200);
// A mesma resposta exista o e-mail ou não: assim ninguém descobre quem tem conta.
const RESPOSTA_ESQUECI = { ok: true, mensagem: 'Se esse e-mail estiver cadastrado, enviamos um link para trocar a senha. Confira também a caixa de spam.' };
const LINK_RUIM = 'Este link venceu ou já foi usado. Peça um novo na tela de entrada ("Esqueci minha senha").';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    if (req.method === 'GET') { // a tela de "escolher senha" pergunta se o link ainda vale
      const t = new URL(req.url, 'http://x').searchParams.get('token') || '';
      const r = await query(`select r.tipo, u.nome from redefinicoes r join usuarios u on u.id = r.usuario_id
        where r.hash = $1 and not r.usado and r.expira > now() and u.ativo`, [resumo(t)]);
      if (!r.rowCount) return res.status(404).json({ erro: LINK_RUIM });
      return res.status(200).json(r.rows[0]);
    }
    if (req.method !== 'POST') return res.status(405).end();
    // Só a nossa tela manda este cabeçalho; um site de fora não consegue (o navegador bloquearia).
    if (req.headers['x-requested-with'] !== 'admin') return res.status(403).json({ erro: 'Requisição não permitida.' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
    if (!b || typeof b !== 'object') return res.status(400).json({ erro: 'Pedido inválido.' });
    const ip = ipDe(req);

    if (b.acao === 'entrar') {
      const identificador = normal(b.email);
      if (!identificador || typeof b.senha !== 'string') return res.status(400).json({ erro: 'Digite o e-mail e a senha.' });
      if (await atingiuLimite(`login:${identificador}`, 8, 15) || await atingiuLimite(`login-ip:${ip}`, 30, 15)) {
        return res.status(429).json({ erro: 'Muitas tentativas seguidas. Espere uns minutos e tente de novo.' });
      }
      if (conferirMestra(String(b.email).trim(), b.senha)) { // conta mestra de emergência (INSIGHTS_USER)
        await abrirSessao(req, res, { mestra: true });
        return res.status(200).json({ ok: true, nome: 'Conta mestra' });
      }
      const u = (await query('select id, nome, senha, ativo from usuarios where email = $1', [identificador])).rows[0];
      const certa = await conferir(b.senha, u?.senha); // gasta o mesmo tempo mesmo sem usuário
      if (!u || !certa || !u.ativo) {
        await registrar(`login:${identificador}`);
        await registrar(`login-ip:${ip}`);
        return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
      }
      await query('update usuarios set ultimo_acesso = now() where id = $1', [u.id]);
      await abrirSessao(req, res, { usuarioId: u.id });
      return res.status(200).json({ ok: true, nome: u.nome });
    }

    if (b.acao === 'sair') {
      await fecharSessao(req, res);
      return res.status(200).json({ ok: true });
    }

    if (b.acao === 'esqueci') {
      const email = normal(b.email);
      if (!EMAIL.test(email)) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
      // Passou do limite? Responde igual e não envia (ninguém é bombardeado de e-mails e nada é revelado).
      if (await atingiuLimite(`esqueci:${email}`, 3, 60) || await atingiuLimite(`esqueci-ip:${ip}`, 10, 60)) return res.status(200).json(RESPOSTA_ESQUECI);
      await registrar(`esqueci:${email}`);
      await registrar(`esqueci-ip:${ip}`);
      const u = (await query('select id, nome, email, ativo from usuarios where email = $1', [email])).rows[0];
      // ponytail: o tempo do envio pode denunciar um e-mail cadastrado; aceitável para uma equipe pequena (limite acima).
      if (u?.ativo) { try { await enviarLink(req, u, 'redefinir'); } catch (e) { console.error('esqueci', e.message); } }
      return res.status(200).json(RESPOSTA_ESQUECI);
    }

    if (b.acao === 'redefinir') {
      const erroSenha = validarSenha(b.senha);
      if (erroSenha) return res.status(400).json({ erro: erroSenha });
      // O link é gasto no mesmo comando que o confere: duas tentativas ao mesmo tempo não passam as duas.
      const r = await query(`update redefinicoes set usado = true where hash = $1 and not usado and expira > now() returning usuario_id`, [resumo(b.token || '')]);
      if (!r.rowCount) return res.status(400).json({ erro: LINK_RUIM });
      const id = r.rows[0].usuario_id;
      const ok = await query('update usuarios set senha = $2 where id = $1 and ativo returning id', [id, await criarHash(b.senha)]);
      if (!ok.rowCount) return res.status(400).json({ erro: LINK_RUIM });
      await query('delete from sessoes where usuario_id = $1', [id]); // trocou a senha: todo mundo logado com a antiga sai
      await query('delete from redefinicoes where usuario_id = $1', [id]);
      return res.status(200).json({ ok: true });
    }
    res.status(400).json({ erro: 'Pedido inválido.' });
  } catch (e) {
    console.error('acesso', e.message);
    res.status(500).json({ erro: 'Algo deu errado no servidor. Tente de novo em instantes.' });
  }
};
