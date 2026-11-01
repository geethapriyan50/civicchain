import { v2 as cloudinary } from 'cloudinary';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

let _initialized = false;

export function initCloudinary() {
  if (_initialized) return isCloudinaryEnabled();

  if (process.env.CLOUDINARY_URL) {
    try {
      const parsed = new URL(process.env.CLOUDINARY_URL);
      cloudinary.config({
        cloud_name: parsed.hostname,
        api_key: parsed.username,
        api_secret: parsed.password,
        secure: true
      });
      _initialized = true;
      return true;
    } catch (_) {
      cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL, secure: true });
      _initialized = true;
      return true;
    }
  }

  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
    _initialized = true;
    return true;
  }

  return false;
}

export function isCloudinaryEnabled() {
  return Boolean(
    process.env.CLOUDINARY_URL ||
    (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
  );
}

/**
 * Uploads a file from local path to Cloudinary
 * @param {string} filePath Local path to the file
 * @param {string} publicId Unique ID for the asset
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
export async function uploadToCloudinary(filePath, publicId) {
  initCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        folder: 'civicchain/evidence',
        public_id: publicId,
        resource_type: 'auto'
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
}

/**
 * Fetches bytes from a remote Cloudinary URL into memory buffer
 * Used for cryptographic SHA-256 integrity verification
 * @param {string} url The secure Cloudinary URL
 * @returns {Promise<Buffer>}
 */
export async function fetchRemoteBytes(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      // Follow one redirect if needed
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchRemoteBytes(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch remote asset: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

