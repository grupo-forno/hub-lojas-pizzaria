// Servidor SMTP de mentira, só para o teste: aceita o login e a mensagem do nodemailer e guarda o que chegou.
const net = require('net');

function servidorSmtpFalso() {
  const recebidos = [];
  const servidor = net.createServer(sock => {
    let buf = '', emDados = false, aguardaToken = false;
    const msg = { de: '', para: [], login: null, texto: '' };
    const r = t => sock.write(`${t}\r\n`);
    const lerLogin = b64 => Buffer.from(b64, 'base64').toString().split('\0').slice(1); // [usuário, senha]
    r('220 falso ESMTP');
    sock.on('data', d => {
      buf += d.toString('utf8');
      for (;;) {
        if (emDados) {
          const i = buf.indexOf('\r\n.\r\n');
          if (i < 0) return;
          msg.texto = buf.slice(0, i);
          buf = buf.slice(i + 5);
          emDados = false;
          recebidos.push({ ...msg, para: [...msg.para] });
          r('250 ok');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const linha = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = linha.toUpperCase();
        if (aguardaToken) { aguardaToken = false; msg.login = lerLogin(linha); r('235 ok'); }
        else if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-falso\r\n250 AUTH PLAIN\r\n');
        else if (cmd.startsWith('AUTH PLAIN')) {
          const token = linha.slice(11).trim();
          if (token) { msg.login = lerLogin(token); r('235 ok'); } else { aguardaToken = true; r('334 '); }
        }
        else if (cmd.startsWith('MAIL FROM')) { msg.de = linha.match(/<([^>]*)>/)?.[1]; r('250 ok'); }
        else if (cmd.startsWith('RCPT TO')) { msg.para.push(linha.match(/<([^>]*)>/)?.[1]); r('250 ok'); }
        else if (cmd === 'DATA') { emDados = true; r('354 manda'); }
        else if (cmd === 'QUIT') { r('221 tchau'); sock.end(); }
        else r('250 ok');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(ok => servidor.listen(0, '127.0.0.1', () => ok({
    porta: servidor.address().port,
    recebidos,
    parar: () => new Promise(f => servidor.close(f)),
  })));
}

module.exports = { servidorSmtpFalso };
