require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { connectMongo, getDb, isConnected, ObjectId, bootstrapInitialAdmin } = require('./db');
const { buildApiRoutes } = require('./routes/register-routes');
const { validateUserPass, validatePasswordChange, validateDataUpdate } = require('./lib/validators');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const SESSION_COOKIE = 'kv_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ALLOW_LEGACY_FILE_AUTH = String(process.env.ALLOW_LEGACY_FILE_AUTH || '').toLowerCase() === 'true';
const BCRYPT_ROUNDS = 10;

const EXTERNAL_API_BASE = 'https://admin.flipchat.link';
const STAKE_REPORT_SLUG = 'ipl2026';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Data files stay at project root (not served as static files)
const DATA_JSON_PATH = path.join(__dirname, 'data.json');
const BRANDS_JSON_PATH = path.join(__dirname, 'brands.json');
const BRANDS_DIR = path.join(PUBLIC_DIR, 'brands');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

function sendJson(res, statusCode, obj, extraHeaders) {
  res.setHeader('Content-Type', 'application/json');
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach((k) => res.setHeader(k, extraHeaders[k]));
  }
  res.writeHead(statusCode);
  res.end(JSON.stringify(obj));
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  const out = {};
  if (!raw) return out;
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

function signSession(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch (e) {
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (obj.exp && Math.floor(Date.now() / 1000) > obj.exp) return null;
  return obj;
}

function getInternalSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  const v = verifySession(token);
  if (!v || !v.u || !v.w) return null;
  return { userId: v.u, workspaceId: v.w, role: v.r || 'user' };
}

function requireInternalSession(req, res) {
  const sess = getInternalSession(req);
  if (!sess) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return sess;
}

function setSessionCookie(res, req, payload) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const token = signSession({ ...payload, exp });
  const secure =
    process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${SESSION_TTL_SEC}`,
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function mongoRequired(res) {
  sendJson(res, 503, { error: 'MongoDB is not configured. Set MONGODB_URI.' });
}

function formatWithCommas(num) {
  return Number(num).toLocaleString('en-US');
}

function getYesterdayIST() {
  const d = new Date();
  const yesterday = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getYesterdayISTKey() {
  const d = new Date();
  const yesterday = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

function formatAccountId(prefix6) {
  const s = String(prefix6).padStart(6, '0').slice(0, 6);
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-KVZONE`;
}

function slugify(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'brand';
}

function safeUnlink(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) return;
  fs.unlink(resolved, () => {});
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseImageDataUrl(logo) {
  let ext = 'png';
  let mimeType = 'image/png';
  const m = logo.match(/^data:image\/(\w+);base64,/);
  if (m) {
    ext = m[1].replace('jpeg', 'jpg');
    mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  }
  const base64 = logo.replace(/^data:image\/\w+;base64,/, '');
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch (e) {
    return { error: 'Invalid logo image data' };
  }
  if (buf.length > 5 * 1024 * 1024) return { error: 'Logo image too large (max 5MB)' };
  return { ext, mimeType, buf };
}

// Security: set protective headers on every response
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://v2.jokeapi.dev https://uselessfacts.jsph.pl;"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// Security: simple in-memory IP-based rate limiter for login endpoints
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
function checkRateLimit(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    return false;
  }
  recent.push(now);
  loginAttempts.set(ip, recent);
  return true;
}
// Prune stale rate-limit entries every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of loginAttempts) {
    const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) loginAttempts.delete(ip);
    else loginAttempts.set(ip, recent);
  }
}, 5 * 60 * 1000).unref();

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        req.destroy();
        const err = new Error('Request body too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(body); } });
    req.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

// Parse JSON body; sends 400 and returns null on failure (caller must check)
async function parseJsonBody(req, res) {
  const body = await readBody(req);
  try {
    return JSON.parse(body || '{}');
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return null;
  }
}

function readBrandsFileSync() {
  let brandsData = { brands: [] };
  try {
    const existing = fs.readFileSync(BRANDS_JSON_PATH, 'utf8');
    brandsData = JSON.parse(existing);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!Array.isArray(brandsData.brands)) brandsData.brands = [];
  return brandsData;
}

function ensureBrandAccountId(brandsData, cb) {
  let updated = false;
  const used = new Set((brandsData.brands || []).map((b) => b.accountIdPrefix).filter(Boolean));
  function nextUnique() {
    let n = Math.floor(100000 + Math.random() * 900000);
    while (used.has(String(n))) n = Math.floor(100000 + Math.random() * 900000);
    used.add(String(n));
    return String(n);
  }
  brandsData.brands = (brandsData.brands || []).map((b) => {
    if (b.accountIdPrefix && b.accountIdPrefix.length >= 6) return b;
    const prefix = nextUnique();
    updated = true;
    return { ...b, accountIdPrefix: prefix.slice(0, 6) };
  });
  if (!updated) return cb(null, brandsData);
  fs.writeFile(BRANDS_JSON_PATH, JSON.stringify(brandsData, null, 2), 'utf8', (err) => {
    if (err) return cb(err, null);
    cb(null, brandsData);
  });
}

function readBrandsData(cb) {
  fs.readFile(BRANDS_JSON_PATH, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT') return cb(err, null);
    let brandsData = { brands: [] };
    if (!err && data) {
      try {
        brandsData = JSON.parse(data);
      } catch (e) {
        return cb(e, null);
      }
    }
    if (!Array.isArray(brandsData.brands)) brandsData.brands = [];
    brandsData.brands = brandsData.brands.map((b) => ({
      ...b,
      active: b.active !== false,
    }));
    cb(null, brandsData);
  });
}

async function getWorkspaceBrandsSorted(workspaceId) {
  const db = getDb();
  const wid = typeof workspaceId === 'string' ? new ObjectId(workspaceId) : workspaceId;
  const list = await db
    .collection('brands')
    .find({ workspaceId: wid })
    .sort({ createdAt: 1 })
    .toArray();
  return list.map((b) => ({
    name: b.name,
    logoPath: b.logoPath,
    accountIdPrefix: b.accountIdPrefix,
    active: b.active !== false,
    _id: b._id,
  }));
}

async function brandAtWorkspaceIndex(workspaceId, index) {
  const list = await getWorkspaceBrandsSorted(workspaceId);
  if (index < 0 || index >= list.length) return null;
  return { brand: list[index], mongoDoc: await getDb().collection('brands').findOne({ _id: list[index]._id }) };
}

async function nextAccountPrefixForWorkspace(workspaceId) {
  const db = getDb();
  const wid = typeof workspaceId === 'string' ? new ObjectId(workspaceId) : workspaceId;
  const used = new Set(
    (await db.collection('brands').find({ workspaceId: wid }).project({ accountIdPrefix: 1 }).toArray()).map(
      (b) => b.accountIdPrefix
    )
  );
  let prefix;
  do {
    prefix = String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
  } while (used.has(prefix));
  return prefix;
}

async function findBrandGloballyByName(brandName) {
  const db = getDb();
  const trimmed = String(brandName).trim();
  if (!trimmed) return null;
  return db.collection('brands').findOne({
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
  });
}

function writeDataJson(res, metrics, campaignOverrides) {
  const { clicks, impressions, ctr, cpc, cost } = metrics;
  fs.readFile(DATA_JSON_PATH, 'utf8', (err, data) => {
    let json;
    if (err) {
      if (err.code === 'ENOENT') {
        json = { campaign: {} };
      } else {
        sendJson(res, 500, { error: 'Could not read data.json' });
        return;
      }
    } else {
      try {
        json = JSON.parse(data);
      } catch (e) {
        sendJson(res, 500, { error: 'Invalid data.json' });
        return;
      }
    }
    if (!json.campaign) json.campaign = {};
    json.campaign.clicks = formatWithCommas(clicks);
    json.campaign.impressions = formatWithCommas(impressions);
    json.campaign.ctr = ctr;
    json.campaign.cpc = cpc;
    json.campaign.cost = formatWithCommas(parseFloat(cost.toFixed(2)));
    if (campaignOverrides) {
      if (campaignOverrides.accountId != null) json.campaign.accountId = campaignOverrides.accountId;
      if (campaignOverrides.date != null) json.campaign.date = campaignOverrides.date;
      if (campaignOverrides.campaignName != null) json.campaign.campaignName = campaignOverrides.campaignName;
      if (campaignOverrides.imagePath != null) json.campaign.imagePath = campaignOverrides.imagePath;
      if (campaignOverrides.imageFilename != null) json.campaign.imageFilename = campaignOverrides.imageFilename;
    }
    fs.writeFile(DATA_JSON_PATH, JSON.stringify(json, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        sendJson(res, 500, { error: 'Could not write data.json' });
        return;
      }
      sendJson(res, 200, { success: true });
    });
  });
}

async function handleUpdateDataMongo(req, res, payload) {
  const { clicks, impressions, ctr, cpc, cost, brandName } = payload;
  const metrics = { clicks, impressions, ctr, cpc, cost };

  if (!brandName || typeof brandName !== 'string' || !brandName.trim()) {
    writeDataJson(res, metrics, null);
    return;
  }

  try {
    const brand = await findBrandGloballyByName(brandName);
    if (!brand || !brand.accountIdPrefix) {
      writeDataJson(res, metrics, null);
      return;
    }
    const logoPath = brand.logoPath ? `/${String(brand.logoPath).replace(/^\//, '')}` : '';

    // Save spend record to history — fire-and-forget, don't block response
    getDb().collection('brand_spend_history').insertOne({
      brandName: brand.name.trim(),
      date: getYesterdayISTKey(),
      cost: typeof cost === 'number' ? cost : parseFloat(cost),
      timestamp: new Date(),
    }).catch((e) => console.error('spend_history insert error:', e));

    writeDataJson(res, metrics, {
      accountId: formatAccountId(brand.accountIdPrefix),
      date: getYesterdayIST(),
      campaignName: brand.name.trim(),
      imagePath: logoPath || undefined,
      imageFilename: logoPath ? path.basename(brand.logoPath) : undefined,
    });
  } catch (e) {
    sendJson(res, 500, { error: 'Could not resolve brand' });
  }
}

async function handleUpdateData(req, res) {
  if (!requireInternalSession(req, res)) return;
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const validationError = validateDataUpdate(payload);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }
  const { clicks, impressions, ctr, cpc, cost, brandName } = payload;
  const metrics = { clicks, impressions, ctr, cpc, cost };

  if (isConnected()) {
    await handleUpdateDataMongo(req, res, payload);
    return;
  }

  if (!brandName || typeof brandName !== 'string' || !brandName.trim()) {
    writeDataJson(res, metrics, null);
    return;
  }
  readBrandsData((err, brandsData) => {
    if (err) {
      sendJson(res, 500, { error: 'Could not read brands' });
      return;
    }
    ensureBrandAccountId(brandsData, (ensureErr, data) => {
      if (ensureErr || !data) {
        sendJson(res, 500, { error: 'Could not resolve brands' });
        return;
      }
      const brand = data.brands.find(
        (b) => b.name && b.name.trim().toLowerCase() === String(brandName).trim().toLowerCase()
      );
      if (!brand || !brand.accountIdPrefix) {
        writeDataJson(res, metrics, null);
        return;
      }
      const logoPath = brand.logoPath ? `/${brand.logoPath.replace(/^\//, '')}` : '';
      writeDataJson(res, metrics, {
        accountId: formatAccountId(brand.accountIdPrefix),
        date: getYesterdayIST(),
        campaignName: brand.name.trim(),
        imagePath: logoPath || undefined,
        imageFilename: logoPath ? path.basename(brand.logoPath) : undefined,
      });
    });
  });
}

async function handleLogin(req, res) {
  if (!checkRateLimit(req, res)) return;
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { username, password } = payload;
  const userPassError = validateUserPass(payload);
  if (userPassError) {
    sendJson(res, 400, { error: userPassError });
    return;
  }

  if (!isConnected()) {
    if (!ALLOW_LEGACY_FILE_AUTH) {
      sendJson(res, 503, { error: 'Legacy file-based auth is disabled. Configure MONGODB_URI.' });
      return;
    }
    fs.readFile(CREDENTIALS_PATH, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          sendJson(res, 503, { error: 'Credentials not configured. Add credentials.json or set MONGODB_URI.' });
        } else {
          sendJson(res, 500, { error: 'Unable to verify credentials' });
        }
        return;
      }
      let creds;
      try {
        creds = JSON.parse(data);
      } catch (e) {
        sendJson(res, 500, { error: 'Invalid credentials file' });
        return;
      }
      const users = creds.users || [];
      const found = users.find(
        (u) => u.username && u.password && String(u.username).trim() === username.trim() && u.password === password
      );
      if (found) {
        sendJson(res, 200, { success: true });
      } else {
        sendJson(res, 401, { success: false, error: 'Invalid username or password' });
      }
    });
    return;
  }

  const db = getDb();
  const usersCol = db.collection('internal_users');
  let user = await usersCol.findOne({ username: username.trim() });

  if (!user) {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
      const creds = JSON.parse(raw);
      const fileUsers = creds.users || [];
      const match = fileUsers.find(
        (u) =>
          u &&
          u.username &&
          u.password &&
          String(u.username).trim() === username.trim() &&
          u.password === password
      );
      if (match) {
        const count = await usersCol.countDocuments();
        const ws = await db.collection('workspaces').insertOne({ createdAt: new Date() });
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const role = count === 0 ? 'admin' : 'user';
        const ins = await usersCol.insertOne({
          username: username.trim(),
          passwordHash,
          workspaceId: ws.insertedId,
          role,
          createdAt: new Date(),
        });
        user = await usersCol.findOne({ _id: ins.insertedId });
      }
    } catch (e) {
      /* no file or invalid */
    }
  }

  if (!user) {
    sendJson(res, 401, { success: false, error: 'Invalid username or password' });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    sendJson(res, 401, { success: false, error: 'Invalid username or password' });
    return;
  }

  setSessionCookie(res, req, {
    u: user._id.toString(),
    w: user.workspaceId.toString(),
    r: user.role || 'user',
  });
  sendJson(res, 200, { success: true, username: user.username, role: user.role || 'user' });
}

function handleLogout(req, res) {
  clearSessionCookie(res);
  sendJson(res, 200, { success: true });
}

async function handleMe(req, res) {
  if (!isConnected()) {
    sendJson(res, 200, { authenticated: false });
    return;
  }
  const sess = getInternalSession(req);
  if (!sess) {
    sendJson(res, 200, { authenticated: false });
    return;
  }
  const db = getDb();
  const user = await db.collection('internal_users').findOne({ _id: new ObjectId(sess.userId) });
  if (!user) {
    clearSessionCookie(res);
    sendJson(res, 200, { authenticated: false });
    return;
  }
  sendJson(res, 200, {
    authenticated: true,
    userId: user._id.toString(),
    username: user.username,
    role: user.role || 'user',
    workspaceId: user.workspaceId.toString(),
  });
}

async function handleInternalUsers(req, res) {
  if (!isConnected()) {
    mongoRequired(res);
    return;
  }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { username, password } = payload;
  const userPassError = validateUserPass(payload);
  if (userPassError) {
    sendJson(res, 400, { error: userPassError });
    return;
  }
  if (password.length < 8) {
    sendJson(res, 400, { error: 'Password must be at least 8 characters' });
    return;
  }
  const db = getDb();
  const usersCol = db.collection('internal_users');
  const exists = await usersCol.findOne({ username: username.trim() });
  if (exists) {
    sendJson(res, 409, { error: 'Username already exists' });
    return;
  }
  const ws = await db.collection('workspaces').insertOne({ createdAt: new Date() });
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await usersCol.insertOne({
    username: username.trim(),
    passwordHash,
    workspaceId: ws.insertedId,
    role: 'user',
    createdAt: new Date(),
  });
  sendJson(res, 200, { success: true });
}

async function handleAdminBrands(req, res) {
  if (!isConnected()) {
    sendJson(res, 503, { error: 'MongoDB is required for the admin directory.' });
    return;
  }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const db = getDb();
  const users = await db.collection('internal_users').find({}).toArray();
  const widToOwner = new Map();
  users.forEach((u) => {
    widToOwner.set(u.workspaceId.toString(), {
      username: u.username,
      role: u.role || 'user',
    });
  });
  const allBrands = await db.collection('brands').find({}).sort({ createdAt: 1 }).toArray();
  const out = allBrands.map((b) => {
    const owner = widToOwner.get(b.workspaceId.toString()) || { username: '—', role: '' };
    return {
      id: b._id.toString(),
      name: b.name,
      logoPath: b.logoPath,
      accountIdPrefix: b.accountIdPrefix,
      active: b.active !== false,
      ownerUsername: owner.username,
      ownerRole: owner.role,
    };
  });
  out.sort((a, b) => {
    const ou = a.ownerUsername.localeCompare(b.ownerUsername);
    if (ou !== 0) return ou;
    return a.name.localeCompare(b.name);
  });
  sendJson(res, 200, { brands: out });
}

async function handleAdminTeam(req, res) {
  if (!isConnected()) {
    mongoRequired(res);
    return;
  }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const db = getDb();
  const users = await db.collection('internal_users').find({}).sort({ username: 1 }).toArray();
  const counts = await db
    .collection('brands')
    .aggregate([
      { $match: { active: { $ne: false } } },
      { $group: { _id: '$workspaceId', n: { $sum: 1 } } },
    ])
    .toArray();
  const countByWs = new Map(counts.map((c) => [c._id.toString(), c.n]));
  const members = users.map((u) => ({
    id: u._id.toString(),
    username: u.username,
    role: u.role || 'user',
    activeBrandCount: countByWs.get(u.workspaceId.toString()) || 0,
  }));
  sendJson(res, 200, { members });
}

async function deleteWorkspaceAndBrands(db, workspaceId) {
  const wid = typeof workspaceId === 'string' ? new ObjectId(workspaceId) : workspaceId;
  const brands = await db.collection('brands').find({ workspaceId: wid }).toArray();
  for (const brand of brands) {
    const logoPath = path.join(PUBLIC_DIR, brand.logoPath);
    await db.collection('client_dashboard_users').deleteMany({ brandId: brand._id });
    await db.collection('brands').deleteOne({ _id: brand._id });
    safeUnlink(logoPath);
  }
  await db.collection('client_dashboard_users').deleteMany({ workspaceId: wid });
  await db.collection('workspaces').deleteOne({ _id: wid });
}

async function handleDeleteInternalUser(req, res) {
  if (!isConnected()) {
    mongoRequired(res);
    return;
  }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const userId = payload.userId;
  if (!userId || typeof userId !== 'string') {
    sendJson(res, 400, { error: 'userId is required' });
    return;
  }
  const trimmed = userId.trim();
  if (trimmed === sess.userId) {
    sendJson(res, 400, { error: 'You cannot remove your own account' });
    return;
  }
  let targetOid;
  try {
    targetOid = new ObjectId(trimmed);
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid userId' });
    return;
  }
  const db = getDb();
  const usersCol = db.collection('internal_users');
  const target = await usersCol.findOne({ _id: targetOid });
  if (!target) {
    sendJson(res, 404, { error: 'User not found' });
    return;
  }
  if (target.role === 'admin') {
    const adminCount = await usersCol.countDocuments({ role: 'admin' });
    if (adminCount <= 1) {
      sendJson(res, 400, { error: 'Cannot remove the last administrator' });
      return;
    }
  }
  try {
    await deleteWorkspaceAndBrands(db, target.workspaceId);
    await usersCol.deleteOne({ _id: target._id });
  } catch (e) {
    sendJson(res, 500, { error: 'Could not remove user' });
    return;
  }
  sendJson(res, 200, { success: true });
}

async function handleChangePassword(req, res) {
  if (!isConnected()) {
    mongoRequired(res);
    return;
  }
  const sess = getInternalSession(req);
  if (!sess) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { currentPassword, newPassword } = payload;
  const passwordChangeError = validatePasswordChange(payload);
  if (passwordChangeError) {
    sendJson(res, 400, { error: passwordChangeError });
    return;
  }
  const db = getDb();
  const usersCol = db.collection('internal_users');
  const user = await usersCol.findOne({ _id: new ObjectId(sess.userId) });
  if (!user || !user.passwordHash) {
    sendJson(res, 404, { error: 'User not found' });
    return;
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    sendJson(res, 401, { error: 'Current password is incorrect' });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  try {
    await usersCol.updateOne({ _id: user._id }, { $set: { passwordHash } });
  } catch (e) {
    sendJson(res, 500, { error: 'Could not update password' });
    return;
  }
  sendJson(res, 200, { success: true });
}

async function handleAddBrandMongo(req, res, payload) {
  const sess = getInternalSession(req);
  if (!sess) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const {
    brandName,
    logo,
    createClientDashboard,
    clientUsername,
    clientPassword,
  } = payload;

  if (!brandName || typeof brandName !== 'string' || !brandName.trim()) {
    sendJson(res, 400, { error: 'Brand name is required' });
    return;
  }
  if (!logo || typeof logo !== 'string' || !logo.startsWith('data:image/')) {
    sendJson(res, 400, { error: 'Logo must be an image (data URL)' });
    return;
  }

  const wantClient = !!createClientDashboard;
  if (wantClient) {
    if (!clientUsername || typeof clientUsername !== 'string' || !clientUsername.trim()) {
      sendJson(res, 400, { error: 'Client username is required when creating a client dashboard' });
      return;
    }
    if (!clientPassword || typeof clientPassword !== 'string' || clientPassword.length < 8) {
      sendJson(res, 400, { error: 'Client password must be at least 8 characters' });
      return;
    }
  }

  const parsedLogo = parseImageDataUrl(logo);
  if (parsedLogo.error) {
    sendJson(res, 400, { error: parsedLogo.error });
    return;
  }
  const { ext, mimeType, buf } = parsedLogo;

  const db = getDb();
  const workspaceId = new ObjectId(sess.workspaceId);
  const addedByUserId = new ObjectId(sess.userId);

  let prefix;
  try {
    prefix = await nextAccountPrefixForWorkspace(workspaceId);
  } catch (e) {
    sendJson(res, 500, { error: 'Could not allocate account prefix' });
    return;
  }

  const slug = slugify(brandName);
  const filename = `${slug}-${Date.now()}.${ext}`;
  const logoUrlPath = `/api/brands/logo`;

  if (wantClient) {
    const dup = await db.collection('client_dashboard_users').findOne({ username: clientUsername.trim() });
    if (dup) {
      sendJson(res, 409, { error: 'Client username already exists' });
      return;
    }
  }

  const brandDoc = {
    name: brandName.trim(),
    logoPath: '',
    active: true,
    accountIdPrefix: prefix,
    workspaceId,
    addedByUserId,
    createdAt: new Date(),
  };

  let insertResult;
  try {
    insertResult = await db.collection('brands').insertOne(brandDoc);
  } catch (e) {
    sendJson(res, 500, { error: 'Could not save brand' });
    return;
  }

  const brandId = insertResult.insertedId;
  const brandLogoPath = `${logoUrlPath}/${brandId.toString()}`;
  try {
    await db.collection('brand_assets').updateOne(
      { brandId },
      {
        $set: {
          brandId,
          mimeType,
          filename,
          data: buf,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    await db.collection('brands').updateOne({ _id: brandId }, { $set: { logoPath: brandLogoPath } });
  } catch (e) {
    await db.collection('brands').deleteOne({ _id: brandId });
    sendJson(res, 500, { error: 'Could not save brand logo in MongoDB' });
    return;
  }

  if (wantClient) {
    try {
      const passwordHash = await bcrypt.hash(clientPassword, BCRYPT_ROUNDS);
      await db.collection('client_dashboard_users').insertOne({
        username: clientUsername.trim(),
        passwordHash,
        brandId,
        workspaceId,
        createdAt: new Date(),
      });
    } catch (e) {
      try {
        await db.collection('brands').deleteOne({ _id: brandId });
      } catch (e2) {
        /* ignore */
      }
      try {
        await db.collection('brand_assets').deleteOne({ brandId });
      } catch (e3) {
        /* ignore */
      }
      sendJson(res, 500, { error: e.code === 11000 ? 'Client username already exists' : 'Could not create client login' });
      return;
    }
  }

  sendJson(res, 200, { success: true });
}

async function handleAddBrand(req, res) {
  if (!requireInternalSession(req, res)) return;
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;

  if (isConnected()) {
    await handleAddBrandMongo(req, res, payload);
    return;
  }

  const { brandName, logo } = payload;
  if (!brandName || typeof brandName !== 'string' || !brandName.trim()) {
    sendJson(res, 400, { error: 'Brand name is required' });
    return;
  }
  if (!logo || typeof logo !== 'string' || !logo.startsWith('data:image/')) {
    sendJson(res, 400, { error: 'Logo must be an image (data URL)' });
    return;
  }
  let ext = 'png';
  const m = logo.match(/^data:image\/(\w+);base64,/);
  if (m) ext = m[1].replace('jpeg', 'jpg');
  const base64 = logo.replace(/^data:image\/\w+;base64,/, '');
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid logo image data' });
    return;
  }
  if (buf.length > 5 * 1024 * 1024) {
    sendJson(res, 400, { error: 'Logo image too large (max 5MB)' });
    return;
  }
  const slug = slugify(brandName);
  const filename = `${slug}-${Date.now()}.${ext}`;
  const logoPath = path.join(BRANDS_DIR, filename);
  const logoUrlPath = `brands/${filename}`;
  if (!fs.existsSync(BRANDS_DIR)) {
    fs.mkdirSync(BRANDS_DIR, { recursive: true });
  }
  fs.writeFile(logoPath, buf, (writeFileErr) => {
    if (writeFileErr) {
      sendJson(res, 500, { error: 'Could not save logo file' });
      return;
    }
    let brandsData = { brands: [] };
    try {
      const existing = fs.readFileSync(BRANDS_JSON_PATH, 'utf8');
      brandsData = JSON.parse(existing);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        sendJson(res, 500, { error: 'Could not read brands data' });
        return;
      }
    }
    if (!Array.isArray(brandsData.brands)) brandsData.brands = [];
    const used = new Set(brandsData.brands.map((b) => b.accountIdPrefix).filter(Boolean));
    let prefix = '';
    do {
      prefix = String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
    } while (used.has(prefix));
    brandsData.brands.push({
      name: brandName.trim(),
      logoPath: logoUrlPath,
      active: true,
      accountIdPrefix: prefix,
    });
    fs.writeFile(BRANDS_JSON_PATH, JSON.stringify(brandsData, null, 2), 'utf8', (writeJsonErr) => {
      if (writeJsonErr) {
        sendJson(res, 500, { error: 'Could not save brand list' });
        return;
      }
      sendJson(res, 200, { success: true });
    });
  });
}

async function handleGetBrands(req, res) {
  if (!requireInternalSession(req, res)) return;
  if (isConnected()) {
    const sess = getInternalSession(req);
    try {
      const brands = await getWorkspaceBrandsSorted(sess.workspaceId);
      const out = brands.map((b) => ({
        name: b.name,
        logoPath: b.logoPath,
        accountIdPrefix: b.accountIdPrefix,
        active: b.active,
      }));
      sendJson(res, 200, { brands: out });
    } catch (e) {
      sendJson(res, 500, { error: 'Could not read brands' });
    }
    return;
  }

  readBrandsData((err, brandsData) => {
    if (err) {
      sendJson(res, 500, { error: 'Could not read brands' });
      return;
    }
    sendJson(res, 200, brandsData);
  });
}

async function handlePatchBrand(req, res) {
  const sess = requireInternalSession(req, res);
  if (!sess) return;
  if (!isConnected()) {
    readBody(req).then((body) => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const { index, active } = payload;
      if (typeof index !== 'number' || index < 0 || typeof active !== 'boolean') {
        sendJson(res, 400, { error: 'Body must include index (number) and active (boolean)' });
        return;
      }
      readBrandsData((err, brandsData) => {
        if (err) {
          sendJson(res, 500, { error: 'Could not read brands' });
          return;
        }
        if (index >= brandsData.brands.length) {
          sendJson(res, 404, { error: 'Brand not found' });
          return;
        }
        brandsData.brands[index].active = active;
        fs.writeFile(BRANDS_JSON_PATH, JSON.stringify(brandsData, null, 2), 'utf8', (writeErr) => {
          if (writeErr) {
            sendJson(res, 500, { error: 'Could not update brands' });
            return;
          }
          sendJson(res, 200, { success: true });
        });
      });
    }).catch(() => {
      sendJson(res, 413, { error: 'Request body too large' });
    });
    return;
  }

  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { index, active, brandId } = payload;

  if (sess.role === 'admin' && brandId != null && String(brandId).trim() !== '') {
    if (typeof active !== 'boolean') {
      sendJson(res, 400, { error: 'Body must include active (boolean) with brandId' });
      return;
    }
    let oid;
    try {
      oid = new ObjectId(String(brandId).trim());
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid brandId' });
      return;
    }
    try {
      const result = await getDb().collection('brands').updateOne({ _id: oid }, { $set: { active } });
      if (result.matchedCount === 0) {
        sendJson(res, 404, { error: 'Brand not found' });
        return;
      }
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 500, { error: 'Could not update brand' });
    }
    return;
  }

  if (typeof index !== 'number' || index < 0 || typeof active !== 'boolean') {
    sendJson(res, 400, { error: 'Body must include index (number) and active (boolean)' });
    return;
  }

  const pair = await brandAtWorkspaceIndex(sess.workspaceId, index);
  if (!pair || !pair.mongoDoc) {
    sendJson(res, 404, { error: 'Brand not found' });
    return;
  }
  try {
    await getDb()
      .collection('brands')
      .updateOne({ _id: pair.mongoDoc._id }, { $set: { active } });
    sendJson(res, 200, { success: true });
  } catch (e) {
    sendJson(res, 500, { error: 'Could not update brand' });
  }
}

async function handleReplaceBrandLogo(req, res) {
  const sess = requireInternalSession(req, res);
  if (!sess) return;
  if (!isConnected()) {
    readBody(req).then((body) => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const { index, logo } = payload;
      if (typeof index !== 'number' || index < 0 || !logo || typeof logo !== 'string' || !logo.startsWith('data:image/')) {
        sendJson(res, 400, { error: 'Body must include index (number) and logo (image data URL)' });
        return;
      }
      let ext = 'png';
      const m = logo.match(/^data:image\/(\w+);base64,/);
      if (m) ext = m[1].replace('jpeg', 'jpg');
      const base64 = logo.replace(/^data:image\/\w+;base64,/, '');
      let buf;
      try {
        buf = Buffer.from(base64, 'base64');
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid logo image data' });
        return;
      }
      if (buf.length > 5 * 1024 * 1024) {
        sendJson(res, 400, { error: 'Logo image too large (max 5MB)' });
        return;
      }
      readBrandsData((err, brandsData) => {
        if (err) {
          sendJson(res, 500, { error: 'Could not read brands' });
          return;
        }
        if (index >= brandsData.brands.length) {
          sendJson(res, 404, { error: 'Brand not found' });
          return;
        }
        const brand = brandsData.brands[index];
        const oldPath = path.join(PUBLIC_DIR, brand.logoPath);
        const slug = slugify(brand.name);
        const filename = `${slug}-${Date.now()}.${ext}`;
        const newLogoUrlPath = `brands/${filename}`;
        const newPath = path.join(BRANDS_DIR, filename);
        if (!fs.existsSync(BRANDS_DIR)) {
          fs.mkdirSync(BRANDS_DIR, { recursive: true });
        }
        fs.writeFile(newPath, buf, (writeErr) => {
          if (writeErr) {
            sendJson(res, 500, { error: 'Could not save new logo' });
            return;
          }
          brand.logoPath = newLogoUrlPath;
          fs.writeFile(BRANDS_JSON_PATH, JSON.stringify(brandsData, null, 2), 'utf8', (writeJsonErr) => {
            if (writeJsonErr) {
              sendJson(res, 500, { error: 'Could not update brand' });
              return;
            }
            safeUnlink(oldPath);
            sendJson(res, 200, { success: true, logoPath: newLogoUrlPath });
          });
        });
      });
    }).catch(() => {
      sendJson(res, 413, { error: 'Request body too large' });
    });
    return;
  }

  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { index, logo, brandId } = payload;
  if (!logo || typeof logo !== 'string' || !logo.startsWith('data:image/')) {
    sendJson(res, 400, { error: 'Body must include logo (image data URL)' });
    return;
  }
  const parsedLogo = parseImageDataUrl(logo);
  if (parsedLogo.error) {
    sendJson(res, 400, { error: parsedLogo.error });
    return;
  }
  const { ext, mimeType, buf } = parsedLogo;

  let brand = null;
  if (sess.role === 'admin' && brandId != null && String(brandId).trim() !== '') {
    let oid;
    try {
      oid = new ObjectId(String(brandId).trim());
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid brandId' });
      return;
    }
    brand = await getDb().collection('brands').findOne({ _id: oid });
    if (!brand) {
      sendJson(res, 404, { error: 'Brand not found' });
      return;
    }
  } else {
    if (typeof index !== 'number' || index < 0) {
      sendJson(res, 400, { error: 'Body must include index (number) and logo (image data URL)' });
      return;
    }
    const pair = await brandAtWorkspaceIndex(sess.workspaceId, index);
    if (!pair || !pair.mongoDoc) {
      sendJson(res, 404, { error: 'Brand not found' });
      return;
    }
    brand = pair.mongoDoc;
  }
  const slug = slugify(brand.name);
  const filename = `${slug}-${Date.now()}.${ext}`;
  const newLogoUrlPath = `/api/brands/logo/${brand._id.toString()}`;
  try {
    await getDb()
      .collection('brand_assets')
      .updateOne(
        { brandId: brand._id },
        {
          $set: { brandId: brand._id, mimeType, filename, data: buf, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
    await getDb()
      .collection('brands')
      .updateOne({ _id: brand._id }, { $set: { logoPath: newLogoUrlPath } });
    sendJson(res, 200, { success: true, logoPath: newLogoUrlPath });
  } catch (e) {
    sendJson(res, 500, { error: 'Could not update brand' });
  }
}

async function handleDeleteBrand(req, res) {
  const sess = requireInternalSession(req, res);
  if (!sess) return;
  if (!isConnected()) {
    readBody(req).then((body) => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (e) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const { index } = payload;
      if (typeof index !== 'number' || index < 0) {
        sendJson(res, 400, { error: 'Body must include index (number)' });
        return;
      }
      readBrandsData((err, brandsData) => {
        if (err) {
          sendJson(res, 500, { error: 'Could not read brands' });
          return;
        }
        if (index >= brandsData.brands.length) {
          sendJson(res, 404, { error: 'Brand not found' });
          return;
        }
        const removed = brandsData.brands.splice(index, 1)[0];
        const logoPath = path.join(PUBLIC_DIR, removed.logoPath);
        fs.writeFile(BRANDS_JSON_PATH, JSON.stringify(brandsData, null, 2), 'utf8', (writeErr) => {
          if (writeErr) {
            sendJson(res, 500, { error: 'Could not update brands' });
            return;
          }
          safeUnlink(logoPath);
          sendJson(res, 200, { success: true });
        });
      });
    }).catch(() => {
      sendJson(res, 413, { error: 'Request body too large' });
    });
    return;
  }

  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { index, brandId } = payload;
  let brand = null;

  if (sess.role === 'admin' && brandId != null && String(brandId).trim() !== '') {
    let oid;
    try {
      oid = new ObjectId(String(brandId).trim());
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid brandId' });
      return;
    }
    brand = await getDb().collection('brands').findOne({ _id: oid });
    if (!brand) {
      sendJson(res, 404, { error: 'Brand not found' });
      return;
    }
  } else {
    if (typeof index !== 'number' || index < 0) {
      sendJson(res, 400, { error: 'Body must include index (number)' });
      return;
    }
    const pair = await brandAtWorkspaceIndex(sess.workspaceId, index);
    if (!pair || !pair.mongoDoc) {
      sendJson(res, 404, { error: 'Brand not found' });
      return;
    }
    brand = pair.mongoDoc;
  }

  const db = getDb();
  try {
    await db.collection('client_dashboard_users').deleteMany({ brandId: brand._id });
    await db.collection('brand_assets').deleteOne({ brandId: brand._id });
    await db.collection('brands').deleteOne({ _id: brand._id });
    sendJson(res, 200, { success: true });
  } catch (e) {
    sendJson(res, 500, { error: 'Could not delete brand' });
  }
}

async function handleClientLogin(req, res) {
  if (!isConnected()) {
    sendJson(res, 503, { error: 'MongoDB is not configured' });
    return;
  }
  if (!checkRateLimit(req, res)) return;
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  const { username, password } = payload;
  const userPassError = validateUserPass(payload);
  if (userPassError) {
    sendJson(res, 400, { error: userPassError });
    return;
  }

  const db = getDb();
  const cu = await db.collection('client_dashboard_users').findOne({ username: username.trim() });
  if (!cu) {
    sendJson(res, 401, { success: false, error: 'Invalid username or password' });
    return;
  }
  const ok = await bcrypt.compare(password, cu.passwordHash);
  if (!ok) {
    sendJson(res, 401, { success: false, error: 'Invalid username or password' });
    return;
  }
  const brand = await db.collection('brands').findOne({ _id: cu.brandId });
  if (!brand) {
    sendJson(res, 401, { success: false, error: 'Invalid username or password' });
    return;
  }
  sendJson(res, 200, {
    success: true,
    brandName: brand.name,
    logoPath: brand.logoPath,
  });
}

async function handleBrandLogo(req, res, urlPath) {
  if (!isConnected()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const m = urlPath.match(/^\/api\/brands\/logo\/([a-f0-9]{24})$/i);
  if (!m) {
    sendJson(res, 400, { error: 'Invalid brand id' });
    return;
  }
  let brandId;
  try {
    brandId = new ObjectId(m[1]);
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid brand id' });
    return;
  }
  const asset = await getDb().collection('brand_assets').findOne({ brandId });
  if (!asset || !asset.data) {
    sendJson(res, 404, { error: 'Logo not found' });
    return;
  }
  res.setHeader('Content-Type', asset.mimeType || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.writeHead(200);
  res.end(asset.data.buffer ? Buffer.from(asset.data.buffer) : asset.data);
}

async function handleAdminSpendHistory(req, res) {
  if (!isConnected()) {
    mongoRequired(res);
    return;
  }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  const records = await getDb()
    .collection('brand_spend_history')
    .find({})
    .sort({ date: -1, timestamp: -1 })
    .limit(200)
    .toArray();
  sendJson(res, 200, {
    history: records.map((r) => ({
      brandName: r.brandName,
      date: r.date,
      cost: r.cost,
    })),
  });
}

async function handleArchiveBrands(req, res) {
  if (!isConnected()) { mongoRequired(res); return; }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') { sendJson(res, 403, { error: 'Forbidden' }); return; }
  const db = getDb();
  const users = await db.collection('internal_users').find({}).toArray();
  const widToOwner = new Map();
  users.forEach((u) => { if (u.workspaceId) widToOwner.set(u.workspaceId.toString(), u.username); });
  const allBrands = await db.collection('brands').find({}).sort({ createdAt: 1 }).toArray();
  // Get the most recent spend date per brand
  const latestSpend = await db.collection('brand_spend_history')
    .aggregate([
      { $sort: { brandId: 1, date: -1 } },
      { $group: { _id: '$brandId', lastDate: { $first: '$date' }, lastCost: { $first: '$cost' } } },
    ])
    .toArray();
  const spendMap = new Map();
  latestSpend.forEach((s) => {
    if (s._id) spendMap.set(s._id.toString(), { lastDate: s.lastDate, lastCost: s.lastCost });
  });
  const out = allBrands.map((b) => {
    const spend = spendMap.get(b._id.toString()) || null;
    return {
      id: b._id.toString(),
      name: b.name,
      logoPath: b.logoPath || '',
      active: b.active !== false,
      ownerUsername: (b.workspaceId ? widToOwner.get(b.workspaceId.toString()) : null) || '—',
      lastSpendDate: spend ? spend.lastDate : null,
      lastSpendCost: spend ? spend.lastCost : null,
    };
  });
  sendJson(res, 200, { brands: out });
}

async function handleArchiveHistory(req, res) {
  if (!isConnected()) { mongoRequired(res); return; }
  const sess = getInternalSession(req);
  if (!sess || sess.role !== 'admin') { sendJson(res, 403, { error: 'Forbidden' }); return; }
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const brandId = qs.get('brandId');
  if (!brandId) { sendJson(res, 400, { error: 'brandId is required' }); return; }
  let oid;
  try { oid = new ObjectId(brandId); } catch (e) { sendJson(res, 400, { error: 'Invalid brandId' }); return; }
  const records = await getDb().collection('brand_spend_history')
    .find({ brandId: oid })
    .sort({ date: -1 })
    .toArray();
  sendJson(res, 200, {
    history: records.map((r) => ({
      date: r.date,
      cost: r.cost,
      masterClicks: r.masterClicks || null,
      conversionRate: r.conversionRate || null,
    })),
  });
}

function handleReportData(req, res) {
  if (!requireInternalSession(req, res)) return;
  fs.readFile(DATA_JSON_PATH, 'utf8', (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'No report data available yet' });
      return;
    }
    try {
      sendJson(res, 200, JSON.parse(data));
    } catch (e) {
      sendJson(res, 500, { error: 'Invalid report data' });
    }
  });
}

// --- External API proxy handlers ---
// These forward requests to the external API server-to-server, avoiding CORS.
// GET /api/proxy/reports/<slug>?date=... is handled via regex in the HTTP server below.
// GET/POST /api/proxy/conversions are registered in the route map.

async function handleProxyReport(req, res) {
  const urlPath = req.url.split('?')[0];
  const m = urlPath.match(/^\/api\/proxy\/reports\/([^/]+)$/);
  if (!m) { sendJson(res, 400, { error: 'Invalid slug' }); return; }
  const slug = decodeURIComponent(m[1]);
  const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  try {
    const upstream = await fetch(
      EXTERNAL_API_BASE + '/api/reports/' + encodeURIComponent(slug) + qs,
      { method: 'GET' }
    );
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(upstream.status);
    res.end(body);
  } catch (e) {
    console.error('[proxy] report fetch failed:', e.message);
    sendJson(res, 502, { error: 'Could not reach upstream API' });
  }
}

async function handleProxyConversionsGet(req, res) {
  const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  try {
    const upstream = await fetch(
      EXTERNAL_API_BASE + '/api/conversions' + qs,
      { method: 'GET' }
    );
    const body = await upstream.text();
    if (!upstream.ok) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(upstream.status);
      res.end(body);
      return;
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    if (parsed.dateKey && isConnected()) {
      try {
        const snap = await getDb().collection('conversions_snapshots').findOne({ dateKey: String(parsed.dateKey) });
        parsed.stakeClicks = snap?.stakeClicks ?? null;
      } catch (e) {
        console.error('[proxy] conversions snapshot lookup failed:', e.message);
        parsed.stakeClicks = null;
      }
    } else {
      parsed.stakeClicks = null;
    }
    sendJson(res, upstream.status, parsed);
  } catch (e) {
    console.error('[proxy] conversions GET failed:', e.message);
    sendJson(res, 502, { error: 'Could not reach upstream API' });
  }
}

async function handleProxyConversionsPost(req, res) {
  const payload = await parseJsonBody(req, res);
  if (payload === null) return;
  try {
    const upstream = await fetch(
      EXTERNAL_API_BASE + '/api/conversions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const body = await upstream.text();
    if (upstream.ok) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      const dateKey = String(parsed.dateKey || payload.dateKey || '');
      if (dateKey && isConnected()) {
        try {
          const stakeClicks = await fetchStakeClicksFromUpstream(dateKey);
          await getDb().collection('conversions_snapshots').updateOne(
            { dateKey },
            {
              $set: {
                dateKey,
                conversions: Math.floor(Number(parsed.conversions ?? payload.conversions) || 0),
                stakeClicks,
                updatedAt: parsed.updatedAt || new Date().toISOString(),
                snapshotAt: new Date(),
              },
            },
            { upsert: true }
          );
          console.log('[snapshot] conversions_snapshots upserted for', dateKey, '— stakeClicks:', stakeClicks);
        } catch (err) {
          console.error('[snapshot] conversions_snapshots upsert failed:', err.message);
        }
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(upstream.status);
    res.end(body);
  } catch (e) {
    console.error('[proxy] conversions POST failed:', e.message);
    sendJson(res, 502, { error: 'Could not reach upstream API' });
  }
}

const apiRoutes = buildApiRoutes({
  handleLogin,
  handleLogout,
  handleMe,
  handleChangePassword,
  handleInternalUsers,
  handleDeleteInternalUser,
  handleAdminBrands,
  handleAdminTeam,
  handleUpdateData,
  handleAddBrand,
  handleGetBrands,
  handlePatchBrand,
  handleReplaceBrandLogo,
  handleDeleteBrand,
  handleClientLogin,
  handleProxyConversionsGet,
  handleProxyConversionsPost,
  handleAdminSpendHistory,
  handleArchiveBrands,
  handleArchiveHistory,
  handleReportData,
});

const server = http.createServer((req, res) => {
  const start = Date.now();
  setSecurityHeaders(res);
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
  });

  let urlPath = req.url === '/' ? '/Login.html' : req.url;
  urlPath = urlPath.split('?')[0];
  if (req.method === 'GET' && /^\/api\/proxy\/reports\/[^/]+$/.test(urlPath)) {
    handleProxyReport(req, res).catch((e) => {
      console.error(e);
      sendJson(res, 500, { error: 'Error' });
    });
    return;
  }
  if (req.method === 'GET' && /^\/api\/brands\/logo\/[a-f0-9]{24}$/i.test(urlPath)) {
    handleBrandLogo(req, res, urlPath).catch((e) => {
      console.error(e);
      sendJson(res, 500, { error: 'Error' });
    });
    return;
  }
  // Serve root-level data.json for final.html (which fetches it via relative URL)
  if (req.method === 'GET' && urlPath === '/data.json') {
    fs.readFile(DATA_JSON_PATH, (err, data) => {
      if (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200);
      res.end(data);
    });
    return;
  }

  const routeKey = `${req.method} ${urlPath}`;
  const routeHandler = apiRoutes.get(routeKey);
  if (routeHandler) {
    Promise.resolve(routeHandler(req, res)).catch((e) => {
      if (e.statusCode === 413) {
        sendJson(res, 413, { error: 'Request body too large' });
      } else {
        console.error(e);
        sendJson(res, 500, { error: 'Error' });
      }
    });
    return;
  }

  // final.html is a saved Google Ads page that requires external gstatic.com scripts
  if (urlPath === '/final.html') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://ssl.gstatic.com https://apis.google.com; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://www.gstatic.com https://lh3.googleusercontent.com;"
    );
  }

  const relativePath = urlPath.replace(/^\//, '') || 'index.html';
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  const rel = path.relative(PUBLIC_DIR, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        const notFoundPath = path.join(PUBLIC_DIR, '404.html');
        fs.readFile(notFoundPath, (notFoundErr, notFoundData) => {
          if (notFoundErr) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
          res.setHeader('Content-Type', 'text/html');
          res.writeHead(404);
          res.end(notFoundData);
        });
        return;
      }
      res.writeHead(500);
      res.end('Server Error');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.writeHead(200);
    res.end(data);
  });
});

if (!fs.existsSync(BRANDS_DIR)) {
  fs.mkdirSync(BRANDS_DIR, { recursive: true });
}

function startServer() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}/`);
    console.log(`  Root:       http://localhost:${PORT}/ (Login)`);
    console.log(`  Login:      http://localhost:${PORT}/Login.html`);
    console.log(`  Dashboard:  http://localhost:${PORT}/Dashboard.html`);
    console.log(`  Reporting:  http://localhost:${PORT}/Reporting.html`);
    console.log(`  Add Brand:  http://localhost:${PORT}/AddBrand.html`);
    console.log(`  Directory:  http://localhost:${PORT}/Directory.html`);
    console.log(`  Calculator: http://localhost:${PORT}/saver.html`);
    console.log(`  Team:       http://localhost:${PORT}/Users.html`);
    console.log(`  Client login: http://localhost:${PORT}/ClientLogin.html`);
    console.log(`  Client dash: http://localhost:${PORT}/ClientDashboard.html`);
    if (!isConnected()) {
      if (ALLOW_LEGACY_FILE_AUTH && !fs.existsSync(CREDENTIALS_PATH)) {
        console.warn('  Warning: credentials.json not found — set MONGODB_URI or add credentials.json for legacy mode.');
      }
      if (!ALLOW_LEGACY_FILE_AUTH) {
        console.warn('  Legacy file login is disabled. Configure MONGODB_URI for internal authentication.');
      }
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

const { closeDb } = require('./db');
function shutdown() {
  console.log('Shutting down gracefully...');
  server.close(() => {
    closeDb().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  if (!SESSION_SECRET) {
    console.error('SESSION_SECRET is required. Set it in .env before starting the server.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await connectMongo(uri);
      await bootstrapInitialAdmin();
    } catch (e) {
      console.error('MongoDB connection failed:', e.message);
      process.exit(1);
    }
  } else {
    if (ALLOW_LEGACY_FILE_AUTH) {
      console.warn('  MONGODB_URI not set — using legacy file-based mode because ALLOW_LEGACY_FILE_AUTH=true.');
    } else {
      console.warn('  MONGODB_URI not set — internal login is disabled until MongoDB is configured.');
    }
  }
  startServer();
  startDailyCron();
})();

// ── Daily spend cron ────────────────────────────────────────────────────────
// Runs at 23:59 IST every day. Fetches masterclicks + conversions from the
// external API for today, then computes and stores cost for every active brand.
let _lastCronDateKey = null;

function getISTDateKey(d) {
  var dt = new Date((d || new Date()).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return dt.getFullYear() + '-' +
    String(dt.getMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getDate()).padStart(2, '0');
}

function getISTHHMM(d) {
  var dt = new Date((d || new Date()).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return dt.getHours() * 100 + dt.getMinutes(); // e.g. 2359
}

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
  return res.json();
}

async function fetchStakeClicksFromUpstream(dateKey) {
  try {
    const url = EXTERNAL_API_BASE + '/api/reports/' + encodeURIComponent(STAKE_REPORT_SLUG) + '?date=' + encodeURIComponent(dateKey);
    const report = await fetchJson(url);
    const groupData = Array.isArray(report?.groupData) ? report.groupData : [];
    const stakeRow = groupData.find((r) => String(r.group || '').trim().toLowerCase() === 'stake');
    const clicks = Number(stakeRow?.clicks);
    return Number.isFinite(clicks) && clicks >= 0 ? Math.floor(clicks) : null;
  } catch (e) {
    console.error('[snapshot] fetchStakeClicksFromUpstream failed:', e.message);
    return null;
  }
}

async function runDailySpendCron(dateKey) {
  if (!isConnected()) { console.log('[cron] MongoDB not connected — skipping daily spend run.'); return; }
  console.log('[cron] Starting daily spend calculation for', dateKey);
  try {
    const API_BASE = EXTERNAL_API_BASE;
    const MIN_RATE = 0.05, MAX_RATE = 0.30;

    // Fetch report + conversions in parallel
    let reportData, convData;
    try {
      [reportData, convData] = await Promise.all([
        fetchJson(API_BASE + '/api/reports/' + encodeURIComponent(STAKE_REPORT_SLUG) + '?date=' + encodeURIComponent(dateKey)),
        fetchJson(API_BASE + '/api/conversions?date=' + encodeURIComponent(dateKey)),
      ]);
    } catch (e) {
      console.error('[cron] API fetch failed:', e.message);
      return;
    }

    const groupData = Array.isArray(reportData.groupData) ? reportData.groupData : [];
    const conversions = Number(convData.conversions);
    const stakeRow = groupData.find((r) => String(r.group || '').trim().toLowerCase() === 'stake');
    const stakeClicks = stakeRow ? Number(stakeRow.clicks) || 0 : 0;

    if (stakeClicks <= 0 || !Number.isFinite(conversions) || conversions <= 0) {
      console.warn('[cron] Skipping — stakeClicks=%d conversions=%d', stakeClicks, conversions);
      return;
    }

    const rawRate = conversions / stakeClicks;
    const conversionRate = Math.max(MIN_RATE, Math.min(MAX_RATE, rawRate));

    const db = getDb();
    const allBrands = await db.collection('brands').find({ active: { $ne: false } }).toArray();
    console.log('[cron] Processing %d active brands', allBrands.length);

    const ops = [];
    for (const brand of allBrands) {
      const needle = brand.name.trim().toLowerCase();
      const row = groupData.find((r) => String(r.group || '').trim().toLowerCase() === needle);
      const masterClicks = row ? (Number(row.clicks) || 0) : 0;
      const mult = Math.floor(Math.random() * 51) + 725; // 725-775
      const cost = masterClicks * conversionRate * mult;

      // Upsert — one record per brand per date
      ops.push(db.collection('brand_spend_history').updateOne(
        { brandId: brand._id, date: dateKey },
        {
          $set: {
            brandId: brand._id,
            brandName: brand.name.trim(),
            date: dateKey,
            cost,
            masterClicks,
            conversionRate,
            timestamp: new Date(),
          },
        },
        { upsert: true }
      ));
    }
    await Promise.all(ops);
    console.log('[cron] Daily spend saved for', allBrands.length, 'brands on', dateKey);
  } catch (e) {
    console.error('[cron] Error during daily spend run:', e);
  }
}

function startDailyCron() {
  setInterval(() => {
    const now = new Date();
    const hhmm = getISTHHMM(now);
    const dateKey = getISTDateKey(now);
    if (hhmm === 2359 && _lastCronDateKey !== dateKey) {
      _lastCronDateKey = dateKey;
      runDailySpendCron(dateKey).catch((e) => console.error('[cron] Unhandled:', e));
    }
  }, 60 * 1000).unref();
  console.log('[cron] Daily spend cron scheduled (fires at 23:59 IST).');
}
