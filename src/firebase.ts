import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServiceAccount() {
  // 1. Direct JSON from environment variable (ideal for Render / Railway / Cloud deployment)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      const jsonString = raw.startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf-8');
      return JSON.parse(jsonString);
    } catch (e) {
      console.error('Error parsing FIREBASE_SERVICE_ACCOUNT environment variable:', e);
    }
  }

  // 2. Custom path from environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const customPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (fs.existsSync(customPath)) {
      return require(customPath);
    }
  }

  // 3. Fallback: Search project root for local firebase-adminsdk json file
  const rootDir = path.join(__dirname, '..');
  try {
    const rootFiles = fs.readdirSync(rootDir);
    const matchedFile = rootFiles.find(
      (file) => file.includes('firebase-adminsdk') && file.endsWith('.json')
    );
    if (matchedFile) {
      return require(path.join(rootDir, matchedFile));
    }
  } catch (err) {
    console.warn('Could not scan project directory for local credentials:', err);
  }

  // 4. Standard local filename fallback
  const fallbackPath = path.join(rootDir, 'firebase-service-account.json');
  if (fs.existsSync(fallbackPath)) {
    return require(fallbackPath);
  }

  throw new Error(
    'Firebase service account credentials not found!\n' +
    'Please set FIREBASE_SERVICE_ACCOUNT in your environment or place your service account JSON file in the project root.'
  );
}

const serviceAccount = getServiceAccount();

const app = initializeApp({
  credential: cert(serviceAccount)
});

export const db = getFirestore(app);
export const messaging = getMessaging(app);
