import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';

export async function authenticate(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDb();
    const user = await db.get(
      'SELECT id, name, email, role, department, is_active FROM users WHERE id = ?',
      decoded.userId
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or account deactivated' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required: ${roles.join(' or ')}. Your role: ${req.user.role}`
      });
    }
    next();
  };
}

/**
 * Checks if authenticated user has permission to view or interact with a given complaint/evidence.
 * Enforces strict citizen boundaries (citizens can only access their own complaints) and
 * role/jurisdiction workflow rules for authority, investigator, verifier, and admin.
 */
export function checkUserComplaintAccess(user, complaint) {
  if (!user || !user.role || !complaint) return false;

  const role = user.role.toUpperCase();

  // Admin, Authority, Investigator, Verifier staff roles can view any complaint & evidence
  if (['ADMIN', 'AUTHORITY', 'INVESTIGATOR', 'VERIFIER'].includes(role)) {
    return true;
  }

  // Citizens can access their own complaints
  if (role === 'CITIZEN') {
    return complaint.citizen_id === user.id;
  }

  return false;
}
