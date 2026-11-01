import { getDb } from '../config/database.js';
import { getBlockchainService } from '../services/blockchainService.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const INTEGRITY_DISCLAIMER = 'A hash match establishes file integrity relative to the trusted reference; it does not establish that the photo is genuine or that the civic issue was real.';

export async function getExplorerData(req, res) {
  try {
    const db = getDb();
    const service = getBlockchainService();
    const mode = process.env.BLOCKCHAIN_MODE || 'mock';
    const isFabric = (mode === 'fabric');

    const countRes = await db.get('SELECT COUNT(*) as txCount, MAX(block_number) as maxBlock FROM blockchain_records');
    const complaintCount = await db.get('SELECT COUNT(*) as count FROM complaints');
    const evidenceCount = await db.get('SELECT COUNT(*) as count FROM evidence');

    const recentRecords = await db.all(`
      SELECT br.*, c.complaint_number, c.category, c.title
      FROM blockchain_records br
      LEFT JOIN complaints c ON br.complaint_id = c.id
      ORDER BY br.block_number DESC, br.created_at DESC
      LIMIT 25
    `);

    // Check actual connection status honestly
    const connCheck = await service.checkConnection();
    const fabricConnected = isFabric ? !!connCheck.connected : false;

    let networkStatus = 'HEALTHY';
    let consensusMechanism = 'Local Cryptographic Hash-Chain (Mock)';

    if (isFabric) {
      if (fabricConnected) {
        networkStatus = 'ONLINE';
        consensusMechanism = 'Raft Consensus';
      } else {
        networkStatus = 'FABRIC_UNAVAILABLE';
        consensusMechanism = 'Raft Consensus (Offline)';
      }
    } else {
      networkStatus = 'MOCK_ADAPTER_ACTIVE';
      consensusMechanism = 'Local Cryptographic Hash-Chain (Mock)';
    }

    res.json({
      summary: {
        mode,
        isMock: !isFabric,
        fabricConnected,
        totalTransactions: countRes?.txCount || 0,
        latestBlockNumber: countRes?.maxBlock || 0,
        totalComplaintsAnchored: complaintCount?.count || 0,
        totalEvidenceAnchored: evidenceCount?.count || 0,
        consensusMechanism,
        networkStatus,
        ...(isFabric && !fabricConnected && { error: connCheck.error })
      },
      transactions: recentRecords
    });
  } catch (err) {
    console.error('Explorer error:', err);
    res.status(500).json({ error: 'Failed to retrieve blockchain explorer data' });
  }
}

/**
 * GET /api/blockchain/verify-integrity
 * Performs end-to-end cryptographic integrity verification:
 * 1. Verifies every link in the hash chain sequentially (genesis -> block N: previous_hash and record_hash).
 * 2. Verifies complaint blockchain anchors against the verified hash chain.
 * 3. Verifies evidence files on storage: checks if file exists, re-calculates SHA-256,
 *    and flags missing or modified files. Never marks missing files as verified.
 * 4. Checks Fabric Gateway status honestly when in fabric mode.
 */
export async function verifyLedgerIntegrity(req, res) {
  try {
    const db = getDb();
    const service = getBlockchainService();
    const mode = process.env.BLOCKCHAIN_MODE || 'mock';
    const isFabric = (mode === 'fabric');

    let totalChecked = 0;
    let discrepancies = 0;
    const auditLog = [];

    // 1. Verify every link of the hash chain in order
    const chainResult = await service.verifyChain();
    if (!chainResult.valid) {
      discrepancies++;
      auditLog.push({
        type: 'LEDGER_CHAIN',
        status: 'BROKEN_CHAIN_LINK',
        verified: false,
        details: chainResult.details?.filter(d => d.status !== 'VERIFIED') || [],
        error: 'Cryptographic hash-chain continuity broken: one or more blocks have altered previous_hash or record_hash'
      });
    } else {
      auditLog.push({
        type: 'LEDGER_CHAIN',
        status: 'VERIFIED',
        verified: true,
        totalBlocks: chainResult.totalBlocks,
        latestBlockHash: chainResult.latestBlockHash
      });
    }

    // 2. Verify complaint transaction anchors in the ledger
    const complaints = await db.all('SELECT id, complaint_number, blockchain_tx_id, blockchain_hash FROM complaints');
    const records = await db.all('SELECT tx_id, complaint_id, record_hash FROM blockchain_records');
    const recordTxSet = new Set(records.map(r => r.tx_id));

    for (const c of complaints) {
      totalChecked++;
      if (c.blockchain_tx_id) {
        if (!recordTxSet.has(c.blockchain_tx_id)) {
          discrepancies++;
          auditLog.push({
            type: 'COMPLAINT',
            id: c.complaint_number,
            status: 'ANCHOR_NOT_FOUND',
            verified: false,
            txId: c.blockchain_tx_id,
            error: `Complaint ${c.complaint_number} transaction ID not anchored in cryptographic ledger`
          });
        } else {
          auditLog.push({
            type: 'COMPLAINT',
            id: c.complaint_number,
            status: 'VERIFIED',
            verified: true,
            txId: c.blockchain_tx_id
          });
        }
      }
    }

    // 3. Verify evidence files against stored digests and storage bytes
    const evidenceList = await db.all('SELECT id, original_name, file_path, sha256_hash FROM evidence');

    for (const e of evidenceList) {
      totalChecked++;
      const resolvedPath = path.resolve(e.file_path);

      if (!fs.existsSync(resolvedPath)) {
        // Missing file must be reported distinctly as MISSING_FILE and NEVER verified: true
        discrepancies++;
        auditLog.push({
          type: 'EVIDENCE',
          id: e.id,
          filename: e.original_name,
          status: 'MISSING_FILE',
          verified: false,
          expectedHash: e.sha256_hash,
          actualHash: null,
          error: `Evidence file ${e.original_name} (${e.id}) missing from disk storage`
        });
      } else {
        try {
          const fileBuffer = fs.readFileSync(resolvedPath);
          const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

          if (actualHash !== e.sha256_hash) {
            discrepancies++;
            auditLog.push({
              type: 'EVIDENCE',
              id: e.id,
              filename: e.original_name,
              status: 'MISMATCH',
              verified: false,
              expectedHash: e.sha256_hash,
              actualHash,
              error: `Cryptographic hash mismatch for evidence ${e.original_name}: file altered on disk`
            });
          } else {
            auditLog.push({
              type: 'EVIDENCE',
              id: e.id,
              filename: e.original_name,
              status: 'VERIFIED',
              verified: true,
              expectedHash: e.sha256_hash,
              actualHash
            });
          }
        } catch (readErr) {
          discrepancies++;
          auditLog.push({
            type: 'EVIDENCE',
            id: e.id,
            filename: e.original_name,
            status: 'UNAVAILABLE',
            verified: false,
            expectedHash: e.sha256_hash,
            actualHash: null,
            error: `Failed to read evidence file: ${readErr.message}`
          });
        }
      }
    }

    // 4. Fabric Mode connection check
    let fabricConnected = false;
    if (isFabric) {
      const conn = await service.checkConnection();
      fabricConnected = !!conn.connected;
      if (!fabricConnected) {
        discrepancies++;
        auditLog.push({
          type: 'FABRIC_GATEWAY',
          status: 'UNAVAILABLE',
          verified: false,
          error: conn.error || 'Hyperledger Fabric peer unreachable'
        });
      }
    }

    const isSecure = (discrepancies === 0 && chainResult.valid);

    res.json({
      verified: isSecure,
      status: isSecure ? 'CRYPTOGRAPHICALLY_VERIFIED' : 'INTEGRITY_VIOLATION_DETECTED',
      ledgerChain: {
        valid: chainResult.valid,
        totalBlocks: chainResult.totalBlocks,
        genesisHash: chainResult.genesisHash,
        latestBlockHash: chainResult.latestBlockHash
      },
      blockchainMode: mode,
      isMock: !isFabric,
      fabricConnected,
      totalRecordsAudited: totalChecked,
      discrepancies,
      auditTimestamp: new Date().toISOString(),
      disclaimer: INTEGRITY_DISCLAIMER,
      details: auditLog
    });
  } catch (err) {
    console.error('Integrity check error:', err);
    res.status(500).json({
      status: 'UNAVAILABLE',
      verified: false,
      error: 'Failed to complete ledger integrity audit: ' + err.message,
      disclaimer: INTEGRITY_DISCLAIMER
    });
  }
}
