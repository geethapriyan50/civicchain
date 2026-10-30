import { getDb } from '../config/database.js';
import crypto from 'crypto';
import fs from 'fs';

export async function getExplorerData(req, res) {
  try {
    const db = getDb();

    const countRes = await db.get('SELECT COUNT(*) as txCount, MAX(block_number) as maxBlock FROM blockchain_records');
    const complaintCount = await db.get('SELECT COUNT(*) as count FROM complaints');
    const evidenceCount = await db.get('SELECT COUNT(*) as count FROM evidence');

    const recentRecords = await db.all(`
      SELECT br.*, c.complaint_number, c.category, c.title
      FROM blockchain_records br
      LEFT JOIN complaints c ON br.complaint_id = c.id
      ORDER BY br.created_at DESC
      LIMIT 25
    `);

    res.json({
      summary: {
        mode: process.env.BLOCKCHAIN_MODE || 'mock',
        totalTransactions: countRes?.txCount || 0,
        latestBlockNumber: countRes?.maxBlock || 100000,
        totalComplaintsAnchored: complaintCount?.count || 0,
        totalEvidenceAnchored: evidenceCount?.count || 0,
        consensusMechanism: (process.env.BLOCKCHAIN_MODE === 'fabric') ? 'Raft Consensus' : 'Local Proof-of-Authority (Mock)',
        networkStatus: 'HEALTHY'
      },
      transactions: recentRecords
    });
  } catch (err) {
    console.error('Explorer error:', err);
    res.status(500).json({ error: 'Failed to retrieve blockchain explorer data' });
  }
}

export async function verifyLedgerIntegrity(req, res) {
  try {
    const db = getDb();

    const records = await db.all('SELECT * FROM blockchain_records');
    const complaints = await db.all('SELECT id, complaint_number, blockchain_tx_id, blockchain_hash FROM complaints');
    const evidence = await db.all('SELECT id, file_path, sha256_hash FROM evidence');

    let totalChecked = 0;
    let discrepancies = 0;
    const auditLog = [];

    // 1. Verify complaints against blockchain records
    for (const c of complaints) {
      totalChecked++;
      if (c.blockchain_tx_id) {
        const match = records.find(r => r.tx_id === c.blockchain_tx_id);
        if (!match) {
          discrepancies++;
          auditLog.push({ type: 'COMPLAINT', id: c.complaint_number, status: 'HASH_OR_TX_MISSING' });
        } else {
          auditLog.push({ type: 'COMPLAINT', id: c.complaint_number, status: 'VERIFIED', txId: c.blockchain_tx_id });
        }
      }
    }

    // 2. Verify evidence files SHA-256 against disk if present
    for (const e of evidence) {
      totalChecked++;
      if (fs.existsSync(e.file_path)) {
        const fileBuffer = fs.readFileSync(e.file_path);
        const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        if (actualHash !== e.sha256_hash) {
          discrepancies++;
          auditLog.push({ type: 'EVIDENCE', id: e.id, status: 'TAMPER_DETECTED' });
        } else {
          auditLog.push({ type: 'EVIDENCE', id: e.id, status: 'VERIFIED' });
        }
      } else {
        discrepancies++;
        auditLog.push({ type: 'EVIDENCE', id: e.id, status: 'MISSING_FILE' });
      }
    }

    const isSecure = discrepancies === 0;
    const isMock = (process.env.BLOCKCHAIN_MODE || 'mock') !== 'fabric';

    res.json({
      verified: isSecure,
      status: !isSecure ? 'INTEGRITY_VIOLATION_DETECTED' : isMock ? 'LOCAL_RECORDS_VERIFIED_ONLY' : 'LOCAL_INTEGRITY_VERIFIED',
      ledgerMode: isMock ? 'mock' : 'fabric',
      note: isMock ? 'Local records and evidence hashes checked; no independent blockchain verification performed.' : 'Local records and evidence hashes checked; this does not independently attest Fabric consensus.',
      totalRecordsAudited: totalChecked,
      discrepancies,
      auditTimestamp: new Date().toISOString(),
      details: auditLog.slice(0, 10)
    });
  } catch (err) {
    console.error('Integrity check error:', err);
    res.status(500).json({ error: 'Failed to complete ledger integrity audit' });
  }
}
