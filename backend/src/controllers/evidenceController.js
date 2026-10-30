import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../config/database.js';

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

function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function uploadEvidence(req, res) {
  try {
    const db = getDb();
    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', req.params.id);

    if (!complaint) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const canUpload = ['AUTHORITY', 'ADMIN', 'INVESTIGATOR'].includes(req.user.role)
      || req.user.id === complaint.citizen_id;

    if (!canUpload) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const sha256Hash = await computeFileHash(req.file.path);
    const evidenceId = uuidv4();
    const now = new Date().toISOString();
    const isInvestigation = ['INVESTIGATOR', 'AUTHORITY', 'ADMIN'].includes(req.user.role) ? 1 : 0;

    await db.run(
      `INSERT INTO evidence (id, complaint_id, uploaded_by, filename, original_name, file_path, file_size, mime_type, sha256_hash, description, is_investigation_evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [evidenceId, complaint.id, req.user.id, req.file.filename, req.file.originalname,
       req.file.path, req.file.size, req.file.mimetype, sha256Hash,
       req.body.description || null, isInvestigation, now]
    );

    res.status(201).json({
      message: 'Evidence uploaded successfully',
      evidence: {
        id: evidenceId, filename: req.file.filename, original_name: req.file.originalname,
        file_size: req.file.size, mime_type: req.file.mimetype, sha256_hash: sha256Hash,
        description: req.body.description || null, url: `/uploads/evidence/${req.file.filename}`,
        created_at: now
      },
      integrity: {
        sha256: sha256Hash,
        message: 'SHA-256 hash recorded. Use /api/evidence/:id/verify to check integrity at any time.'
      }
    });
  } catch (err) {
    console.error('Upload evidence error:', err);
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    res.status(500).json({ error: 'Failed to upload evidence' });
  }
}

export async function getEvidenceFile(req, res) {
  try {
    const db = getDb();
    const evidence = await db.get(
      'SELECT e.*, c.citizen_id FROM evidence e JOIN complaints c ON e.complaint_id = c.id WHERE e.id = ?',
      req.params.id
    );
    if (!evidence) return res.status(404).json({ error: 'Evidence not found' });
    const canView = ['AUTHORITY', 'ADMIN', 'INVESTIGATOR', 'VERIFIER'].includes(req.user.role) || req.user.id === evidence.citizen_id;
    if (!canView) return res.status(403).json({ error: 'Access denied' });
    const resolvedPath = path.resolve(evidence.file_path);
    const evidenceDirectory = path.resolve(UPLOAD_PATH, 'evidence') + path.sep;
    if (!resolvedPath.startsWith(evidenceDirectory)) return res.status(400).json({ error: 'Invalid evidence path' });
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: 'Evidence file is missing' });
    res.setHeader('Content-Type', evidence.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', evidence.file_size);
    res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(evidence.original_name || evidence.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(resolvedPath).on('error', err => {
      console.error('Evidence stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read evidence file' }); else res.destroy(err);
    }).pipe(res);
  } catch (err) {
    console.error('Get evidence file error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to retrieve evidence file' });
  }
}
export async function verifyEvidence(req, res) {
  try {
    const db = getDb();
    const evidence = await db.get(
      'SELECT e.*, c.citizen_id FROM evidence e JOIN complaints c ON e.complaint_id = c.id WHERE e.id = ?',
      req.params.id
    );
    if (!evidence) return res.status(404).json({ error: 'Evidence not found' });
    const canVerify = ['AUTHORITY', 'ADMIN', 'INVESTIGATOR', 'VERIFIER'].includes(req.user.role) || req.user.id === evidence.citizen_id;
    if (!canVerify) return res.status(403).json({ error: 'Access denied' });

    let currentHash = null;
    let fileExists = false;
    try {
      currentHash = await computeFileHash(evidence.file_path);
      fileExists = true;
    } catch (_) {}

    const isIntact = fileExists && currentHash === evidence.sha256_hash;
    res.json({
      evidenceId: evidence.id, filename: evidence.original_name,
      storedHash: evidence.sha256_hash, currentHash, fileExists, isIntact,
      message: isIntact
        ? '✅ Evidence integrity verified - file has not been tampered with'
        : '❌ HASH MISMATCH - evidence may have been altered or file is missing'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify evidence' });
  }
}
