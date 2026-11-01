import express from 'express';
import { verifyEvidence, getEvidenceFile, getEvidenceRecord } from '../controllers/evidenceController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

// Evidence metadata
router.get('/:id', getEvidenceRecord);

// Authenticated evidence-file download/stream
router.get('/:id/file', getEvidenceFile);

// Cryptographic verification
router.get('/:id/verify', verifyEvidence);

export default router;
