// Drives the locally served game in headless Chrome over the DevTools protocol: real key
// events in real time, screenshots along the way, and any page error reported.
// Start a server first (npm run preview -- --port 4317), then:
//
//   node tools/drive.mjs "<url query>" <step> [<step> ...]
//
//   key:<Code>[+shift]   press and release a key (key:ArrowRight, key:KeyR+shift)
//   hold:<Code>:<ms>     hold a key down for a while
//   down:<Code> up:<Code> press or release only (hold one key, tap another)
//   play:<script>        type a script in the game's notation (L R U D . E T |)
//   type:<script>        the same, typed fast (about eleven keys a second, no pause)
//   wait:<ms>            let the game run
//   shot:<name>          save .scratch/shots/<name>.png
//   burst:<name>:<n>:<ms> save n screenshots, ms apart, as <name>-0.png …
//   eval:<js>            print the value of an expression (promises are awaited)
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRATCH = resolve(dirname(fileURLToPath(import.meta.url)), '../.scratch');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4317';
const PORT = 9333 + Math.floor(Math.random() * 400);
const [query = '', ...steps] = process.argv.slice(2);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
mkdirSync(`${SCRATCH}/shots`, { recursive: true });
const profile = `${SCRATCH}/chrome-${PORT}`;

const chrome = spawn(
  CHROME,
  ['--headless=new', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,760', 'about:blank'],
  { stdio: 'ignore' },
);

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await pageSocket());
await new Promise((done) => ws.addEventListener('open', done));
let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result ?? message.error);
    pending.delete(message.id);
  } else if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  } else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) =>
  new Promise((done) => {
    const id = nextId++;
    pending.set(id, done);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${ORIGIN}/?${query}` });
await sleep(1500);

const key = (type, code, shift) =>
  send('Input.dispatchKeyEvent', { type, code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, modifiers: shift ? 8 : 0 });
const SCRIPT_KEYS = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', '.': 'Space', E: 'KeyE', T: 'KeyT', '|': 'KeyR' };

for (const step of steps) {
  const [kind, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (kind === 'key') {
    const [code, mod] = arg.split('+');
    await key('keyDown', code, mod === 'shift');
    await sleep(30);
    await key('keyUp', code, mod === 'shift');
    await sleep(260);
  } else if (kind === 'down' || kind === 'up') {
    // Separate press and release, to hold one key while tapping another.
    await key(kind === 'down' ? 'keyDown' : 'keyUp', arg, false);
  } else if (kind === 'hold') {
    const [code, ms] = arg.split(':');
    await key('keyDown', code, false);
    await sleep(Number(ms));
    await key('keyUp', code, false);
  } else if (kind === 'play') {
    for (const char of arg) {
      await key('keyDown', SCRIPT_KEYS[char], false);
      await sleep(25);
      await key('keyUp', SCRIPT_KEYS[char], false);
      // Rewinds and dimension changes hold the input back while they play out.
      await sleep(char === '|' ? 1300 : char === 'E' ? 520 : 330);
    }
  } else if (kind === 'type') {
    // A fast typist: keys arrive quicker than the hero moves, and none may be lost.
    for (const char of arg) {
      await key('keyDown', SCRIPT_KEYS[char], false);
      await sleep(25);
      await key('keyUp', SCRIPT_KEYS[char], false);
      await sleep(65);
    }
  } else if (kind === 'wait') {
    await sleep(Number(arg));
  } else if (kind === 'burst') {
    // burst:<name>:<count>:<ms> — a strip of screenshots, to look at motion.
    const [name, count, ms] = arg.split(':');
    for (let i = 0; i < Number(count); i++) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${SCRATCH}/shots/${name}-${i}.png`, Buffer.from(data, 'base64'));
      await sleep(Number(ms));
    }
    console.log(`burst ${SCRATCH}/shots/${name}-0..${Number(count) - 1}.png`);
  } else if (kind === 'shot') {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SCRATCH}/shots/${arg}.png`, Buffer.from(data, 'base64'));
    console.log(`shot ${SCRATCH}/shots/${arg}.png`);
  } else if (kind === 'eval') {
    const { result } = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true });
    console.log(`eval => ${JSON.stringify(result?.value)}`);
  }
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
ws.close();
chrome.kill();
await sleep(200);
rmSync(profile, { recursive: true, force: true });
