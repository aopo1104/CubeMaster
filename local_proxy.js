import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const BASE_API = 'https://api.cubemaster.net';
const HOST = '0.0.0.0';
const PORT = 3001;
const SERVER_TOKEN = process.env.CUBEMASTER_TOKEN;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[CONFIG] Missing required environment variable: ${name}`);
  }
  return value;
}

const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = requireEnv('MYSQL_PASSWORD');
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'cubemaster';
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_FILE = resolve(__dirname, 'frontend_mock.html');

const dbPool = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-TokenID',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function pickToken() {
  return SERVER_TOKEN;
}

async function logPalletLoad(inputPayload, outputBody, responseStatus) {
  const inputJson = JSON.stringify(inputPayload ?? {});
  const outputJson = JSON.stringify(outputBody ?? null);
  await dbPool.execute(
    `INSERT INTO pallet_load_logs (input_json, output_json, response_status)
     VALUES (?, ?, ?)`,
    [inputJson, outputJson, responseStatus ?? null]
  );
}

async function logPallet2CtnLoad(flowId, step, inputPayload, outputBody, responseStatus) {
  if (!flowId) return;
  const inputJson = JSON.stringify(inputPayload ?? {});
  const outputJson = JSON.stringify(outputBody ?? null);
  if (String(step) === '1') {
    await dbPool.execute(
      `INSERT INTO pallet2ctn_load_logs (flow_id, step1_input_json, step1_output_json, step1_status)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         step1_input_json = VALUES(step1_input_json),
         step1_output_json = VALUES(step1_output_json),
         step1_status = VALUES(step1_status),
         updated_at = CURRENT_TIMESTAMP`,
      [flowId, inputJson, outputJson, responseStatus ?? null]
    );
  } else if (String(step) === '2') {
    await dbPool.execute(
      `INSERT INTO pallet2ctn_load_logs (flow_id, step2_input_json, step2_output_json, step2_status)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         step2_input_json = VALUES(step2_input_json),
         step2_output_json = VALUES(step2_output_json),
         step2_status = VALUES(step2_status),
         updated_at = CURRENT_TIMESTAMP`,
      [flowId, inputJson, outputJson, responseStatus ?? null]
    );
  }
}

async function logLoadByFlow(query, inputPayload, outputBody, responseStatus) {
  const flowType = query.get('flowType') || '';
  if (flowType === 'pallet') {
    await logPalletLoad(inputPayload, outputBody, responseStatus);
    return;
  }
  if (flowType === 'pallet2ctn') {
    await logPallet2CtnLoad(
      query.get('flowId') || '',
      query.get('step') || '',
      inputPayload,
      outputBody,
      responseStatus
    );
  }
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
    signal: AbortSignal.timeout(180000),
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

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

function serveStatic(res, filePath) {
  const safePath = resolve(__dirname, filePath);
  if (!safePath.startsWith(__dirname)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (!existsSync(safePath)) {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }
  const ext = extname(safePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const body = readFileSync(safePath);
  res.writeHead(200, {
    'Content-Type': mime + (mime.startsWith('text') ? '; charset=utf-8' : ''),
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

      // Serve static assets (css/, js/)
      if (pathname.startsWith('/cubemaster/css/') || pathname.startsWith('/cubemaster/js/')) {
        const relPath = pathname.slice('/cubemaster/'.length);
        serveStatic(res, relPath);
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
        const upstreamParams = {
          UOM: 'UnitMetric',
          placementsCreated: 'true',
        };
        if (query.get('graphicsCreated') === 'true') {
          upstreamParams.graphicsCreated     = 'true';
          upstreamParams.graphicsImageWidth  = query.get('graphicsImageWidth')  || '800';
          upstreamParams.graphicsImageDepth  = query.get('graphicsImageDepth')  || '600';
        }
        if (query.get('spacesCreated') === 'true') {
          upstreamParams.spacesCreated = 'true';
        }
        const { status, body } = await forward('POST', '/Loads', token, {
          params: upstreamParams,
          payload
        });
        try {
          await logLoadByFlow(query, payload, body, status);
        } catch (dbErr) {
          console.error('[DB LOG ERROR]', dbErr.message);
        }
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

dbPool.getConnection()
  .then((conn) => {
    conn.release();
    console.log(`[DB] Connected to MySQL ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
  })
  .catch((err) => {
    console.error('[DB] Connection failed:', err.message);
  });
