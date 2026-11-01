

/**
 * CivicChain Comprehensive Backend Fixes Verification Suite
 *
 * Tests:
 * 1. Evidence upload & persistence only after successful storage write
 * 2. SHA-256 digest calculated and anchored in cryptographic hash chain
 * 3. Evidence integrity verification (intact file)
 * 4. Tamper detection on modified files (status: 'MISMATCH', verified: false)
 * 5. Missing file handling (status: 'MISSING_FILE', verified: false, NEVER verified: true)
 * 6. Authenticated evidence endpoints & static route protection (/api/evidence/:id/file, /uploads/evidence/:filename)
 * 7. Role and complaint scope authorization checks (cross-citizen denial, 401 unauth, 403 forbidden)
 * 8. Cryptographic hash-chain ledger integrity: sequential block linking, previous_hash verification
 * 9. Tamper detection on broken previous-hash links
 * 10. Failed upload handling & orphan cleanup (invalid MIME, empty payload, non-existent complaint)
 * 11. Honest Fabric / mock mode reporting and connection status
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5000;
const HOST = '127.0.0.1';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, ...options }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: body });
        } catch (_) {
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

function uploadBuffer(urlPath, fileBuffer, fileName, mimeType, token, extraFields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----CivicChainBoundary' + Date.now() + Math.random().toString(36).substring(2);
    let parts = [];

    // Add extra text fields if any
    for (const [key, val] of Object.entries(extraFields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`,
        'utf8'
      ));
    }

    if (fileBuffer !== null) {
      let fileHead = `--${boundary}\r\n`;
      fileHead += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
      fileHead += `Content-Type: ${mimeType}\r\n\r\n`;
      parts.push(Buffer.from(fileHead, 'utf8'));
      parts.push(fileBuffer);
      parts.push(Buffer.from('\r\n', 'utf8'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    const fullBody = Buffer.concat(parts);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      host: HOST,
      port: PORT,
      path: urlPath,
      method: 'POST',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 CivicChain Backend Fixes - Comprehensive Verification Suite');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Start the server for testing
  await import('./src/server.js');
  await new Promise(r => setTimeout(r, 1000));

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, extra = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${extra ? `(${extra})` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Health check & honest status
    console.log('📍 1. Health check & honest reporting');
    const health = await request({ path: '/api/health', method: 'GET' });
    assert(health.status === 200 && health.data.status === 'ok', 'Health endpoint returns 200 OK');
    assert(health.data.isMock === true && health.data.fabric_connected === false,
      'Health endpoint honestly reports mock mode and fabric_connected: false');

    // 2. Auth: Citizen A and Citizen B
    console.log('\n📍 2. User authentication');
    const citALogin = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@example.com', password: 'Citizen@123' });
    assert(citALogin.status === 200 && citALogin.data.token, 'Citizen A login successful');
    const tokenA = citALogin.data.token;
    const userA = citALogin.data.user;

    const citBLogin = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen2@example.com', password: 'Citizen@123' });
    assert(citBLogin.status === 200 && citBLogin.data.token, 'Citizen B login successful');
    const tokenB = citBLogin.data.token;
    const userB = citBLogin.data.user;

    const authLogin = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'authority@civicchain.gov', password: 'Authority@123' });
    const tokenAuth = authLogin.data.token;

    // 3. Citizen A files complaint
    console.log('\n📍 3. Complaint creation');
    const compRes = await request({
      path: '/api/complaints',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      }
    }, {
      category: 'Water Supply',
      title: 'Water pipe rupture on Park Avenue',
      description: 'Major leak leaking drinking water into the roadway',
      location: 'Park Avenue Ward 3',
      priority: 'HIGH'
    });
    assert(compRes.status === 201 && compRes.data.complaint?.id, 'Citizen A created complaint');
    const complaintA = compRes.data.complaint;
    const complaintIdA = complaintA.id;

    // 4. Evidence upload by Citizen A
    console.log('\n📍 4. Evidence upload, hashing, and ledger anchoring');
    const originalFileBytes = Buffer.from('CIVIC_EVIDENCE_ORIGINAL_PHOTO_DATA_BYTES_TEST_123', 'utf8');
    const expectedOriginalHash = crypto.createHash('sha256').update(originalFileBytes).digest('hex');

    const uploadRes = await uploadBuffer(
      `/api/complaints/${complaintIdA}/evidence`,
      originalFileBytes,
      'pipe_leak.jpg',
      'image/jpeg',
      tokenA,
      { description: 'Pipe rupture captured on site' }
    );
    assert(uploadRes.status === 201, 'Evidence uploaded successfully (HTTP 201)');
    assert(uploadRes.data.evidence?.sha256_hash === expectedOriginalHash,
      'SHA-256 calculated from written storage bytes matches expected hash');
    assert(uploadRes.data.integrity?.disclaimer?.includes('does not establish that the photo is genuine'),
      'Upload response includes proper integrity disclaimer');

    const evidenceA = uploadRes.data.evidence;
    const evidenceIdA = evidenceA.id;
    const evidenceFilenameA = evidenceA.filename;

    // 5. Verify intact evidence
    console.log('\n📍 5. Evidence verification (intact file)');
    const verifyIntact = await request({
      path: `/api/evidence/${evidenceIdA}/verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(verifyIntact.status === 200, 'Verify endpoint returned 200 OK');
    assert(verifyIntact.data.status === 'VERIFIED', 'Status is VERIFIED');
    assert(verifyIntact.data.verified === true, 'verified is true');
    assert(verifyIntact.data.expectedHash === expectedOriginalHash, 'expectedHash matches original');
    assert(verifyIntact.data.actualHash === expectedOriginalHash, 'actualHash matches original');
    assert(verifyIntact.data.disclaimer?.includes('A hash match establishes file integrity'),
      'Verification includes required disclaimer');

    // 6. Authenticated evidence endpoints & static route protection
    console.log('\n📍 6. Protected evidence file endpoints');

    // Unauthenticated GET /api/evidence/:id/file -> 401
    const unauthApiFile = await request({
      path: `/api/evidence/${evidenceIdA}/file`,
      method: 'GET'
    });
    assert(unauthApiFile.status === 401, 'Unauthenticated /api/evidence/:id/file rejected with 401');

    // Unauthenticated GET /uploads/evidence/:filename -> 401
    const unauthStaticFile = await request({
      path: `/uploads/evidence/${evidenceFilenameA}`,
      method: 'GET'
    });
    assert(unauthStaticFile.status === 401, 'Unauthenticated /uploads/evidence/:filename rejected with 401');

    // Authenticated GET /api/evidence/:id/file by Citizen A -> 200
    const authApiFile = await request({
      path: `/api/evidence/${evidenceIdA}/file`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(authApiFile.status === 200, 'Authenticated Citizen A can download /api/evidence/:id/file');
    assert(authApiFile.raw === originalFileBytes.toString('utf8'), 'Downloaded file content matches uploaded bytes');

    // Authenticated GET /uploads/evidence/:filename by Citizen A -> 200
    const authStaticFile = await request({
      path: `/uploads/evidence/${evidenceFilenameA}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(authStaticFile.status === 200, 'Authenticated Citizen A can download /uploads/evidence/:filename');

    // Authenticated via query token (?token=...)
    const queryTokenFile = await request({
      path: `/api/evidence/${evidenceIdA}/file?token=${tokenA}`,
      method: 'GET'
    });
    assert(queryTokenFile.status === 200, 'Query parameter token (?token=...) accepted for direct file links');

    // 7. Role and complaint scope authorization checks
    console.log('\n📍 7. Cross-citizen & role scope authorization restrictions');

    // Citizen B trying to read Citizen A's evidence metadata -> 403
    const citBReadMeta = await request({
      path: `/api/evidence/${evidenceIdA}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(citBReadMeta.status === 403, 'Citizen B reading Citizen A evidence metadata rejected with 403');

    // Citizen B trying to read Citizen A's evidence file -> 403
    const citBReadFile = await request({
      path: `/api/evidence/${evidenceIdA}/file`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(citBReadFile.status === 403, 'Citizen B accessing /api/evidence/:id/file rejected with 403');

    // Citizen B trying to download via filename route -> 403
    const citBStatic = await request({
      path: `/uploads/evidence/${evidenceFilenameA}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(citBStatic.status === 403, 'Citizen B accessing /uploads/evidence/:filename rejected with 403');

    // Citizen B trying to verify Citizen A's evidence -> 403
    const citBVerify = await request({
      path: `/api/evidence/${evidenceIdA}/verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(citBVerify.status === 403, 'Citizen B verifying Citizen A evidence rejected with 403');

    // Citizen B trying to upload evidence to Citizen A's complaint -> 403
    const citBUploadToA = await uploadBuffer(
      `/api/complaints/${complaintIdA}/evidence`,
      Buffer.from('MALICIOUS_INTRUDER_EVIDENCE', 'utf8'),
      'intruder.jpg',
      'image/jpeg',
      tokenB
    );
    assert(citBUploadToA.status === 403, 'Citizen B uploading to Citizen A complaint rejected with 403');

    // 8. Modified file tamper detection
    console.log('\n📍 8. Tamper detection on modified files');
    const storageFilePath = path.resolve(__dirname, '../uploads/evidence', evidenceFilenameA);
    assert(fs.existsSync(storageFilePath), 'Evidence file exists on storage disk');

    // Overwrite file on disk with tampered bytes
    const tamperedBytes = Buffer.from('MALICIOUSLY_ALTERED_BYTES_IN_STORAGE_CORRUPT', 'utf8');
    const tamperedHash = crypto.createHash('sha256').update(tamperedBytes).digest('hex');
    fs.writeFileSync(storageFilePath, tamperedBytes);

    const verifyTampered = await request({
      path: `/api/evidence/${evidenceIdA}/verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(verifyTampered.status === 200, 'Verify endpoint responded 200');
    assert(verifyTampered.data.status === 'MISMATCH', 'Tampered file reported with status: MISMATCH');
    assert(verifyTampered.data.verified === false, 'verified is strictly false on mismatch');
    assert(verifyTampered.data.expectedHash === expectedOriginalHash, 'expectedHash still references original trusted hash');
    assert(verifyTampered.data.actualHash === tamperedHash, 'actualHash reflects the tampered file bytes');

    // Ledger audit also detects tampered file
    const auditTampered = await request({
      path: '/api/blockchain/verify-integrity',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenAuth}` }
    });
    assert(auditTampered.data.verified === false, 'Ledger integrity audit detects tampering (verified: false)');
    assert(auditTampered.data.status === 'INTEGRITY_VIOLATION_DETECTED', 'Status is INTEGRITY_VIOLATION_DETECTED');
    const tamperedDetail = auditTampered.data.details?.find(d => d.id === evidenceIdA);
    assert(tamperedDetail && tamperedDetail.status === 'MISMATCH', 'Audit log flags the specific evidence with MISMATCH');

    // 9. Deleted file handling (MISSING_FILE, never verified: true)
    console.log('\n📍 9. Missing / deleted file detection');
    // Delete file from disk
    fs.unlinkSync(storageFilePath);
    assert(!fs.existsSync(storageFilePath), 'File successfully deleted from disk');

    const verifyDeleted = await request({
      path: `/api/evidence/${evidenceIdA}/verify`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(verifyDeleted.data.status === 'MISSING_FILE', 'Missing file reported as status: MISSING_FILE');
    assert(verifyDeleted.data.verified === false, 'verified is false (NEVER verified: true on missing file)');
    assert(verifyDeleted.data.actualHash === null, 'actualHash is null for missing file');

    // File download returns 404 with MISSING_FILE
    const getDeletedFile = await request({
      path: `/api/evidence/${evidenceIdA}/file`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(getDeletedFile.status === 404 && getDeletedFile.data.status === 'MISSING_FILE',
      'Download of missing file returns 404 with status: MISSING_FILE');

    // Ledger audit detects missing file
    const auditDeleted = await request({
      path: '/api/blockchain/verify-integrity',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenAuth}` }
    });
    assert(auditDeleted.data.verified === false, 'Ledger audit flags missing file as integrity violation');
    const missingDetail = auditDeleted.data.details?.find(d => d.id === evidenceIdA);
    assert(missingDetail && missingDetail.status === 'MISSING_FILE', 'Audit details show status: MISSING_FILE');

    // Clean up test evidence row so subsequent test runs start clean
    const { getDb } = await import('./src/config/database.js');
    const db = getDb();
    await db.run('DELETE FROM evidence WHERE id = ?', evidenceIdA);

    // 10. Failed uploads & orphan cleanup
    console.log('\n📍 10. Failed upload handling & orphan cleanup');

    // A: Invalid file type (.exe)
    const countBeforeInvalid = fs.readdirSync(path.resolve(__dirname, '../uploads/evidence')).length;
    const exeUpload = await uploadBuffer(
      `/api/complaints/${complaintIdA}/evidence`,
      Buffer.from('MZ_EXECUTABLE_BINARY_DATA', 'utf8'),
      'malware.exe',
      'application/x-msdownload',
      tokenA
    );
    assert(exeUpload.status === 400, 'Executable upload rejected with HTTP 400');
    assert(exeUpload.data.error?.includes('not allowed'), 'Clear error response for invalid file type');
    const countAfterInvalid = fs.readdirSync(path.resolve(__dirname, '../uploads/evidence')).length;
    assert(countAfterInvalid === countBeforeInvalid, 'No orphaned file left on disk after MIME rejection');

    // B: Missing file in request
    const emptyUpload = await uploadBuffer(
      `/api/complaints/${complaintIdA}/evidence`,
      null,
      'test.jpg',
      'image/jpeg',
      tokenA
    );
    assert(emptyUpload.status === 400, 'Upload without file payload rejected with HTTP 400');

    // C: Non-existent complaint ID
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const fakeCompUpload = await uploadBuffer(
      `/api/complaints/${nonExistentId}/evidence`,
      Buffer.from('TEMP_DATA', 'utf8'),
      'photo.jpg',
      'image/jpeg',
      tokenA
    );
    assert(fakeCompUpload.status === 404, 'Upload to non-existent complaint rejected with HTTP 404');
    const countAfterFake = fs.readdirSync(path.resolve(__dirname, '../uploads/evidence')).length;
    assert(countAfterFake === countBeforeInvalid, 'No orphaned file created on non-existent complaint upload');

    // 11. Mock hash-chain ledger integrity: broken previous-hash detection
    console.log('\n📍 11. Cryptographic hash-chain integrity & broken link detection');

    // Fetch the last record in the ledger
    const lastRecord = await db.get(
      'SELECT rowid, * FROM blockchain_records ORDER BY block_number DESC LIMIT 1'
    );
    assert(lastRecord && lastRecord.previous_hash && lastRecord.record_hash,
      'Ledger records have previous_hash and record_hash populated');

    // Tamper with previous_hash in the database row
    const originalPrevHash = lastRecord.previous_hash;
    const corruptedPrevHash = 'deadbeef' + originalPrevHash.slice(8);

    await db.run(
      'UPDATE blockchain_records SET previous_hash = ? WHERE rowid = ?',
      [corruptedPrevHash, lastRecord.rowid]
    );

    const auditBrokenChain = await request({
      path: '/api/blockchain/verify-integrity',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenAuth}` }
    });
    assert(auditBrokenChain.data.ledgerChain?.valid === false, 'Broken previous_hash link detected: ledgerChain.valid === false');
    assert(auditBrokenChain.data.verified === false, 'Overall verified is false');
    const chainError = auditBrokenChain.data.details?.find(d => d.type === 'LEDGER_CHAIN');
    assert(chainError && chainError.status === 'BROKEN_CHAIN_LINK', 'Audit log identifies BROKEN_CHAIN_LINK');

    // Restore the ledger row
    await db.run(
      'UPDATE blockchain_records SET previous_hash = ? WHERE rowid = ?',
      [originalPrevHash, lastRecord.rowid]
    );

    // 12. Fabric Mode connection status and honest error reporting
    console.log('\n📍 12. Fabric mode offline & error reporting');
    const { getBlockchainService, FabricBlockchainAdapter } = await import('./src/services/blockchainService.js');

    // Directly test the FabricBlockchainAdapter
    const fabricService = new FabricBlockchainAdapter();
    const fabricCheck = await fabricService.checkConnection();
    assert(fabricCheck.connected === false, 'Fabric adapter checkConnection() honestly reports connected: false');
    assert(fabricCheck.networkStatus === 'FABRIC_UNAVAILABLE', 'Fabric adapter reports status FABRIC_UNAVAILABLE');
    assert(fabricCheck.error?.includes('unreachable') || fabricCheck.error?.includes('certificate'),
      'Fabric adapter gives specific connection error reason');

    let fabricFailedHonest = false;
    try {
      await fabricService.createComplaint({ complaintId: 'test' });
    } catch (fErr) {
      fabricFailedHonest = fErr.message.includes('Fabric Gateway connection failed');
    }
    assert(fabricFailedHonest, 'Fabric transaction fails with clear gateway connection error instead of faking success');

    // 13. Final chain verification
    console.log('\n📍 13. Final hash-chain integrity verification');
    const finalService = getBlockchainService();
    const finalChain = await finalService.verifyChain();
    assert(finalChain.valid, `Hash chain is 100% intact with ${finalChain.totalBlocks} cryptographically verified blocks`);

    console.log('\n=============================================================');
    console.log(`🎉 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

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

run();
