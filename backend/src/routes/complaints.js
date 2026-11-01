import express from 'express';
import {
  listComplaints, getComplaint, createComplaint,
  registerComplaint, assignComplaint, investigateComplaint,
  verifyComplaint, takeAction, resolveComplaint,
  verifyResolution, closeComplaint, getComplaintHistory,
  submitCitizenFeedback
} from '../controllers/complaintController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleUploadMiddleware, uploadEvidence } from '../controllers/evidenceController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Complaint CRUD
router.get('/', listComplaints);
router.post('/', authorize('CITIZEN', 'ADMIN'), createComplaint);
router.get('/:id', getComplaint);
router.get('/:id/history', getComplaintHistory);

// Lifecycle transitions
router.put('/:id/register',          authorize('AUTHORITY', 'ADMIN'), registerComplaint);
router.put('/:id/assign',            authorize('AUTHORITY', 'ADMIN'), assignComplaint);
router.put('/:id/investigate',       authorize('INVESTIGATOR', 'AUTHORITY', 'ADMIN'), investigateComplaint);
router.put('/:id/verify',            authorize('VERIFIER', 'ADMIN'), verifyComplaint);
router.put('/:id/action',            authorize('AUTHORITY', 'ADMIN'), takeAction);
router.put('/:id/resolve',           authorize('AUTHORITY', 'INVESTIGATOR', 'ADMIN'), resolveComplaint);
router.put('/:id/verify-resolution', authorize('VERIFIER', 'CITIZEN', 'ADMIN'), verifyResolution);
router.put('/:id/close',             authorize('ADMIN', 'AUTHORITY'), closeComplaint);

// Citizen Feedback
router.post('/:id/feedback',         authorize('CITIZEN', 'ADMIN'), submitCitizenFeedback);

// Evidence
router.post('/:id/evidence', handleUploadMiddleware, uploadEvidence);

export default router;
