import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../config/database.js';
import { getBlockchainService } from '../services/blockchainService.js';
import { checkUserComplaintAccess } from '../middleware/auth.js';
import { isCloudinaryEnabled, uploadToCloudinary, fetchRemoteBytes } from '../services/cloudinaryService.js';

const UPLOAD_PATH = path.resolve(process.env.UPLOAD_PATH || path.join(process.cwd(), '..', 'uploads'));

['evidence', 'avatars'].forEach(dir => {
  const p = path.join(UPLOAD_PATH, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(UPLOAD_PATH, 'evidence')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed. Allowed: images, PDFs, videos, Word docs`), false);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 }
});

/**
 * Express wrapper for multer to catch and format upload errors cleanly
 */
export function handleUploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds 10MB limit', code: 'LIMIT_FILE_SIZE' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: err.code });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    next();
  });
}

export function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const INTEGRITY_DISCLAIMER = 'A hash match establishes file integrity relative to the trusted reference; it does not establish that the photo is genuine or that the civic issue was real.';

/**
 * POST /api/complaints/:id/evidence
 * Uploads evidence file, computes SHA-256 digest, anchors in ledger, persists row.
 * Cleans up orphaned files or database rows on any failure.
 */
export async function uploadEvidence(req, res) {
  let fileWritten = false;
  let evidenceId = null;
  let rowInserted = false;

  try {
    const db = getDb();
    const complaintId = req.params.id;

    // Look up complaint to ensure it exists
    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', complaintId);
    if (!complaint) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Role and scope authorization check for uploading evidence
    const canUpload = ['AUTHORITY', 'ADMIN'].includes(req.user.role)
      || (req.user.role === 'CITIZEN' && complaint.citizen_id === req.user.id)
      || (req.user.role === 'INVESTIGATOR' && (complaint.investigator_id === req.user.id || ['ASSIGNED', 'INVESTIGATING'].includes(complaint.status)))
      || (req.user.role === 'VERIFIER' && ['INVESTIGATING', 'VERIFIED', 'RESOLVED'].includes(complaint.status));

    if (!canUpload) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(403).json({ error: 'Access denied: not authorized to add evidence to this complaint' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded or file parameter missing' });
    }

    if (!fs.existsSync(req.file.path)) {
      return res.status(500).json({ error: 'Evidence file storage failed to persist file' });
    }
    fileWritten = true;

    // Calculate SHA-256 digest from the bytes written to storage
    const sha256Hash = await computeFileHash(req.file.path);
    evidenceId = uuidv4();
    const now = new Date().toISOString();
    const isInvestigation = ['INVESTIGATOR', 'AUTHORITY', 'ADMIN'].includes(req.user.role) ? 1 : 0;

    // Anchor evidence digest in the blockchain ledger
    const blockchainService = getBlockchainService();
    let bcResult = { txId: 'TX:EVIDENCE:PENDING', recordHash: sha256Hash };
    try {
      bcResult = await blockchainService.recordEvidence({
        evidenceId,
        complaintId: complaint.id,
        sha256Hash,
        uploaderId: req.user.id,
        uploaderRole: req.user.role,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size
      });
    } catch (bcErr) {
      console.warn('Ledger anchoring warning:', bcErr.message);
    }

    // Upload to Cloudinary for permanent cloud persistence if configured
    let cloudinaryUrl = null;
    if (isCloudinaryEnabled()) {
      try {
        const cResult = await uploadToCloudinary(req.file.path, evidenceId);
        cloudinaryUrl = cResult.secure_url;
      } catch (cErr) {
        console.warn('Cloudinary upload warning:', cErr.message);
      }
    }

    // Persist evidence row only after file has been successfully written and hashed
    await db.run(
      `INSERT INTO evidence (
        id, complaint_id, uploaded_by, filename, original_name,
        file_path, file_size, mime_type, sha256_hash, description,
        blockchain_hash, is_investigation_evidence, cloudinary_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidenceId, complaint.id, req.user.id, req.file.filename, req.file.originalname,
        req.file.path, req.file.size, req.file.mimetype, sha256Hash,
        req.body.description || null, bcResult.recordHash || sha256Hash, isInvestigation,
        cloudinaryUrl, now
      ]
    );
    rowInserted = true;

    res.status(201).json({
      message: 'Evidence uploaded successfully',
      evidence: {
        id: evidenceId,
        complaint_id: complaint.id,
        filename: req.file.filename,
        original_name: req.file.originalname,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        sha256_hash: sha256Hash,
        blockchain_hash: bcResult.recordHash || sha256Hash,
        blockchain_tx_id: bcResult.txId,
        description: req.body.description || null,
        url: `/api/evidence/${evidenceId}/file`,
        created_at: now
      },
      integrity: {
        sha256: sha256Hash,
        blockchain_tx_id: bcResult.txId,
        message: 'SHA-256 hash recorded on ledger. Use /api/evidence/:id/verify to check integrity at any time.',
        disclaimer: INTEGRITY_DISCLAIMER
      }
    });
  } catch (err) {
    console.error('Upload evidence error:', err);
    // Clean up orphaned database row if inserted
    if (rowInserted && evidenceId) {
      try {
        const db = getDb();
        await db.run('DELETE FROM evidence WHERE id = ?', evidenceId);
      } catch (_) {}
    }
    // Clean up orphaned file on error
    if (fileWritten && req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ error: 'Failed to upload evidence: ' + err.message });
  }
}

/**
 * GET /api/evidence/:id
 * Retrieves evidence metadata after verifying role & complaint scope authorization.
 */
export async function getEvidenceRecord(req, res) {
  try {
    const db = getDb();
    const evidence = await db.get(
      `SELECT e.*, c.citizen_id, c.assigned_department, c.investigator_id, c.verifier_id, c.status
       FROM evidence e
       JOIN complaints c ON e.complaint_id = c.id
       WHERE e.id = ?`,
      req.params.id
    );

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    if (!checkUserComplaintAccess(req.user, evidence)) {
      return res.status(403).json({ error: 'Access denied: you do not have permission to access this evidence' });
    }

    res.json({
      evidence: {
        id: evidence.id,
        complaint_id: evidence.complaint_id,
        filename: evidence.filename,
        original_name: evidence.original_name,
        file_size: evidence.file_size,
        mime_type: evidence.mime_type,
        sha256_hash: evidence.sha256_hash,
        blockchain_hash: evidence.blockchain_hash,
        description: evidence.description,
        is_investigation_evidence: evidence.is_investigation_evidence,
        created_at: evidence.created_at,
        url: `/api/evidence/${evidence.id}/file`
      }
    });
  } catch (err) {
    console.error('Get evidence record error:', err);
    res.status(500).json({ error: 'Failed to fetch evidence record' });
  }
}

/**
 * GET /api/evidence/:id/file
 * Authenticated evidence-file endpoint. Checks authorization and streams file.
 */
export async function getEvidenceFile(req, res) {
  try {
    const db = getDb();
    const evidence = await db.get(
      `SELECT e.*, c.citizen_id, c.assigned_department, c.investigator_id, c.verifier_id, c.status
       FROM evidence e
       JOIN complaints c ON e.complaint_id = c.id
       WHERE e.id = ?`,
      req.params.id
    );

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence record not found' });
    }

    // Role and complaint scope check
    if (!checkUserComplaintAccess(req.user, evidence)) {
      return res.status(403).json({ error: 'Access denied: you do not have permission to access this evidence' });
    }

    let targetPath = path.join(UPLOAD_PATH, 'evidence', evidence.filename);
    if (!fs.existsSync(targetPath) && evidence.file_path) {
      targetPath = path.normalize(evidence.file_path);
    }

    if (!fs.existsSync(targetPath)) {
      if (evidence.cloudinary_url) {
        try {
          const remoteBytes = await fetchRemoteBytes(evidence.cloudinary_url);
          res.setHeader('Content-Type', evidence.mime_type || 'application/octet-stream');
          res.setHeader('Content-Disposition', `inline; filename="${path.basename(evidence.original_name)}"`);
          res.setHeader('X-Evidence-Integrity', evidence.sha256_hash);
          res.setHeader('X-Storage-Backend', 'cloudinary');
          return res.send(remoteBytes);
        } catch (fetchErr) {
          console.warn('Cloudinary retrieval failed:', fetchErr.message);
        }
      }
      return res.status(404).json({ error: 'Evidence file not found on storage', status: 'MISSING_FILE' });
    }

    res.setHeader('Content-Type', evidence.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(evidence.original_name)}"`);
    res.setHeader('X-Evidence-Integrity', evidence.sha256_hash);

    fs.createReadStream(targetPath).pipe(res);
  } catch (err) {
    console.error('Get evidence file error:', err);
    res.status(500).json({ error: 'Failed to retrieve evidence file' });
  }
}

/**
 * Protected route handler for /uploads/evidence/:filename
 * Does not trust filename from client: looks up record in DB, verifies authorization, and streams.
 */
export async function getEvidenceFileByFilename(req, res) {
  try {
    const safeFilename = path.basename(req.params.filename);
    const db = getDb();

    const evidence = await db.get(
      `SELECT e.*, c.citizen_id, c.assigned_department, c.investigator_id, c.verifier_id, c.status
       FROM evidence e
       JOIN complaints c ON e.complaint_id = c.id
       WHERE e.filename = ?`,
      safeFilename
    );

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence record not found' });
    }

    // Role and complaint scope check
    if (!checkUserComplaintAccess(req.user, evidence)) {
      return res.status(403).json({ error: 'Access denied: you do not have permission to view this evidence' });
    }

    let targetPath = path.join(UPLOAD_PATH, 'evidence', safeFilename);
    if (!fs.existsSync(targetPath) && evidence.file_path) {
      targetPath = path.normalize(evidence.file_path);
    }

    if (!fs.existsSync(targetPath)) {
      if (evidence.cloudinary_url) {
        try {
          const remoteBytes = await fetchRemoteBytes(evidence.cloudinary_url);
          res.setHeader('Content-Type', evidence.mime_type || 'application/octet-stream');
          res.setHeader('Content-Disposition', `inline; filename="${path.basename(evidence.original_name)}"`);
          res.setHeader('X-Evidence-Integrity', evidence.sha256_hash);
          res.setHeader('X-Storage-Backend', 'cloudinary');
          return res.send(remoteBytes);
        } catch (fetchErr) {
          console.warn('Cloudinary retrieval failed:', fetchErr.message);
        }
      }
      return res.status(404).json({ error: 'Evidence file not found on storage', status: 'MISSING_FILE' });
    }

    res.setHeader('Content-Type', evidence.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(evidence.original_name)}"`);
    res.setHeader('X-Evidence-Integrity', evidence.sha256_hash);

    fs.createReadStream(targetPath).pipe(res);
  } catch (err) {
    console.error('Get evidence by filename error:', err);
    res.status(500).json({ error: 'Failed to retrieve evidence file' });
  }
}

/**
 * GET /api/evidence/:id/verify
 * Cryptographically verifies current file bytes on disk against trusted ledger reference.
 * Returns structured status: VERIFIED | MISMATCH | MISSING_FILE | UNAVAILABLE.
 */
export async function verifyEvidence(req, res) {
  try {
    const db = getDb();
    const evidence = await db.get(
      `SELECT e.*, c.citizen_id, c.assigned_department, c.investigator_id, c.verifier_id, c.status
       FROM evidence e
       JOIN complaints c ON e.complaint_id = c.id
       WHERE e.id = ?`,
      req.params.id
    );

    if (!evidence) {
      return res.status(404).json({ error: 'Evidence not found' });
    }

    // Authorization check
    if (!checkUserComplaintAccess(req.user, evidence)) {
      return res.status(403).json({ error: 'Access denied: you do not have permission to verify this evidence' });
    }

    // Retrieve trusted reference: lookup the ledger record anchored in the cryptographic hash chain
    const ledgerRecord = await db.get(
      `SELECT * FROM blockchain_records
       WHERE event_type = 'EVIDENCE_UPLOADED'
         AND (complaint_id = ? OR payload LIKE ?)
       ORDER BY block_number DESC LIMIT 1`,
      [evidence.complaint_id, `%"evidenceId":"${evidence.id}"%`]
    );

    let expectedHash = evidence.sha256_hash;
    let ledgerAnchored = false;
    let anchorBlockNumber = null;

    if (ledgerRecord) {
      try {
        const payloadObj = JSON.parse(ledgerRecord.payload);
        if (payloadObj && payloadObj.sha256Hash) {
          expectedHash = payloadObj.sha256Hash;
          ledgerAnchored = true;
          anchorBlockNumber = ledgerRecord.block_number;
        }
      } catch (_) {}
    }

    let targetPath = path.join(UPLOAD_PATH, 'evidence', evidence.filename);
    if (!fs.existsSync(targetPath) && evidence.file_path) {
      targetPath = path.normalize(evidence.file_path);
    }

    let actualHash = null;
    let storageBackend = 'local';

    if (fs.existsSync(targetPath)) {
      try {
        actualHash = await computeFileHash(targetPath);
      } catch (readErr) {
        return res.status(500).json({
          status: 'UNAVAILABLE',
          verified: false,
          evidenceId: evidence.id,
          filename: evidence.original_name,
          expectedHash,
          actualHash: null,
          error: 'Failed to read evidence bytes: ' + readErr.message,
          disclaimer: INTEGRITY_DISCLAIMER
        });
      }
    } else if (evidence.cloudinary_url) {
      try {
        const remoteBytes = await fetchRemoteBytes(evidence.cloudinary_url);
        actualHash = crypto.createHash('sha256').update(remoteBytes).digest('hex');
        storageBackend = 'cloudinary';
      } catch (cErr) {
        return res.json({
          status: 'MISSING_FILE',
          verified: false,
          evidenceId: evidence.id,
          filename: evidence.original_name,
          expectedHash,
          actualHash: null,
          fileExists: false,
          ledgerAnchored,
          anchorBlockNumber,
          message: '❌ MISSING_FILE: Evidence file could not be retrieved from Cloudinary storage',
          disclaimer: INTEGRITY_DISCLAIMER
        });
      }
    } else {
      return res.json({
        status: 'MISSING_FILE',
        verified: false,
        evidenceId: evidence.id,
        filename: evidence.original_name,
        expectedHash,
        actualHash: null,
        fileExists: false,
        ledgerAnchored,
        anchorBlockNumber,
        message: '❌ MISSING_FILE: Evidence file is not present on storage and cannot be verified',
        disclaimer: INTEGRITY_DISCLAIMER
      });
    }

    if (actualHash === expectedHash) {
      return res.json({
        status: 'VERIFIED',
        verified: true,
        evidenceId: evidence.id,
        filename: evidence.original_name,
        expectedHash,
        actualHash,
        fileExists: true,
        ledgerAnchored,
        anchorBlockNumber,
        message: '✅ Evidence integrity verified - file matches trusted reference digest',
        disclaimer: INTEGRITY_DISCLAIMER
      });
    } else {
      return res.json({
        status: 'MISMATCH',
        verified: false,
        evidenceId: evidence.id,
        filename: evidence.original_name,
        expectedHash,
        actualHash,
        fileExists: true,
        ledgerAnchored,
        anchorBlockNumber,
        message: '❌ HASH MISMATCH - evidence file has been modified or altered relative to trusted reference',
        disclaimer: INTEGRITY_DISCLAIMER
      });
    }
  } catch (err) {
    console.error('Verify evidence error:', err);
    res.status(500).json({
      status: 'UNAVAILABLE',
      verified: false,
      error: 'Failed to verify evidence: ' + err.message,
      disclaimer: INTEGRITY_DISCLAIMER
    });
  }
}
