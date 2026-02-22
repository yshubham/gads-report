const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

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

function sendJson(res, statusCode, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(statusCode);
  res.end(JSON.stringify(obj));
}

function formatWithCommas(num) {
  return Number(num).toLocaleString('en-IN');
}

function getYesterdayIST() {
  const d = new Date();
  const yesterday = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatAccountId(prefix6) {
  const s = String(prefix6).padStart(6, '0').slice(0, 6);
  return s.slice(0, 3) + '-' + s.slice(3, 6) + '-KVZONE';
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

const DATA_JSON_PATH = path.join(PUBLIC_DIR, 'data.json');
const BRANDS_JSON_PATH = path.join(PUBLIC_DIR, 'brands.json');
const BRANDS_DIR = path.join(PUBLIC_DIR, 'brands');
const CREDENTIALS_PATH = path.join(PUBLIC_DIR, 'credentials.json');

function handleUpdateData(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const { clicks, impressions, ctr, cpc, cost, brandName } = payload;
    if (
      typeof clicks !== 'number' ||
      typeof impressions !== 'number' ||
      typeof ctr !== 'number' ||
      typeof cpc !== 'number' ||
      typeof cost !== 'number'
    ) {
      sendJson(res, 400, { error: 'Missing or invalid fields: clicks, impressions, ctr, cpc, cost (all numbers)' });
      return;
    }
    function writeDataJson(campaignOverrides) {
      fs.readFile(DATA_JSON_PATH, 'utf8', (err, data) => {
        if (err) {
          sendJson(res, 500, { error: 'Could not read data.json' });
          return;
        }
        let json;
        try {
          json = JSON.parse(data);
        } catch (e) {
          sendJson(res, 500, { error: 'Invalid data.json' });
          return;
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
    if (!brandName || typeof brandName !== 'string' || !brandName.trim()) {
      writeDataJson(null);
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
        const brand = data.brands.find((b) => b.name && b.name.trim().toLowerCase() === String(brandName).trim().toLowerCase());
        if (!brand || !brand.accountIdPrefix) {
          writeDataJson(null);
          return;
        }
        const logoPath = brand.logoPath ? '/' + brand.logoPath.replace(/^\//, '') : '';
        writeDataJson({
          accountId: formatAccountId(brand.accountIdPrefix),
          date: getYesterdayIST(),
          campaignName: brand.name.trim(),
          imagePath: logoPath || undefined,
          imageFilename: logoPath ? path.basename(brand.logoPath) : undefined
        });
      });
    });
  });
}

function slugify(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'brand';
}

function handleAddBrand(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid JSON body' });
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
    let base64 = logo.replace(/^data:image\/\w+;base64,/, '');
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
        accountIdPrefix: prefix
      });
      fs.writeFile(BRANDS_JSON_PATH, JSON.stringify(brandsData, null, 2), 'utf8', (writeJsonErr) => {
        if (writeJsonErr) {
          sendJson(res, 500, { error: 'Could not save brand list' });
          return;
        }
        sendJson(res, 200, { success: true });
      });
    });
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
      active: b.active !== false
    }));
    cb(null, brandsData);
  });
}

function handleGetBrands(req, res) {
  readBrandsData((err, brandsData) => {
    if (err) {
      sendJson(res, 500, { error: 'Could not read brands' });
      return;
    }
    sendJson(res, 200, brandsData);
  });
}

function handlePatchBrand(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
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
  });
}

function handleReplaceBrandLogo(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
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
          fs.unlink(oldPath, () => {});
          sendJson(res, 200, { success: true, logoPath: newLogoUrlPath });
        });
      });
    });
  });
}

function handleDeleteBrand(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
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
        fs.unlink(logoPath, () => {});
        sendJson(res, 200, { success: true });
      });
    });
  });
}

function handleLogin(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid request' });
      return;
    }
    const { username, password } = payload;
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      sendJson(res, 400, { error: 'Username and password are required' });
      return;
    }
    fs.readFile(CREDENTIALS_PATH, 'utf8', (err, data) => {
      if (err) {
        sendJson(res, 500, { error: 'Unable to verify credentials' });
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
  });
}

const server = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/final.html' : req.url;
  urlPath = urlPath.split('?')[0];

  if (req.method === 'POST' && urlPath === '/api/login') {
    handleLogin(req, res);
    return;
  }
  if (req.method === 'POST' && urlPath === '/api/update-data') {
    handleUpdateData(req, res);
    return;
  }
  if (req.method === 'POST' && urlPath === '/api/add-brand') {
    handleAddBrand(req, res);
    return;
  }
  if (req.method === 'GET' && urlPath === '/api/brands') {
    handleGetBrands(req, res);
    return;
  }
  if (req.method === 'PATCH' && urlPath === '/api/brands') {
    handlePatchBrand(req, res);
    return;
  }
  if (req.method === 'PATCH' && urlPath === '/api/brands/logo') {
    handleReplaceBrandLogo(req, res);
    return;
  }
  if (req.method === 'DELETE' && urlPath === '/api/brands') {
    handleDeleteBrand(req, res);
    return;
  }
  const filePath = path.join(PUBLIC_DIR, urlPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}/`);
  console.log(`  Main app:  http://localhost:${PORT}/ (final.html)`);
  console.log(`  Calculator: http://localhost:${PORT}/saver.html`);
  console.log(`  Reporting:  http://localhost:${PORT}/Reporting.html`);
  console.log(`  Add Brand:  http://localhost:${PORT}/AddBrand.html`);
  console.log(`  Directory:  http://localhost:${PORT}/Directory.html`);
  console.log(`  Login:      http://localhost:${PORT}/Login.html`);
  console.log(`  Dashboard:  http://localhost:${PORT}/Dashboard.html`);
});
