// p60-bridge —— 用 adb 把手机的控制能力包成 MCP，走局域网给 Aru 用
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');

const PORT = 3000;
const ADB = process.env.ADB_PATH || (fs.existsSync('C:/platform-tools/adb.exe') ? 'C:/platform-tools/adb.exe' : 'adb');
let SERIAL = null;

function serial() {
  if (SERIAL) return SERIAL;
  const out = execFileSync(ADB, ['devices'], { encoding: 'utf8', input: '', timeout: 20000, windowsHide: true });
  const line = out.split(/\r?\n/).find(x => /\sdevice$/.test(x.trim()));
  if (!line) throw new Error('没找到已授权的设备，先跑 adb devices 看看');
  SERIAL = line.trim().split(/\s+/)[0];
  return SERIAL;
}

function adb(args, raw) {
  return execFileSync(ADB, ['-s', serial()].concat(args), {
    encoding: raw ? null : 'utf8',
    input: '',
    timeout: 60000,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
}

const T = (s) => ({ content: [{ type: 'text', text: String(s).trim() || '(没有输出)' }] });
const B = (buf) => ({ content: [{ type: 'image', data: Buffer.from(buf).toString('base64'), mimeType: 'image/png' }] });
const num = (v) => String(Math.round(Number(v)));

const tools = [
  { name: 'screen_size', description: '取屏幕分辨率', inputSchema: { type: 'object', properties: {} }, run: () => T(adb(['shell', 'wm', 'size'])) },
  { name: 'screenshot', description: '截一张手机屏幕', inputSchema: { type: 'object', properties: {} }, run: () => B(adb(['exec-out', 'screencap', '-p'], true)) },
  { name: 'tap', description: '按坐标点一下屏幕', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }, run: a => T(adb(['shell', 'input', 'tap', num(a.x), num(a.y)])) },
  { name: 'long_press', description: '长按一个坐标', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, ms: { type: 'number' } }, required: ['x', 'y'] }, run: a => T(adb(['shell', 'input', 'swipe', num(a.x), num(a.y), num(a.x), num(a.y), String(a.ms || 800)])) },
  { name: 'swipe', description: '从一点滑到另一点', inputSchema: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, ms: { type: 'number' } }, required: ['x1', 'y1', 'x2', 'y2'] }, run: a => T(adb(['shell', 'input', 'swipe', num(a.x1), num(a.y1), num(a.x2), num(a.y2), String(a.ms || 300)])) },
  { name: 'input_text', description: '向当前输入框打字，中文英文都行（需先设好 ADBKeyboard 输入法）', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, run: a => {
      const text = String(a.text == null ? '' : a.text);
      const b64 = Buffer.from(text, 'utf8').toString('base64');
      const r1 = adb(['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64]);
      return T('已输入：' + text + '\n' + (r1 || ''));
    } },
  { name: 'key_event', description: '按一个键：HOME / BACK / ENTER / POWER / WAKEUP / VOLUME_UP / VOLUME_DOWN', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, run: a => T(adb(['shell', 'input', 'keyevent', String(a.key)])) },
  { name: 'launch_app', description: '按包名启动应用', inputSchema: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] }, run: a => T(adb(['shell', 'monkey', '-p', String(a.pkg), '-c', 'android.intent.category.LAUNCHER', '1'])) },
  { name: 'list_apps', description: '列出已安装应用的包名', inputSchema: { type: 'object', properties: { filter: { type: 'string' } } }, run: a => {
      let out = adb(['shell', 'pm', 'list', 'packages']);
      if (a && a.filter) out = String(out).split(/\r?\n/).filter(l => l.includes(a.filter)).join('\n');
      return T(out);
    } },
  { name: 'current_app', description: '看现在前台是什么应用', inputSchema: { type: 'object', properties: {} }, run: () => {
      const out = String(adb(['shell', 'dumpsys', 'activity', 'activities'])).split(/\r?\n/).filter(l => /mResumedActivity|topResumedActivity/.test(l)).join('\n');
      return T(out || '(读不到)');
    } },
  { name: 'ui_dump', description: '把当前界面的控件树导出来（鸿蒙上可能不支持）', inputSchema: { type: 'object', properties: {} }, run: () => {
      adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']);
      return T(adb(['shell', 'cat', '/sdcard/ui.xml']));
    } },
  { name: 'open_url', description: '用手机浏览器打开一个网址', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, run: a => T(adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', String(a.url)])) },
  { name: 'ime_list', description: '看手机上有哪些输入法', inputSchema: { type: 'object', properties: {} }, run: () => T(adb(['shell', 'ime', 'list', '-s'])) },
  { name: 'ime_use', description: '把默认输入法切成 ADBKeyboard（中文打字前先用一次）', inputSchema: { type: 'object', properties: {}, run: () => T(adb(['shell', 'ime', 'enable', 'com.android.adbkeyboard/.AdbIME'])) } },
  { name: 'shell', description: '在手机上直接跑一条 shell 命令', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, run: a => T(adb(['shell', String(a.command)])) },
];

function reply(id, payload, req, res) {
  const body = Object.assign({ jsonrpc: '2.0', id }, payload);
  const accept = String(req.headers['accept'] || '');
  if (accept.includes('text/event-stream')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Mcp-Session-Id': 'p60-bridge' });
    res.write('event: message\ndata: ' + JSON.stringify(body) + '\n\n');
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'p60-bridge' });
    res.end(JSON.stringify(body));
  }
}

function handle(msg, req, res) {
  const id = msg && msg.id;
  const method = msg && msg.method;
  const params = msg && msg.params;
  if (!method) { res.writeHead(202); return res.end(); }
  if (method === 'initialize') {
    return reply(id, { result: {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'p60-bridge', version: '1.1.0' },
    } }, req, res);
  }
  if (method.startsWith('notifications/')) { res.writeHead(202); return res.end(); }
  if (method === 'ping') return reply(id, { result: {} }, req, res);
  if (method === 'tools/list') {
    return reply(id, { result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } }, req, res);
  }
  if (method === 'tools/call') {
    const t = tools.find(x => x.name === (params && params.name));
    if (!t) return reply(id, { error: { code: -32601, message: '没有这个工具：' + (params && params.name) } }, req, res);
    try {
      return reply(id, { result: t.run(params.arguments || {}) }, req, res);
    } catch (e) {
      return reply(id, { result: { content: [{ type: 'text', text: '出错了：' + (e.message || e) }], isError: true } }, req, res);
    }
  }
  return reply(id, { error: { code: -32601, message: '没有这个方法：' + method } }, req, res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('use POST /mcp'); }
  if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let msg;
    try { msg = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('bad json'); }
    const first = Array.isArray(msg) ? msg[0] : msg;
    handle(first, req, res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('p60-bridge 已启动：http://0.0.0.0:' + PORT + '/mcp');
  try { console.log('设备：' + serial()); } catch (e) { console.log('暂时没看到设备：' + e.message); }
});
