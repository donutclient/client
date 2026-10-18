const express = require('express');
const SftpClient = require('ssh2-sftp-client');
const crypto = require('crypto');
const path = require('path');

// Defaults are filled in below. Environment variables in Vercel override them if you set any.
const E = Object.assign({
  SFTP_HOST: 'na1.eternalzero.cloud',
  SFTP_PORT: '2022',
  SFTP_USER: 'qutel_fdco.350b868c',
  SFTP_PASS: '2I1wN4okB8ceuT8L',
  PANEL_PASSWORD: 'qutel'
}, process.env);
const root = E.SERVER_ROOT || '/';
const logPath = E.LOG_PATH || 'logs/latest.log';
const cmds = { start: E.CMD_START, stop: E.CMD_STOP, restart: E.CMD_RESTART, send: E.CMD_SEND };
const token = () => crypto.createHmac('sha256', E.PANEL_PASSWORD || '').update('mc-panel').digest('hex');

const app = express();
const safe = p => path.posix.join(root, path.posix.normalize('/' + (p || '')));

// ---- auth ----
const getBody = req => new Promise((ok, no) => {
  if (req.body !== undefined) return ok(Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)));
  const ch = []; req.on('data', d => ch.push(d)).on('end', () => ok(Buffer.concat(ch))).on('error', no);
});
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
app.use((req, res, next) => {
  // Login: any POST carrying an x-password header
  if (req.method === 'POST' && req.headers['x-password'] !== undefined) {
    let pw = ''; try { pw = decodeURIComponent(req.headers['x-password']); } catch (e) {}
    if (E.PANEL_PASSWORD && crypto.timingSafeEqual(sha(pw), sha(E.PANEL_PASSWORD))) return res.json({ token: token() });
    return res.status(401).json({ error: 'Wrong password' });
  }
  const url = (req.originalUrl || req.url).split('?')[0];
  if (!url.startsWith('/api/')) return next();
  const t = String(req.headers['x-token'] || '');
  const ok = t.length === token().length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token()));
  ok ? next() : res.status(401).json({ error: 'Not signed in' });
});

// ---- sftp helpers ----
async function withSftp(fn) {
  const c = new SftpClient();
  try {
    await c.connect({
      host: E.SFTP_HOST, port: Number(E.SFTP_PORT) || 22, username: E.SFTP_USER,
      password: E.SFTP_PASS || undefined,
      privateKey: E.SFTP_KEY ? E.SFTP_KEY.replace(/\\n/g, '\n') : undefined,
      readyTimeout: 15000
    });
    return await fn(c);
  } finally { await c.end().catch(() => {}); }
}
const json = fn => async (req, res) => {
  try { res.json(await withSftp(c => fn(c, req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
const run = (c, cmd) => new Promise((ok, no) => c.client.exec(cmd, (err, s) => {
  if (err) return no(err);
  let out = ''; s.on('data', d => out += d).stderr.on('data', d => out += d); s.on('close', () => ok(out));
}));

// ---- api ----
app.get('/api/info', (req, res) => res.json({
  host: E.SFTP_HOST, root, power: !!(cmds.start || cmds.stop || cmds.restart), send: !!cmds.send
}));
app.get('/api/list', json(async (c, req) => (await c.list(safe(req.query.path)))
  .map(i => ({ name: i.name, dir: i.type === 'd', size: i.size }))
  .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name))));
app.get('/api/read', json(async (c, req) => {
  const p = safe(req.query.path);
  if ((await c.stat(p)).size > 2 * 1024 * 1024) throw new Error('File is over 2 MB. Download it instead.');
  return { content: (await c.get(p)).toString('utf8') };
}));
const put = json(async (c, req) => { await c.put(await getBody(req), safe(req.query.path)); return { ok: true }; });
app.post('/api/write', put);
app.post('/api/upload', put);
app.get('/api/download', async (req, res) => {
  try {
    const p = safe(req.query.path);
    const buf = await withSftp(c => c.get(p));
    res.setHeader('Content-Disposition', 'attachment; filename="' + path.posix.basename(p) + '"');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/mkdir', json(async (c, req) => { await c.mkdir(safe(req.query.path), true); return { ok: true }; }));
app.post('/api/delete', json(async (c, req) => {
  const p = safe(req.query.path);
  (await c.stat(p)).isDirectory ? await c.rmdir(p, true) : await c.delete(p);
  return { ok: true };
}));
app.post('/api/rename', json(async (c, req) => { await c.rename(safe(req.query.from), safe(req.query.to)); return { ok: true }; }));
app.get('/api/log', json(async c => {
  const p = safe(logPath);
  const st = await c.stat(p);
  const buf = await c.get(p, undefined, { readStreamOptions: { start: Math.max(0, st.size - 65536) } });
  return { log: buf.toString('utf8') };
}));
app.post('/api/power', json(async (c, req) => {
  let cmd = cmds[req.query.action];
  if (!cmd) throw new Error('No command set for "' + req.query.action + '" in Vercel environment variables.');
  if (req.query.action === 'send') cmd = cmd.replace('{cmd}', String(req.query.cmd || '').replace(/'/g, "'\\''"));
  return { output: await run(c, cmd.replace(/\\n/g, '\n')) };
}));

// ---- page ----
const PAGE = String.raw`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Panel</title>
<style>
:root{--bg:#16191f;--panel:#1e232b;--line:#2d343f;--text:#e4e8ee;--mute:#8b95a5;--acc:#4f8cff;--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
h1{font-size:17px;margin:0}.sub{color:var(--mute);font-size:13px}
button{font:inherit;background:var(--line);color:var(--text);border:0;border-radius:6px;padding:7px 13px;cursor:pointer}button:hover{background:#3a4350}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
.p{background:var(--acc);color:#fff}.ok{background:#2f6b42}.bad{background:#7d2f2b}
nav{display:flex;gap:4px;padding:10px 20px 0;border-bottom:1px solid var(--line)}nav button{background:none;border-radius:6px 6px 0 0;color:var(--mute)}
nav button.on{color:var(--text);background:var(--panel);box-shadow:inset 0 -2px var(--acc)}
main{padding:20px;max-width:1000px;margin:0 auto}.tab{display:none}.tab.on{display:block}
#log{background:#0e1014;border:1px solid var(--line);border-radius:8px;padding:12px;height:55vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font:13px/1.45 var(--mono)}
.row{display:flex;gap:8px;margin-top:10px}.row input{flex:1}
input,textarea{background:#0e1014;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px 10px;font:inherit}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
#crumbs{flex:1;color:var(--mute);font-family:var(--mono);font-size:13px}#crumbs a{color:var(--acc);cursor:pointer}
table{width:100%;border-collapse:collapse}td{padding:8px 10px;border-bottom:1px solid var(--line)}
td.n{cursor:pointer}td.n:hover{color:var(--acc)}td.s{color:var(--mute);text-align:right;white-space:nowrap;font-size:13px}
td.a{text-align:right;white-space:nowrap}td.a button{padding:3px 9px;font-size:13px}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center;padding:20px}.ov.on{display:flex}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;width:min(900px,100%);height:min(80vh,700px);display:flex;flex-direction:column;padding:14px;gap:10px}
.card textarea{flex:1;font:13px/1.45 var(--mono);resize:none}.card .top{display:flex;justify-content:space-between;align-items:center;gap:10px}
#login .card{width:min(360px,100%);height:auto}
#toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);padding:10px 16px;border-radius:8px;display:none}
#drop.over{outline:2px dashed var(--acc)}
</style></head><body>
<header><div><h1>Server Panel</h1><div class="sub" id="where"></div></div>
<div id="power" style="display:none;gap:8px"><button class="ok" data-a="start">Start</button><button data-a="restart">Restart</button><button class="bad" data-a="stop">Stop</button></div></header>
<nav><button class="on" data-t="console">Console</button><button data-t="files">Files</button></nav>
<main>
<section class="tab on" id="console"><div id="log">Loading log…</div>
<div class="row" id="cmdrow" style="display:none"><input id="cmd" placeholder="Type a server command" autocomplete="off"><button class="p" id="sendcmd">Send command</button></div></section>
<section class="tab" id="files"><div class="bar"><div id="crumbs"></div><button id="mk">New folder</button><button class="p" id="up">Upload files</button><input type="file" id="file" multiple hidden></div>
<div id="drop"><table><tbody id="list"></tbody></table></div></section>
</main>
<div class="ov" id="editor"><div class="card"><div class="top"><strong id="etitle"></strong><div><button class="p" id="save">Save file</button> <button id="close">Close</button></div></div><textarea id="text" spellcheck="false"></textarea></div></div>
<div class="ov" id="login"><div class="card"><strong>Sign in to your panel</strong><input id="pw" type="password" placeholder="Panel password" autocomplete="current-password"><button class="p" id="go">Sign in</button><div class="sub" id="lerr"></div></div></div>
<div id="toast"></div>
<script>
var $=function(s){return document.querySelector(s)};
var cwd='/',editing=null,TOKEN=sessionStorage.getItem('mct')||'';
function q(o){return new URLSearchParams(o).toString()}
function join(a,b){return (a==='/'?'':a)+'/'+b}
function size(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'}
function toast(m){var t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(t._t);t._t=setTimeout(function(){t.style.display='none'},3500)}
async function api(u,o){
  o=o||{};o.headers=Object.assign({'x-token':TOKEN},o.headers||{});
  var r=await fetch(u,o);
  if(r.status===401&&u.indexOf('/api/login')<0){showLogin();throw new Error('Please sign in')}
  var j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j;
}
function showLogin(){$('#login').classList.add('on');$('#pw').focus()}
async function login(){
  try{
    var r=await fetch('/api/login',{method:'POST',headers:{'x-password':encodeURIComponent($('#pw').value)}});
    var j={};try{j=await r.json()}catch(x){}if(!r.ok)throw new Error((j.error||'Server error')+' ('+r.status+')');
    TOKEN=j.token;sessionStorage.setItem('mct',TOKEN);$('#login').classList.remove('on');$('#pw').value='';start();
  }catch(e){$('#lerr').textContent=e.message}
}
$('#go').onclick=login;$('#pw').onkeydown=function(e){if(e.key==='Enter')login()};

document.querySelectorAll('nav button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('nav button,.tab').forEach(function(e){e.classList.remove('on')});
  b.classList.add('on');$('#'+b.dataset.t).classList.add('on');
  if(b.dataset.t==='files')load(cwd);else pollLog();
}});
var timer=null;
async function start(){
  try{
    var i=await api('/api/info');
    $('#where').textContent=i.host+'  ·  '+i.root;
    if(i.power)$('#power').style.display='flex';
    if(i.send)$('#cmdrow').style.display='flex';
    pollLog();clearInterval(timer);timer=setInterval(pollLog,6000);
  }catch(e){}
}
async function pollLog(){
  if(!$('#console').classList.contains('on')||!TOKEN)return;
  try{
    var el=$('#log'),stick=el.scrollHeight-el.scrollTop-el.clientHeight<40;
    el.textContent=(await api('/api/log')).log||'(log is empty)';
    if(stick)el.scrollTop=el.scrollHeight;
  }catch(e){$('#log').textContent='Could not read the log: '+e.message+'\nCheck LOG_PATH, SERVER_ROOT and your SFTP settings.'}
}
document.querySelectorAll('#power button').forEach(function(b){b.onclick=async function(){
  try{await api('/api/power?'+q({action:b.dataset.a}),{method:'POST'});toast(b.textContent+' command sent')}catch(e){toast(e.message)}
}});
async function sendCmd(){
  var v=$('#cmd').value.trim();if(!v)return;
  try{await api('/api/power?'+q({action:'send',cmd:v}),{method:'POST'});$('#cmd').value='';setTimeout(pollLog,800)}catch(e){toast(e.message)}
}
$('#sendcmd').onclick=sendCmd;$('#cmd').onkeydown=function(e){if(e.key==='Enter')sendCmd()};

async function load(p){
  try{
    var items=await api('/api/list?'+q({path:p}));cwd=p;
    var parts=p.split('/').filter(Boolean),acc='';
    $('#crumbs').innerHTML='<a data-p="/">root</a>'+parts.map(function(x){acc+='/'+x;return ' / <a data-p="'+acc+'">'+x.replace(/</g,'&lt;')+'</a>'}).join('');
    $('#crumbs').querySelectorAll('a').forEach(function(a){a.onclick=function(){load(a.dataset.p)}});
    var tb=$('#list');tb.innerHTML='';
    if(!items.length)tb.innerHTML='<tr><td class="s" style="text-align:left">This folder is empty. Drop files here to upload.</td></tr>';
    items.forEach(function(i){
      var tr=document.createElement('tr'),full=join(p,i.name);
      tr.innerHTML='<td class="n"></td><td class="s">'+(i.dir?'':size(i.size))+'</td><td class="a"></td>';
      tr.children[0].textContent=(i.dir?'📁 ':'📄 ')+i.name;
      tr.children[0].onclick=function(){i.dir?load(full):openFile(full)};
      var a=tr.children[2];
      if(!i.dir){var d=document.createElement('button');d.textContent='Download';d.onclick=function(){download(full)};a.append(d,' ')}
      var r=document.createElement('button');r.textContent='Rename';
      r.onclick=async function(){var n=prompt('New name',i.name);if(n&&n!==i.name){try{await api('/api/rename?'+q({from:full,to:join(p,n)}),{method:'POST'});load(p)}catch(e){toast(e.message)}}};
      var x=document.createElement('button');x.textContent='Delete';x.className='bad';
      x.onclick=async function(){if(confirm('Delete '+i.name+'?')){try{await api('/api/delete?'+q({path:full}),{method:'POST'});load(p)}catch(e){toast(e.message)}}};
      a.append(r,' ',x);tb.append(tr);
    });
  }catch(e){toast(e.message)}
}
async function download(p){
  try{
    var r=await fetch('/api/download?'+q({path:p}),{headers:{'x-token':TOKEN}});
    if(!r.ok)throw new Error((await r.json()).error);
    var a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=p.split('/').pop();a.click();
  }catch(e){toast(e.message)}
}
async function openFile(p){
  try{var r=await api('/api/read?'+q({path:p}));editing=p;$('#etitle').textContent=p;$('#text').value=r.content;$('#editor').classList.add('on')}catch(e){toast(e.message)}
}
$('#close').onclick=function(){$('#editor').classList.remove('on')};
$('#save').onclick=async function(){
  try{await api('/api/write?'+q({path:editing}),{method:'POST',headers:{'Content-Type':'text/plain'},body:$('#text').value});toast('Saved')}catch(e){toast(e.message)}
};
$('#mk').onclick=async function(){var n=prompt('Folder name');if(n){try{await api('/api/mkdir?'+q({path:join(cwd,n)}),{method:'POST'});load(cwd)}catch(e){toast(e.message)}}};
$('#up').onclick=function(){$('#file').click()};
async function upload(files){
  for(var f of files){
    if(f.size>4*1024*1024){toast(f.name+' is over 4 MB. Vercel limits uploads to 4 MB.');continue}
    toast('Uploading '+f.name+'…');
    try{await api('/api/upload?'+q({path:join(cwd,f.name)}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:f})}catch(e){toast(e.message);return}
  }
  toast('Upload complete');load(cwd);
}
$('#file').onchange=function(e){upload(e.target.files);e.target.value=''};
var dz=$('#drop');
dz.ondragover=function(e){e.preventDefault();dz.classList.add('over')};
dz.ondragleave=function(){dz.classList.remove('over')};
dz.ondrop=function(e){e.preventDefault();dz.classList.remove('over');upload(e.dataTransfer.files)};
if(TOKEN)start();else showLogin();
</script></body></html>`;

app.get('*', (req, res) => res.type('html').send(PAGE));
module.exports = app;
