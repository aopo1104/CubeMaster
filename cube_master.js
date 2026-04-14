import { readFileSync } from 'fs';
import { resolve } from 'path';

const BASE_URL = 'https://api.cubemaster.net';

async function callApi(method, path, token, { params, payload } = {}) {
  let url = `${BASE_URL}${path}`;
  if (params) {
    url += `?${new URLSearchParams(params).toString()}`;
  }
  const init = {
    method: method.toUpperCase(),
    headers: { 'TokenID': token },
    signal: AbortSignal.timeout(30000),
  };
  if (payload !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }
  const resp = await fetch(url, init);
  const contentType = resp.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await resp.json()
    : await resp.text();
  return { status: resp.status, body };
}

function printResult(status, body) {
  console.log(`HTTP ${status}`);
  if (typeof body === 'object' && body !== null) {
    console.log(JSON.stringify(body, null, 2));
  } else {
    console.log(body);
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { token: '', command: null, opts: { limit: 1, method: 'GET' } };
  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--token')        result.token = args[++i];
    else if (args[i] === '--limit')        result.opts.limit = parseInt(args[++i], 10);
    else if (args[i] === '--load-id')      result.opts.loadId = args[++i];
    else if (args[i] === '--payload-file') result.opts.payloadFile = args[++i];
    else if (args[i] === '--method')       result.opts.method = args[++i];
    else if (args[i] === '--path')         result.opts.path = args[++i];
    else if (!args[i].startsWith('--') && !result.command) result.command = args[i];
  }
  if (!result.token) result.token = process.env.CUBEMASTER_TOKEN || '';
  return result;
}

function printHelp() {
  console.log(`CubeMaster API integration helper

Usage:
  node cube_master.js <command> --token <TOKEN> [options]

Commands:
  check-token                        Step 1: validate token with GET /Loads
  list-loads    [--limit N]          Step 2: list load results (default: 1)
  create-load   --payload-file FILE  Step 3: create calculation via POST /Loads
  get-load      --load-id ID         Step 4: query one load by id
  call          --method M --path P  Call any API path directly

Options:
  --token TOKEN   API TokenID (or set CUBEMASTER_TOKEN env var)
`);
}

async function main() {
  const { token, command, opts } = parseArgs(process.argv);

  if (!token) {
    console.error('Missing token: pass --token or set CUBEMASTER_TOKEN');
    process.exit(1);
  }

  if (!command || command === 'check-token') {
    const { status, body } = await callApi('GET', '/Loads', token, { params: { limit: 1 } });
    printResult(status, body);

  } else if (command === 'list-loads') {
    const { status, body } = await callApi('GET', '/Loads', token, { params: { limit: opts.limit } });
    printResult(status, body);

  } else if (command === 'get-load') {
    if (!opts.loadId) { console.error('--load-id is required'); process.exit(1); }
    const { status, body } = await callApi('GET', `/Loads/${opts.loadId}`, token);
    printResult(status, body);

  } else if (command === 'create-load') {
    if (!opts.payloadFile) { console.error('--payload-file is required'); process.exit(1); }
    const filePath = resolve(opts.payloadFile);
    let payload;
    try {
      payload = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      console.error(`Cannot read payload file: ${filePath}`);
      process.exit(1);
    }
    const { status, body } = await callApi('POST', '/Loads', token, { payload });
    printResult(status, body);

  } else if (command === 'call') {
    if (!opts.path) { console.error('--path is required'); process.exit(1); }
    let params;
    if (opts.path === '/Loads' && opts.method.toUpperCase() === 'GET') {
      params = { limit: opts.limit };
    }
    const { status, body } = await callApi(opts.method, opts.path, token, { params });
    printResult(status, body);

  } else {
    printHelp();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
