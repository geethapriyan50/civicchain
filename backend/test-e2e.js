import http from 'http';
import fs from 'fs';
import path from 'path';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: body, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      if (typeof data === 'string' || Buffer.isBuffer(data)) {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

function uploadFile(options, filePath, fieldName, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----CivicChainBoundary' + Date.now();
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    let pre = `--${boundary}\r\n`;
    pre += `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n`;
    pre += `Content-Type: image/jpeg\r\n\r\n`;

    const post = `\r\n--${boundary}--\r\n`;
    const fullBody = Buffer.concat([Buffer.from(pre, 'utf8'), fileData, Buffer.from(post, 'utf8')]);

    options.headers = {
      ...options.headers,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length,
      'Authorization': `Bearer ${token}`
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting CivicChain End-to-End Integration Test Suite...\n');
  try {
    await import('./src/server.js');
    await new Promise(r => setTimeout(r, 1000));
  } catch (_) {}
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    });
    assert(health.status === 200 && health.data.status === 'ok', 'Health check returns status ok');

    // 2. Login as Citizen
    const citizenLogin = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@example.com', password: 'Citizen@123' });
    assert(citizenLogin.status === 200 && citizenLogin.data.token, 'Citizen login successful');
    const citizenToken = citizenLogin.data.token;

    // 3. Login as Authority
    const authorityLogin = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'authority@civicchain.gov', password: 'Authority@123' });
    assert(authorityLogin.status === 200 && authorityLogin.data.token, 'Authority login successful');
    const authorityToken = authorityLogin.data.token;

    // 4. Login as Investigator
    const investigatorLogin = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'investigator@civicchain.gov', password: 'Investigator@123' });
    assert(investigatorLogin.status === 200 && investigatorLogin.data.token, 'Investigator login successful');
    const investigatorToken = investigatorLogin.data.token;
    const investigatorId = investigatorLogin.data.user.id;

    // 5. Login as Verifier
    const verifierLogin = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'verifier@civicchain.gov', password: 'Verifier@123' });
    assert(verifierLogin.status === 200 && verifierLogin.data.token, 'Verifier login successful');
    const verifierToken = verifierLogin.data.token;

    // 6. Citizen creates a complaint
    const createRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/complaints',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      }
    }, {
      category: 'Roads',
      title: 'Massive pothole near Main Street Cross',
      description: 'Severe road surface damage causing traffic accidents and tire bursts. Over 3 feet wide.',
      location: 'Ward 4, North Cross Road, Main Street',
      latitude: 12.9716,
      longitude: 77.5946,
      is_anonymous: false
    });
    assert(createRes.status === 201 && createRes.data.complaint, 'Complaint created with status REPORTED');
    const complaint = createRes.data.complaint;
    const complaintId = complaint.id;

    // 7. Authority registers the complaint (REPORTED -> REGISTERED)
    const registerRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/register`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authorityToken}`
      }
    }, {
      department: 'Roads & Infrastructure',
      notes: 'Verified as valid civic jurisdiction issue.'
    });
    assert(registerRes.status === 200 && registerRes.data.complaint.status === 'REGISTERED', 'Complaint transitioned to REGISTERED');

    // 8. Authority assigns to investigator (REGISTERED -> ASSIGNED)
    const assignRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/assign`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authorityToken}`
      }
    }, {
      officer_id: investigatorId,
      department: 'Roads & Infrastructure',
      notes: 'Assigned to field inspector Ravi for site visit.'
    });
    assert(assignRes.status === 200 && assignRes.data.complaint.status === 'ASSIGNED', 'Complaint transitioned to ASSIGNED');

    // 9. Investigator starts investigation (ASSIGNED -> INVESTIGATING)
    const investRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/investigate`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${investigatorToken}`
      }
    }, {
      notes: 'Site inspection conducted. Sub-base failure identified.'
    });
    assert(investRes.status === 200 && investRes.data.complaint.status === 'INVESTIGATING', 'Complaint transitioned to INVESTIGATING');

    // 10. Verifier verifies report (INVESTIGATING -> VERIFIED)
    const verifyRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/verify`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${verifierToken}`
      }
    }, {
      notes: 'Site report matches municipal geo-tagging data. Approved for emergency repair.'
    });
    assert(verifyRes.status === 200 && verifyRes.data.complaint.status === 'VERIFIED', 'Complaint transitioned to VERIFIED');

    // 11. Authority takes action (VERIFIED -> ACTION_TAKEN)
    const actionRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/action`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authorityToken}`
      }
    }, {
      notes: 'Road repair contractor dispatched with asphalt batch #409.'
    });
    assert(actionRes.status === 200 && actionRes.data.complaint.status === 'ACTION_TAKEN', 'Complaint transitioned to ACTION_TAKEN');

    // 12. Authority resolves complaint (ACTION_TAKEN -> RESOLVED)
    const resolveRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/resolve`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authorityToken}`
      }
    }, {
      resolution_details: 'Asphalt resurfaced, roller compacted, cured for 6 hours.'
    });
    assert(resolveRes.status === 200 && resolveRes.data.complaint.status === 'RESOLVED', 'Complaint transitioned to RESOLVED');

    // 13. Verifier verifies resolution (RESOLVED -> RESOLUTION_VERIFIED)
    const resVerifyRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/verify-resolution`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${verifierToken}`
      }
    }, {
      notes: 'Post-repair inspection confirmed smooth finish and drainage slope.'
    });
    assert(resVerifyRes.status === 200 && resVerifyRes.data.complaint.status === 'RESOLUTION_VERIFIED', 'Complaint transitioned to RESOLUTION_VERIFIED');

    // 14. Authority closes complaint (RESOLUTION_VERIFIED -> CLOSED)
    const closeRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/close`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authorityToken}`
      }
    }, {
      notes: 'Case formally closed. Citizen notified.'
    });
    assert(closeRes.status === 200 && closeRes.data.complaint.status === 'CLOSED', 'Complaint transitioned to CLOSED');

    // 15. Invalid transition test: Attempting to investigate a CLOSED complaint must fail!
    const invalidRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/investigate`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${investigatorToken}`
      }
    }, {
      notes: 'Illegal attempt to reopen closed complaint.'
    });
    assert(invalidRes.status === 400, 'Invalid state transition from CLOSED is strictly rejected (HTTP 400)');

    // 16. Audit trail & blockchain history
    const historyRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/history`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${citizenToken}`
      }
    });
    assert(historyRes.status === 200 && Array.isArray(historyRes.data.events) && historyRes.data.events.length >= 8,
      `Immutable audit history contains all lifecycle steps (${historyRes.data.events?.length} events)`);

    // 17. Unauthorized action test: Citizen cannot close complaints
    const unauthorizedRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/close`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      }
    }, { notes: 'Citizen trying to close' });
    assert(unauthorizedRes.status === 403, 'RBAC prevents unauthorized citizen from executing administrative transitions (HTTP 403)');

    // 18. Dashboard statistics check
    const dashRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/dashboard/authority',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authorityToken}`
      }
    });
    assert(dashRes.status === 200 && dashRes.data.stats, 'Dashboard statistics returned for authorized officers');

    // 19. Citizen Feedback & 5-Star Rating submission
    const feedbackRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/complaints/${complaintId}/feedback`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizenToken}`
      }
    }, {
      rating: 5,
      comments: 'Excellent and swift road repair. Asphalt surface is completely level.'
    });
    assert(feedbackRes.status === 201 && feedbackRes.data.feedback?.blockchain_tx_id,
      'Citizen resolution rating & feedback anchored to ledger with transaction ID');

    // 20. Blockchain Explorer Data Query
    const explorerRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/blockchain/explorer',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${citizenToken}`
      }
    });
    assert(explorerRes.status === 200 && explorerRes.data.summary?.totalTransactions > 0,
      `Ledger Explorer retrieved active blocks & ${explorerRes.data.summary?.totalTransactions} transactions`);

    // 21. Cryptographic Tamper & Ledger Integrity Audit
    const auditRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/blockchain/verify-integrity',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authorityToken}`
      }
    });
    assert(auditRes.status === 200 && auditRes.data.verified === true && auditRes.data.discrepancies === 0,
      `Cryptographic integrity audit confirmed: zero tampering detected (${auditRes.data.totalRecordsAudited} records checked)`);

    console.log(`\n========================================`);
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }

  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
