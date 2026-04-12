const { MongoClient, ObjectId } = require('mongodb');

let client;
let db;

const DB_NAME = process.env.MONGODB_DB || 'gads_report';

async function connectMongo(uri) {
  if (!uri) throw new Error('MONGODB_URI is required');
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(DB_NAME);
  await ensureIndexes();
  return db;
}

function getDb() {
  return db;
}

function isConnected() {
  return !!db && !!client;
}

async function closeDb() {
  if (client) {
    try {
      await client.close();
    } catch (e) {
      // ignore close errors during shutdown
    }
  }
}

async function ensureIndexes() {
  await db.collection('internal_users').createIndex({ username: 1 }, { unique: true });
  await db.collection('brands').createIndex({ workspaceId: 1, createdAt: 1 });
  await db.collection('brands').createIndex({ workspaceId: 1, accountIdPrefix: 1 });
  await db.collection('brand_assets').createIndex({ brandId: 1 }, { unique: true });
  await db.collection('client_dashboard_users').createIndex({ username: 1 }, { unique: true });
  await db.collection('client_dashboard_users').createIndex({ brandId: 1 });
  await db.collection('brand_spend_history').createIndex({ date: -1, brandName: 1 });
  await db.collection('brand_spend_history').createIndex({ brandId: 1, date: -1 });
}

async function bootstrapInitialAdmin() {
  const users = db.collection('internal_users');
  const count = await users.countDocuments();
  if (count > 0) return { created: false };

  const u = process.env.INITIAL_ADMIN_USERNAME;
  const p = process.env.INITIAL_ADMIN_PASSWORD;
  if (!u || !p || typeof u !== 'string' || !p.length) {
    console.warn(
      '  MongoDB: no internal users. Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD to create the first admin, or migrate by logging in with credentials.json.'
    );
    return { created: false };
  }

  const bcrypt = require('bcryptjs');
  const BCRYPT_ROUNDS = 10;
  const ws = await db.collection('workspaces').insertOne({ createdAt: new Date() });
  const passwordHash = await bcrypt.hash(p, BCRYPT_ROUNDS);
  await users.insertOne({
    username: u.trim(),
    passwordHash,
    workspaceId: ws.insertedId,
    role: 'admin',
    createdAt: new Date()
  });
  console.log('  MongoDB: created initial admin user and workspace.');
  return { created: true };
}

module.exports = {
  connectMongo,
  getDb,
  isConnected,
  closeDb,
  ObjectId,
  bootstrapInitialAdmin
};
