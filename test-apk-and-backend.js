/**
 * CivicChain - APK & Backend Comprehensive Test Suite
 * Tests APK assets, Android configuration, Backend CORS, Health, and Full Auth Matrix.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_PORT = 5000;
const TEST_ACCOUNTS = [
  { role: 'Citizen', email: 'citizen@example.com', password: 'Citizen@123' },
  { role: 'Admin', email: 'admin@civicchain.gov', password: 'Admin@123' },
  { role: 'Authority', email: 'authority@civicchain.gov', password: 'Authority@123' },
  { role: 'Investigator', email: 'investigator@civicchain.gov', password: 'Investigator@123' },
  { role: 'Verifier', email: 'verifier@civicchain.gov', password: 'Verifier@123' }
];

console.log('====================================================');
console.log('🔍 CIVICCHAIN APK & BACKEND COMPREHENSIVE TEST SUITE');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.log(`  ❌ [FAIL] ${testName} ${details ? `(${details})` : ''}`);
  }
}

// 1. Check APK Artifact
console.log('📦 1. VERIFYING ANDROID APK ASSETS & CONFIGURATION');
const apkPath = path.join(__dirname, 'frontend/android/app/build/outputs/apk/debug/app-debug.apk');
assert(fs.existsSync(apkPath), 'APK exists at frontend/android/app/build/outputs/apk/debug/app-debug.apk');

if (fs.existsSync(apkPath)) {
  const stats = fs.statSync(apkPath);
  const mbSize = (stats.size / (1024 * 1024)).toFixed(2);
  assert(stats.size > 1000000, `APK file size valid (${mbSize} MB, ${stats.size} bytes)`);
}

// Check AndroidManifest.xml
const manifestPath = path.join(__dirname, 'frontend/android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert(manifest.includes('android.permission.INTERNET'), 'AndroidManifest has INTERNET permission');
  assert(manifest.includes('android:usesCleartextTraffic="true"'), 'AndroidManifest allows cleartext HTTP traffic (usesCleartextTraffic=true)');
}

// Check Capacitor Config
const capConfigPath = path.join(__dirname, 'frontend/capacitor.config.json');
if (fs.existsSync(capConfigPath)) {
  const capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));
  assert(capConfig.appId === 'org.civicchain.reporter', 'Capacitor appId matches: org.civicchain.reporter');
  assert(capConfig.server?.cleartext === true, 'Capacitor config allows cleartext traffic');
}

// Check Frontend Web Assets inside Android assets folder
const androidPublicAssets = path.join(__dirname, 'frontend/android/app/src/main/assets/public/index.html');
assert(fs.existsSync(androidPublicAssets), 'Frontend web bundle synced inside Android assets (assets/public/index.html)');

console.log('\n🌐 2. TESTING BACKEND CONNECTIVITY & CORS FOR MOBILE APK');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: json, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: body, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runBackendTests() {
  try {
    try {
      await import('./backend/src/server.js');
      await new Promise(r => setTimeout(r, 1000));
    } catch (_) {}
    // Health Check
    const healthRes = await makeRequest({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/api/health',
      method: 'GET'
    });
    assert(healthRes.status === 200 && healthRes.data.status === 'ok', 'Backend Health Endpoint (/api/health) returns 200 OK');

    // CORS Preflight simulation for Android APK (Origin: https://localhost)
    const apkCorsPreflight = await makeRequest({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/api/auth/login',
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    assert(
      apkCorsPreflight.headers['access-control-allow-origin'] === 'https://localhost' ||
      apkCorsPreflight.headers['access-control-allow-origin'] === '*',
      'Backend CORS permits Android APK WebView origin (https://localhost)'
    );

    // CORS Preflight simulation for Capacitor scheme (Origin: capacitor://localhost)
    const capCorsPreflight = await makeRequest({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/api/auth/login',
      method: 'OPTIONS',
      headers: {
        'Origin': 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    assert(
      capCorsPreflight.headers['access-control-allow-origin'] === 'capacitor://localhost' ||
      capCorsPreflight.headers['access-control-allow-origin'] === '*',
      'Backend CORS permits Capacitor custom origin (capacitor://localhost)'
    );

    console.log('\n🔐 3. TESTING APK AUTHENTICATION MATRIX');
    for (const acc of TEST_ACCOUNTS) {
      const loginRes = await makeRequest({
        hostname: '127.0.0.1',
        port: BACKEND_PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://localhost'
        }
      }, { email: acc.email, password: acc.password });

      const isSuccess = loginRes.status === 200 && loginRes.data.token && loginRes.data.user;
      assert(isSuccess, `Login successful for ${acc.role} (${acc.email})`);
      if (isSuccess) {
        // Test protected /auth/me call with token
        const meRes = await makeRequest({
          hostname: '127.0.0.1',
          port: BACKEND_PORT,
          path: '/api/auth/me',
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${loginRes.data.token}`,
            'Origin': 'https://localhost'
          }
        });
        assert(meRes.status === 200 && meRes.data.user?.email === acc.email, `Token verified for ${acc.role} via /api/auth/me`);
      }
    }

    // Test Invalid Login Rejection
    const invalidRes = await makeRequest({
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://localhost'
      }
    }, { email: 'wrong@example.com', password: 'BadPassword' });
    assert(invalidRes.status === 401 || invalidRes.status === 400, 'Invalid credentials properly rejected with 401/400');

    console.log('\n====================================================');
    console.log(`📊 TEST SUMMARY: ${passedTests} / ${totalTests} checks passed (${((passedTests/totalTests)*100).toFixed(0)}%)`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('Backend connection test error:', err.message);
    console.log('\n💡 Make sure the backend is running (`node src/server.js` or `npm run dev` in backend/).');
  }
}

runBackendTests();
