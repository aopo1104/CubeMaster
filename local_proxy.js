import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const BASE_API = 'https://api.cubemaster.net';
const HOST = '0.0.0.0';
const PORT = 3001;
const SERVER_TOKEN = process.env.CUBEMASTER_TOKEN;
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_FILE = resolve(__dirname, 'frontend_mock.html');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-TokenID',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function pickToken() {
  return SERVER_TOKEN;
}

async function forward(method, path, token, { params, payload } = {}) {
  if (!token) {
    return {
      status: 400,
      body: { error: 'Missing token. Provide token query param, X-TokenID header, or CUBEMASTER_TOKEN env var.' },
    };
  }
  let url = `${BASE_API}${path}`;
  if (params) {
    url += `?${new URLSearchParams(params).toString()}`;
  }
  const init = {
    method,
    headers: { 'TokenID': token },
    signal: AbortSignal.timeout(40000),
  };
  if (payload !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload);
    console.log('[→ CubeMaster Request]', url);
    console.log(JSON.stringify(payload, null, 2));
  }
  const resp = await fetch(url, init);
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return { status: resp.status, body: await resp.json() };
    } catch {
      return { status: resp.status, body: { raw: await resp.text() } };
    }
  }
  return { status: resp.status, body: await resp.text() };
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...CORS_HEADERS,
  });
  res.end(body);
}

function sendHtml(res, html) {
  const body = Buffer.from(html, 'utf-8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = parsed.pathname;
  const query = parsed.searchParams;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      if (pathname === '/cubemaster' || pathname === '/cubemaster/') {
        if (existsSync(WEB_FILE)) {
          sendHtml(res, readFileSync(WEB_FILE, 'utf-8'));
        } else {
          sendHtml(res, '<h1>frontend_mock.html not found</h1>');
        }
        return;
      }

      if (pathname === '/cubemaster/api/health') {
        sendJson(res, 200, { ok: true, api: BASE_API });
        return;
      }

      if (pathname === '/cubemaster/api/check-token' || pathname === '/cubemaster/api/loads') {
        const token = pickToken();
        const limit = parseInt(query.get('limit') || '1', 10);
        const { status, body } = await forward('GET', '/Loads', token, { params: { limit } });
        sendJson(res, status, body);
        return;
      }

      if (pathname.startsWith('/cubemaster/api/loads/')) {
        const token = pickToken();
        const loadId = pathname.slice('/cubemaster/api/loads/'.length);
        const { status, body } = await forward('GET', `/Loads/${loadId}`, token);
        sendJson(res, status, body);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    if (req.method === 'POST') {
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      if (pathname === '/cubemaster/api/loads') {
        const token = pickToken();
        const { status, body } = await forward('POST', '/Loads', token, { payload });
        sendJson(res, status, body);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    sendJson(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local proxy running at http://${HOST}:${PORT}/cubemaster`);
  console.log('Endpoints: /cubemaster/api/health, /cubemaster/api/check-token, /cubemaster/api/loads, /cubemaster/api/loads/{id}');
});
