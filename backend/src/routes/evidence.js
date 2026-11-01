import express from 'express';
import { getEvidenceFile, verifyEvidence } from '../controllers/evidenceController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.get('/:id/file', getEvidenceFile);
router.get('/:id/verify', verifyEvidence);

export default router;
