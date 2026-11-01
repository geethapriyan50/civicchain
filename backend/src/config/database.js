import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/civicchain.db');

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let _db = null;

function canonicalizeJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(obj[k])).join(',') + '}';
}

function computeHashChainDigest(previousHash, record) {
  const canonical = canonicalizeJson({
    block_number: Number(record.block_number),
    complaint_id: record.complaint_id || '',
    event_type: String(record.event_type),
    payload_hash: String(record.payload_hash || ''),
    timestamp: String(record.timestamp),
    tx_id: String(record.tx_id)
  });
  return crypto.createHash('sha256').update(`${previousHash}|${canonical}`).digest('hex');
}

export async function initDatabase() {
  _db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await _db.exec('PRAGMA journal_mode = WAL');
  await _db.exec('PRAGMA foreign_keys = ON');

  await _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CITIZEN',
      department TEXT,
      badge_number TEXT,
      is_active INTEGER DEFAULT 1,
      profile_photo TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      complaint_number TEXT UNIQUE NOT NULL,
      citizen_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      status TEXT NOT NULL DEFAULT 'REPORTED',
      priority TEXT DEFAULT 'MEDIUM',
      assigned_department TEXT,
      assigned_officer_id TEXT,
      investigator_id TEXT,
      verifier_id TEXT,
      resolution_details TEXT,
      verification_details TEXT,
      rejection_reason TEXT,
      blockchain_tx_id TEXT,
      blockchain_hash TEXT,
      is_anonymous INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (citizen_id) REFERENCES users(id),
      FOREIGN KEY (assigned_officer_id) REFERENCES users(id),
      FOREIGN KEY (investigator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS complaint_events (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      performed_by TEXT NOT NULL,
      performer_role TEXT NOT NULL,
      notes TEXT,
      blockchain_tx_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (performed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      sha256_hash TEXT NOT NULL,
      description TEXT,
      blockchain_hash TEXT,
      is_investigation_evidence INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS blockchain_records (
      id TEXT PRIMARY KEY,
      tx_id TEXT NOT NULL,
      complaint_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT,
      payload_hash TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'mock',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS citizen_feedback (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL,
      citizen_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comments TEXT,
      blockchain_tx_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id),
      FOREIGN KEY (citizen_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_citizen ON complaints(citizen_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
    CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category);
    CREATE INDEX IF NOT EXISTS idx_complaint_events_complaint ON complaint_events(complaint_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON evidence(complaint_id);
    CREATE INDEX IF NOT EXISTS idx_blockchain_records_block ON blockchain_records(block_number);
  `);

  // Migrate existing blockchain_records if table existed with old schema
  const tableInfo = await _db.all("PRAGMA table_info(blockchain_records)");
  const columnNames = tableInfo.map(c => c.name);
  if (!columnNames.includes('previous_hash')) {
    await _db.exec("ALTER TABLE blockchain_records ADD COLUMN previous_hash TEXT;");
  }
  if (!columnNames.includes('record_hash')) {
    await _db.exec("ALTER TABLE blockchain_records ADD COLUMN record_hash TEXT;");
  }
  if (!columnNames.includes('payload')) {
    await _db.exec("ALTER TABLE blockchain_records ADD COLUMN payload TEXT;");
  }

  // Migrate evidence table for permanent cloud storage
  const evInfo = await _db.all("PRAGMA table_info(evidence)");
  const evCols = evInfo.map(c => c.name);
  if (!evCols.includes('cloudinary_url')) {
    await _db.exec("ALTER TABLE evidence ADD COLUMN cloudinary_url TEXT;");
  }

  // Backfill any existing rows missing previous_hash / record_hash sequentially
  const unlinkedRecords = await _db.all(
    "SELECT rowid, * FROM blockchain_records WHERE previous_hash IS NULL OR record_hash IS NULL ORDER BY block_number ASC, rowid ASC"
  );
  if (unlinkedRecords.length > 0) {
    const allRecords = await _db.all("SELECT rowid, * FROM blockchain_records ORDER BY block_number ASC, rowid ASC");
    let prevHash = "0".repeat(64);
    let blockNum = 1;

    for (const rec of allRecords) {
      const pHash = prevHash;
      const bNum = blockNum++;
      const payloadHash = rec.payload_hash || crypto.createHash('sha256').update(rec.tx_id + rec.event_type).digest('hex');
      const recHash = computeHashChainDigest(pHash, {
        block_number: bNum,
        complaint_id: rec.complaint_id,
        event_type: rec.event_type,
        payload_hash: payloadHash,
        timestamp: rec.timestamp,
        tx_id: rec.tx_id
      });

      await _db.run(
        `UPDATE blockchain_records
         SET previous_hash = ?, record_hash = ?, block_number = ?, payload_hash = ?
         WHERE rowid = ?`,
        [pHash, recHash, bNum, payloadHash, rec.rowid]
      );
      prevHash = recHash;
    }
  }

  console.log('✅ Database initialized at', DB_PATH);
  return _db;
}

export function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}
