// npm run dev: sobe um Postgres de teste no Docker e serve a página + APIs em http://localhost:3000
// Não usa o banco de produção nem a Vercel. Ctrl+C desliga; o que você editou fica guardado no volume
// "pedeforno-dev" do Docker e volta na próxima vez. Para começar do zero: npm run dev:zerar
const { spawnSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');

const raiz = path.join(__dirname, '..');
const PORTA = process.env.PORT || 3000;
// Sempre o Postgres de teste, nunca o real. BANCO=outro_nome usa outro banco dentro dele (ex.: uma demonstração).
process.env.DATABASE_URL = `postgres://postgres:teste@localhost:54330/${/^\w+$/.test(process.env.BANCO || '') ? process.env.BANCO : 'pedeforno'}`;
const docker = (...a) => spawnSync('docker', a, { encoding: 'utf8' });

if (docker('info').status !== 0) { console.error('Docker não está aberto. Abra o Docker Desktop e rode de novo.'); process.exit(1); }
if (process.argv.includes('--zerar')) {
  docker('stop', 'pf-teste');
  docker('volume', 'rm', 'pedeforno-dev');
  console.log('Banco de teste zerado. Rode npm run dev para começar com o conteúdo inicial.');
  process.exit(0);
}
// O container some ao parar (--rm), mas os dados ficam no volume.
const run = docker('run', '-d', '--rm', '--name', 'pf-teste', '-v', 'pedeforno-dev:/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=teste', '-e', 'POSTGRES_DB=pedeforno', '-p', '54330:5432', 'postgres:17-alpine');
if (run.status !== 0) {
  // Já existe um "pf-teste" (outra janela do npm run dev, ou um teste antigo). Só seguimos se ele guarda os dados no volume:
  // um container sem volume apagaria tudo o que você editou assim que fosse desligado.
  const montagens = docker('inspect', 'pf-teste', '--format', '{{range .Mounts}}{{.Name}} {{end}}').stdout || '';
  if (!montagens.includes('pedeforno-dev')) {
    console.error('\nJá existe um banco de teste ("pf-teste") que NÃO guarda os dados em volume; ele os perderia ao ser desligado.');
    console.error('Para ver o que há nele antes de trocar: docker exec pf-teste pg_dump -U postgres pedeforno > backup.sql');
    console.error('Depois desligue e rode de novo:  docker stop pf-teste   e   npm run dev\n');
    process.exit(1);
  }
}
process.stdout.write('Aguardando o banco de teste');
for (let i = 0; i < 40 && docker('exec', 'pf-teste', 'pg_isready', '-h', 'localhost', '-U', 'postgres').status !== 0; i++) {
  process.stdout.write('.');
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
}
console.log(' pronto');
// Mostra o que ficou guardado, para a gente enxergar que a persistência está funcionando.
const guardado = docker('exec', 'pf-teste', 'psql', '-U', 'postgres', '-d', 'pedeforno', '-tAc',
  "select count(*) || ' alterações salvas; a última em ' || coalesce(to_char(max(ts) at time zone 'America/Fortaleza', 'DD/MM HH24:MI'), '-') from alteracoes").stdout?.trim();
console.log(guardado ? `Dados guardados (volume pedeforno-dev): ${guardado}` : 'Banco novo: ainda sem alterações salvas (o conteúdo inicial é criado no primeiro acesso).');

process.env.EMAIL_MODO ||= 'console'; // local: o e-mail aparece aqui no terminal, não é enviado
process.env.INSIGHTS_USER ||= 'admin'; // só no teste local; em produção valem as variáveis da Vercel
process.env.INSIGHTS_PASS ||= 'admin';
const admin = require('../api/admin.js');
const rotas = { '/api/pagina': require('../api/pagina.js'), '/api/evento': require('../api/evento.js'), '/api/admin': admin, '/admin': admin, '/api/imagem': require('../api/imagem.js'), '/api/acesso': require('../api/acesso.js') };
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' };

// ATRASO_MS=3000 npm run dev: as imagens e vídeos demoram esse tempo para chegar (simula celular com internet lenta; bom para ver a abertura).
const ATRASO = Math.min(Number(process.env.ATRASO_MS) || 0, 20000);
const eMidia = p => p === '/api/imagem' || /\.(jpe?g|png|webp|mp4|webm)$/i.test(p);

const servir = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const h = rotas[u.pathname];
  if (h) {
    let corpo = '';
    req.on('data', c => (corpo += c));
    req.on('end', () => {
      req.body = corpo || undefined;
      res.status = c => { res.statusCode = c; return res; };
      res.json = d => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(d)); };
      res.send = d => res.end(d); // mesmos atalhos que a Vercel oferece
      h(req, res);
    });
    return;
  }
  const f = path.join(raiz, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
  if (u.pathname.startsWith('/api/') || !f.startsWith(raiz) || f.startsWith(path.join(raiz, 'node_modules')) || f.includes(`${path.sep}.`)) { res.statusCode = 404; return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', tipos[path.extname(f)] || 'application/octet-stream');
    res.end(d);
  });
};
http.createServer((req, res) => (ATRASO && eMidia(new URL(req.url, 'http://x').pathname) ? setTimeout(servir, ATRASO, req, res) : servir(req, res))).listen(PORTA, () => console.log(`\nAbra: http://localhost:${PORTA}/?utm_source=instagram&utm_medium=bio\nGestão: http://localhost:${PORTA}/admin  (na tela de entrada, conta mestra: usuário ${process.env.INSIGHTS_USER} / senha ${process.env.INSIGHTS_PASS}; os e-mails de convite aparecem neste terminal)\nCtrl+C para parar.${ATRASO ? `
Conexão lenta simulada: imagens e vídeos demoram ${ATRASO} ms.` : ''}`));

const sair = () => { docker('stop', 'pf-teste'); process.exit(); };
process.on('SIGINT', sair); // Ctrl+C: desliga o banco também
process.on('SIGTERM', () => process.exit()); // recarga automática (node --watch): o banco continua ligado
