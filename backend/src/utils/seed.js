import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { initDatabase, getDb } from '../config/database.js';
import { getBlockchainService } from '../services/blockchainService.js';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;

const testUsers = [
  {
    name: 'Admin User',
    email: 'admin@civicchain.gov',
    phone: '9000000001',
    password: 'Admin@123',
    role: 'ADMIN',
    department: 'Administration',
    badge_number: 'ADM001'
  },
  {
    name: 'Rajesh Kumar',
    email: 'citizen@example.com',
    phone: '9000000002',
    password: 'Citizen@123',
    role: 'CITIZEN',
    city: 'Chennai',
    state: 'Tamil Nadu'
  },
  {
    name: 'Priya Sharma',
    email: 'citizen2@example.com',
    phone: '9000000003',
    password: 'Citizen@123',
    role: 'CITIZEN',
    city: 'Mumbai',
    state: 'Maharashtra'
  },
  {
    name: 'Officer Venkat',
    email: 'authority@civicchain.gov',
    phone: '9000000004',
    password: 'Authority@123',
    role: 'AUTHORITY',
    department: 'Roads & Infrastructure',
    badge_number: 'AUTH001'
  },
  {
    name: 'Investigator Ravi',
    email: 'investigator@civicchain.gov',
    phone: '9000000005',
    password: 'Investigator@123',
    role: 'INVESTIGATOR',
    department: 'Investigation Unit',
    badge_number: 'INV001'
  },
  {
    name: 'Verifier Meena',
    email: 'verifier@civicchain.gov',
    phone: '9000000006',
    password: 'Verifier@123',
    role: 'VERIFIER',
    department: 'Quality Assurance',
    badge_number: 'VER001'
  }
];

const sampleComplaints = [
  {
    title: 'Severe water pipe leakage flooding arterial road',
    category: 'Water Supply',
    description: 'Main pipeline ruptured near Market Junction. Clean drinking water wasted and inundating street.',
    location: 'Market Road, Ward 12',
    priority: 'HIGH',
    status: 'REPORTED',
    is_anonymous: 0
  },
  {
    title: 'Non-functional streetlights across entire residential sector',
    category: 'Streetlights',
    description: '14 consecutive poles have blown fixtures for 3 weeks, creating safety hazard for pedestrians after 7 PM.',
    location: 'Sector 5, Cross 4, Ward 8',
    priority: 'MEDIUM',
    status: 'REGISTERED',
    department: 'Electricity & Public Lighting',
    is_anonymous: 0
  },
  {
    title: 'Clogged storm water drain overflowing into hospital access road',
    category: 'Drainage',
    description: 'Monsoon silt and plastic waste blocking drain culvert, blocking ambulance access path.',
    location: 'Civil Hospital Lane, Ward 3',
    priority: 'HIGH',
    status: 'ASSIGNED',
    department: 'Drainage & Stormwater',
    is_anonymous: 0
  },
  {
    title: 'Cracked boundary wall at Government High School',
    category: 'Government Schools',
    description: 'Structural cracks visible after heavy rain. Poses danger to students during play hours.',
    location: 'Govt School Compound, Ward 7',
    priority: 'HIGH',
    status: 'INVESTIGATING',
    department: 'Public Works & Education',
    is_anonymous: 1
  },
  {
    title: 'Illegal garbage dumping behind Community Health Centre',
    category: 'Sanitation',
    description: 'Medical and municipal waste dumped openly. Foul odor and health hazard.',
    location: 'Health Centre Bypass, Ward 15',
    priority: 'MEDIUM',
    status: 'VERIFIED',
    department: 'Sanitation & Health',
    is_anonymous: 0
  },
  {
    title: 'Repaired pedestrian foot-overbridge handrails',
    category: 'Roads',
    description: 'Corroded railings welded and reinforced with new galvanized steel supports.',
    location: 'Railway Station Footbridge, Ward 1',
    priority: 'LOW',
    status: 'RESOLVED',
    department: 'Roads & Infrastructure',
    is_anonymous: 0
  }
];

function mockTx(type, id) {
  const ts = Date.now().toString(16).toUpperCase();
  const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `TX:${type}:${(id || 'SYS').slice(-6).toUpperCase()}:${ts}:${rand}`;
}

async function seed() {
  await initDatabase();
  const db = getDb();

  console.log('🌱 Seeding database with users and civic records...\n');

  const userMap = {};

  for (const u of testUsers) {
    let existing = await db.get('SELECT id FROM users WHERE email = ?', u.email);
    if (!existing) {
      const id = uuidv4();
      const hash = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
      const now = new Date().toISOString();

      await db.run(
        `INSERT INTO users (id, name, email, phone, password_hash, role, department, badge_number, city, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, u.name, u.email, u.phone || null, hash, u.role,
         u.department || null, u.badge_number || null, u.city || null, u.state || null, now, now]
      );
      userMap[u.role] = id;
      console.log(`  ✅ Created: ${u.name} (${u.role})`);
    } else {
      userMap[u.role] = existing.id;
      console.log(`  ⏭  Found existing user: ${u.email}`);
    }
  }

  // Seed sample complaints if table has few records
  const count = await db.get('SELECT COUNT(*) as c FROM complaints');
  if (count && count.c < 3) {
    console.log('\n🌱 Seeding realistic complaint portfolio...');
    let seq = 1001;
    for (const c of sampleComplaints) {
      const id = uuidv4();
      const num = `CC-${new Date().getFullYear()}-${String(seq++).padStart(5, '0')}`;
      const now = new Date().toISOString();
      const txId = mockTx('SEED', id);

      const bcRec = await getBlockchainService().appendRecord({
        complaintId: id,
        eventType: `STATE_${c.status}`,
        payload: {
          type: `STATE_${c.status}`,
          complaintId: id,
          title: c.title,
          category: c.category,
          status: c.status,
          timestamp: now
        },
        txId,
        customTimestamp: now
      });

      await db.run(
        `INSERT INTO complaints (id, complaint_number, citizen_id, category, title, description, location, status, priority, is_anonymous, assigned_department, blockchain_tx_id, blockchain_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, num, userMap['CITIZEN'], c.category, c.title, c.description, c.location, c.status, c.priority, c.is_anonymous, c.department || null, bcRec.txId, bcRec.recordHash, now, now]
      );

      await db.run(
        `INSERT INTO complaint_events (id, complaint_id, event_type, from_status, to_status, performed_by, performer_role, notes, blockchain_tx_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), id, c.status, null, c.status, userMap['CITIZEN'], 'CITIZEN', 'Complaint recorded on ledger', bcRec.txId, now]
      );

      console.log(`  ✅ Seeded complaint: ${num} - ${c.title} [${c.status}]`);
    }
  }

  console.log('\n✅ Seeding complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST ACCOUNTS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  testUsers.forEach(u => {
    console.log(`  ${u.role.padEnd(15)} ${u.email.padEnd(38)} ${u.password}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
