/**
 * Probe the running AfterImage desktop build.
 *
 * A packaged Tauri window has no browser tab to open, so there is no way to see
 * what the renderer actually believes without attaching to it. When the app is
 * started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`
 * this script attaches over the Chrome DevTools Protocol and reports:
 *
 *   - the page title and URL, so we know the real frontend loaded;
 *   - `document.body.innerText`, i.e. what the user is looking at;
 *   - console errors and failed loads;
 *   - whether Tauri IPC actually answers, by invoking a command directly and
 *     racing it against a timeout. A packaged app whose main thread is wedged
 *     will load the page and then never answer a single command, which looks
 *     identical to a healthy app from the outside.
 *
 * Usage: node tools/desktop-probe.mjs [port] [--eval "expression"]
 */

const port = Number(process.argv[2]) || 9223;
const evalIndex = process.argv.indexOf('--eval');
const expression = evalIndex > -1 ? process.argv[evalIndex + 1] : null;

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target — is the app running with remote debugging on?');
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const console_ = [];
const failures = [];

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve } = pending.get(message.id);
    pending.delete(message.id);
    resolve(message);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? [])
      .map((a) => a.value ?? a.description ?? '')
      .join(' ');
    console_.push(`${message.params.type}: ${text}`);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const d = message.params.exceptionDetails;
    console_.push(`uncaught: ${d.exception?.description ?? d.text}`);
  }
  if (message.method === 'Network.loadingFailed') {
    failures.push(`${message.params.type} ${message.params.errorText}`);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (source, timeoutMs = 8000) => {
  const call = send('Runtime.evaluate', {
    expression: `(async () => { ${source} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ timedOut: true }), timeoutMs),
  );
  const result = await Promise.race([call, timeout]);
  if (result.timedOut) return { timedOut: true };
  if (result.result?.exceptionDetails) {
    return { error: result.result.exceptionDetails.exception?.description };
  }
  return { value: result.result?.result?.value };
};

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve);
  socket.addEventListener('error', reject);
});

await send('Runtime.enable');
await send('Network.enable');

console.log(`title: ${JSON.stringify(page.title)}`);
console.log(`url:   ${page.url}`);

const shape = await evaluate(`
  return {
    heading: document.querySelector('h1,h2')?.innerText ?? null,
    text: document.body.innerText.slice(0, 1200),
    hasTauri: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
    elements: document.querySelectorAll('*').length,
  };
`);
console.log('\n--- rendered ---');
console.log(shape.value ? shape.value.text : JSON.stringify(shape));
if (shape.value) {
  console.log(`\nheading: ${JSON.stringify(shape.value.heading)}`);
  console.log(`tauri bridge: ${shape.value.hasTauri} · nodes: ${shape.value.elements}`);
}

console.log('\n--- ipc ---');
const ipc = await evaluate(
  `return await window.__TAURI_INTERNALS__.invoke('archive_snapshot');`,
  10000,
);
if (ipc.timedOut) {
  console.log('archive_snapshot: TIMED OUT — the main thread is not servicing IPC');
} else if (ipc.error) {
  console.log(`archive_snapshot: threw ${ipc.error}`);
} else {
  console.log(`archive_snapshot: ${JSON.stringify(ipc.value)?.slice(0, 400)}`);
}

if (expression) {
  console.log('\n--- eval ---');
  const custom = await evaluate(`return (${expression});`, 15000);
  console.log(JSON.stringify(custom, null, 2));
}

if (console_.length) {
  console.log('\n--- console ---');
  console.log(console_.slice(-25).join('\n'));
}
if (failures.length) {
  console.log('\n--- failed loads ---');
  console.log([...new Set(failures)].join('\n'));
}

socket.close();
process.exit(0);
