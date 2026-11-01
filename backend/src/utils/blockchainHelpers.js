import { getDb } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getBlockchainService, ACTION_TO_STATUS } from '../services/blockchainService.js';

const MODE = process.env.BLOCKCHAIN_MODE || 'mock';

// ─── State machine ────────────────────────────────────────────────────────────
export const COMPLAINT_STATUSES = [
  'REPORTED', 'REGISTERED', 'ASSIGNED', 'INVESTIGATING',
  'VERIFIED', 'ACTION_TAKEN', 'RESOLVED', 'RESOLUTION_VERIFIED', 'CLOSED'
];

const VALID_TRANSITIONS = {
  REPORTED:             ['REGISTERED'],
  REGISTERED:           ['ASSIGNED'],
  ASSIGNED:             ['INVESTIGATING'],
  INVESTIGATING:        ['VERIFIED'],
  VERIFIED:             ['ACTION_TAKEN'],
  ACTION_TAKEN:         ['RESOLVED'],
  RESOLVED:             ['RESOLUTION_VERIFIED'],
  RESOLUTION_VERIFIED:  ['CLOSED'],
  CLOSED:               []
};

function validateTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) throw new Error(`Unknown status: ${from}`);
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. ` +
      `Allowed next states: [${allowed.join(', ') || 'none'}]`
    );
  }
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function mockTxId(type, complaintId) {
  const ts = Date.now().toString(16).toUpperCase();
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `MOCK:${type}:${(complaintId || 'SYSTEM').slice(-8).toUpperCase()}:${ts}:${rand}`;
}

// Async mock blockchain adapter that appends to cryptographic hash chain
async function createBlockchainRecord(db, txId, complaintId, eventType, payloadHash, mode = 'mock') {
  const service = getBlockchainService();
  return await service.appendRecord({
    complaintId,
    eventType,
    payload: { eventType, complaintId, payloadHash },
    txId
  });
}

export { validateTransition, VALID_TRANSITIONS };
