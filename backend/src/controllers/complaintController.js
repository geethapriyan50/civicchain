import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../config/database.js';
import { getBlockchainService, ACTION_TO_STATUS, validateTransition } from '../services/blockchainService.js';
import { checkUserComplaintAccess } from '../middleware/auth.js';

const CATEGORIES = [
  'Roads', 'Streetlights', 'Drainage', 'Water Supply', 'Sanitation',
  'Government Schools', 'Hospitals', 'Waste Management', 'Public Safety', 'Other'
];

function generateComplaintNumber() {
  return `CC${Date.now().toString().slice(-8)}`;
}

function safeComplaint(complaint, requestingUser) {
  if (!complaint) return null;
  const c = { ...complaint };
  const canSeeCitizenData = ['AUTHORITY', 'ADMIN', 'INVESTIGATOR', 'VERIFIER'].includes(requestingUser?.role)
    || requestingUser?.id === complaint.citizen_id;

  if (!canSeeCitizenData) {
    c.citizen_id = '***PRIVATE***';
    c.citizen_email = undefined;
    if (c.is_anonymous) {
      c.location = c.location ? c.location.split(',')[0] + ', [Protected]' : '[Protected]';
      c.latitude = null;
      c.longitude = null;
    }
  }
  return c;
}

// GET /api/complaints
export async function listComplaints(req, res) {
  try {
    const db = getDb();
    const { status, category, department, page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereParts = [];
    let params = [];

    if (req.user.role === 'CITIZEN') {
      whereParts.push('c.citizen_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'INVESTIGATOR') {
      whereParts.push('(c.investigator_id = ? OR c.status IN (\'ASSIGNED\',\'INVESTIGATING\'))');
      params.push(req.user.id);
    }

    if (status) { whereParts.push('c.status = ?'); params.push(status.toUpperCase()); }
    if (category) { whereParts.push('c.category = ?'); params.push(category); }
    if (department) { whereParts.push('c.assigned_department = ?'); params.push(department); }
    if (search) {
      whereParts.push('(c.title LIKE ? OR c.description LIKE ? OR c.complaint_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const total = await db.get(`SELECT COUNT(*) as cnt FROM complaints c ${whereClause}`, params);
    const complaints = await db.all(
      `SELECT c.*, u.name as citizen_name, o.name as officer_name, inv.name as investigator_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       LEFT JOIN users o ON c.assigned_officer_id = o.id
       LEFT JOIN users inv ON c.investigator_id = inv.id
       ${whereClause}
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      complaints: complaints.map(c => safeComplaint(c, req.user)),
      pagination: {
        total: total.cnt, page: parseInt(page),
        limit: parseInt(limit), pages: Math.ceil(total.cnt / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('List complaints error:', err);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
}

// GET /api/complaints/:id
export async function getComplaint(req, res) {
  try {
    const db = getDb();
    const complaint = await db.get(
      `SELECT c.*, u.name as citizen_name, u.email as citizen_email,
              o.name as officer_name, o.department as officer_department,
              inv.name as investigator_name, v.name as verifier_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       LEFT JOIN users o ON c.assigned_officer_id = o.id
       LEFT JOIN users inv ON c.investigator_id = inv.id
       LEFT JOIN users v ON c.verifier_id = v.id
       WHERE c.id = ?`,
      req.params.id
    );
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    if (!checkUserComplaintAccess(req.user, complaint)) {
      return res.status(403).json({ error: 'Access denied: not authorized to view this complaint' });
    }

    const evidence = await db.all(
      `SELECT e.id, e.filename, e.original_name, e.file_size, e.mime_type,
              e.sha256_hash, e.blockchain_hash, e.description, e.is_investigation_evidence,
              e.created_at, u.name as uploaded_by_name
       FROM evidence e LEFT JOIN users u ON e.uploaded_by = u.id
       WHERE e.complaint_id = ? ORDER BY e.created_at ASC`,
      req.params.id
    );

    const events = await db.all(
      `SELECT ce.*, u.name as performer_name
       FROM complaint_events ce LEFT JOIN users u ON ce.performed_by = u.id
       WHERE ce.complaint_id = ? ORDER BY ce.created_at ASC`,
      req.params.id
    );

    const feedback = await db.get(
      'SELECT f.*, u.name as citizen_name FROM citizen_feedback f LEFT JOIN users u ON f.citizen_id = u.id WHERE f.complaint_id = ?',
      req.params.id
    );

    res.json({ complaint: safeComplaint(complaint, req.user), evidence, timeline: events, feedback: feedback || null });
  } catch (err) {
    console.error('Get complaint error:', err);
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
}

// POST /api/complaints
export async function createComplaint(req, res) {
  try {
    const { category, title, description, location, latitude, longitude, is_anonymous, priority } = req.body;

    if (!category || !title || !description || !location) {
      return res.status(400).json({ error: 'Category, title, description and location are required' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Valid: ${CATEGORIES.join(', ')}` });
    }

    const db = getDb();
    const blockchainService = getBlockchainService();
    const complaintId = uuidv4();
    const complaintNumber = generateComplaintNumber();
    const now = new Date().toISOString();

    let bcResult = { txId: 'PENDING', payloadHash: null, mode: 'error' };
    try {
      bcResult = await blockchainService.createComplaint({
        complaintId, citizenId: req.user.id, category, location, title
      });
    } catch (bcErr) {
      console.error('Blockchain error (non-fatal):', bcErr.message);
    }

    await db.run(
      `INSERT INTO complaints (id, complaint_number, citizen_id, category, title, description, location, latitude, longitude, status, priority, is_anonymous, blockchain_tx_id, blockchain_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [complaintId, complaintNumber, req.user.id, category, title.trim(), description.trim(),
       location.trim(), latitude || null, longitude || null, 'REPORTED',
       priority || 'MEDIUM', is_anonymous ? 1 : 0, bcResult.txId, bcResult.payloadHash, now, now]
    );

    await db.run(
      `INSERT INTO complaint_events (id, complaint_id, event_type, from_status, to_status, performed_by, performer_role, notes, blockchain_tx_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), complaintId, 'REPORTED', null, 'REPORTED', req.user.id, req.user.role,
       'Complaint submitted by citizen', bcResult.txId, now]
    );

    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', complaintId);
    res.status(201).json({
      message: 'Complaint submitted successfully',
      complaint,
      blockchain: { txId: bcResult.txId, mode: bcResult.mode }
    });
  } catch (err) {
    console.error('Create complaint error:', err);
    res.status(500).json({ error: 'Failed to create complaint' });
  }
}

// Generic lifecycle transition handler
async function handleTransition(req, res, action, allowedRoles, getAdditionalUpdates) {
  try {
    const db = getDb();
    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Only ${allowedRoles.join(' or ')} can perform this action` });
    }

    const blockchainService = getBlockchainService();
    const { notes } = req.body;

    let bcResult;
    try {
      bcResult = await blockchainService.transitionComplaint(
        complaint.id, action, req.user.id, req.user.role, notes, req.body
      );
    } catch (bcErr) {
      if (bcErr.message.includes('Invalid state transition')) {
        return res.status(400).json({ error: bcErr.message });
      }
      console.error('Blockchain transition error (non-fatal):', bcErr.message);
      const toStatus = ACTION_TO_STATUS[action];
      validateTransition(complaint.status, toStatus);
      bcResult = { txId: 'PENDING', toStatus, fromStatus: complaint.status, mode: 'error' };
    }

    const now = new Date().toISOString();
    const toStatus = ACTION_TO_STATUS[action];
    const additionalUpdates = getAdditionalUpdates ? getAdditionalUpdates(req) : {};

    // Build dynamic update query
    const updateData = { status: toStatus, updated_at: now, blockchain_tx_id: bcResult.txId, ...additionalUpdates };
    const setClauses = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE complaints SET ${setClauses} WHERE id = ?`, [...Object.values(updateData), complaint.id]);

    await db.run(
      `INSERT INTO complaint_events (id, complaint_id, event_type, from_status, to_status, performed_by, performer_role, notes, blockchain_tx_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), complaint.id, toStatus, complaint.status, toStatus, req.user.id, req.user.role, notes || null, bcResult.txId, now]
    );

    const updated = await db.get('SELECT * FROM complaints WHERE id = ?', complaint.id);
    res.json({
      message: `Complaint status updated to ${toStatus}`,
      complaint: updated,
      blockchain: { txId: bcResult.txId, mode: bcResult.mode || 'mock' }
    });
  } catch (err) {
    console.error(`Transition (${action}) error:`, err);
    res.status(500).json({ error: `Failed to perform action: ${err.message}` });
  }
}

export const registerComplaint = (req, res) =>
  handleTransition(req, res, 'register', ['AUTHORITY', 'ADMIN'], null);

export async function assignComplaint(req, res) {
  const { officer_id, department } = req.body;
  if (!officer_id || !department) {
    return res.status(400).json({ error: 'officer_id and department are required' });
  }
  const db = getDb();
  const officer = await db.get('SELECT * FROM users WHERE id = ? AND is_active = 1', officer_id);
  if (!officer) return res.status(404).json({ error: 'Officer not found' });

  return handleTransition(req, res, 'assign', ['AUTHORITY', 'ADMIN'], () => ({
    assigned_officer_id: officer_id,
    assigned_department: department
  }));
}

export const investigateComplaint = (req, res) =>
  handleTransition(req, res, 'investigate', ['INVESTIGATOR', 'AUTHORITY', 'ADMIN'], (r) => ({
    investigator_id: r.user.id
  }));

export const verifyComplaint = (req, res) =>
  handleTransition(req, res, 'verify', ['VERIFIER', 'ADMIN'], (r) => ({
    verifier_id: r.user.id,
    verification_details: r.body.verification_details || null
  }));

export const takeAction = (req, res) =>
  handleTransition(req, res, 'action', ['AUTHORITY', 'ADMIN'], null);

export const resolveComplaint = (req, res) =>
  handleTransition(req, res, 'resolve', ['AUTHORITY', 'INVESTIGATOR', 'ADMIN'], (r) => ({
    resolution_details: r.body.resolution_details || null
  }));

export const verifyResolution = (req, res) =>
  handleTransition(req, res, 'verify-resolution', ['VERIFIER', 'CITIZEN', 'ADMIN'], null);

export const closeComplaint = (req, res) =>
  handleTransition(req, res, 'close', ['ADMIN', 'AUTHORITY'], null);

// GET /api/complaints/:id/history
export async function getComplaintHistory(req, res) {
  try {
    const db = getDb();
    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    if (req.user.role === 'CITIZEN' && complaint.citizen_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const events = await db.all(
      `SELECT ce.*, u.name as performer_name
       FROM complaint_events ce LEFT JOIN users u ON ce.performed_by = u.id
       WHERE ce.complaint_id = ? ORDER BY ce.created_at ASC`,
      req.params.id
    );

    const blockchainHistory = await getBlockchainService().getComplaintHistory(req.params.id);

    res.json({
      complaintId: req.params.id,
      complaintNumber: complaint.complaint_number,
      currentStatus: complaint.status,
      events,
      blockchainRecords: blockchainHistory
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

export async function submitCitizenFeedback(req, res) {
  try {
    const { rating, comments } = req.body;
    const numRating = parseInt(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'Rating between 1 and 5 is required' });
    }

    const db = getDb();
    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    if (req.user.role === 'CITIZEN' && complaint.citizen_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the citizen who filed this complaint can submit feedback' });
    }

    if (!['RESOLVED', 'RESOLUTION_VERIFIED', 'CLOSED'].includes(complaint.status)) {
      return res.status(400).json({ error: 'Feedback can only be submitted after complaint is resolved or closed' });
    }

    const existing = await db.get('SELECT id FROM citizen_feedback WHERE complaint_id = ?', req.params.id);
    if (existing) {
      return res.status(400).json({ error: 'Feedback has already been submitted for this complaint' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const txId = `TX:FEEDBACK:${req.params.id.slice(-6).toUpperCase()}:${Date.now().toString(16).toUpperCase()}`;

    // Anchor feedback onto the cryptographic hash-chain ledger
    const blockchainService = getBlockchainService();
    const bcRec = await blockchainService.recordFeedback({
      complaintId: req.params.id,
      rating: numRating,
      comments,
      citizenId: req.user.id,
      txId
    });

    await db.run(
      `INSERT INTO citizen_feedback (id, complaint_id, citizen_id, rating, comments, blockchain_tx_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, req.user.id, numRating, comments || null, bcRec.txId, now]
    );

    await db.run(
      `INSERT INTO complaint_events (id, complaint_id, event_type, from_status, to_status, performed_by, performer_role, notes, blockchain_tx_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), req.params.id, 'CITIZEN_FEEDBACK', complaint.status, complaint.status, req.user.id, req.user.role, `Citizen Rating: ${numRating}/5 Stars. Comments: ${comments || 'None'}`, bcRec.txId, now]
    );

    res.status(201).json({
      message: 'Citizen feedback and rating recorded on ledger',
      feedback: { id, rating: numRating, comments, blockchain_tx_id: bcRec.txId, created_at: now }
    });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
}

export { CATEGORIES };
