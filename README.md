# 📡 Spoof Tracker

An on-demand, battery-efficient GPS telemetry and device tracking system powered by **Node.js, Express, Firebase Firestore & Cloud Messaging (FCM), React Native (Expo)**, and an interactive **Leaflet/Satellite Command Center**.

---

## 🏗️ System Architecture

```
[ Android Client App (Expo) ]
            │
            ▼ (Silent Push Wakeup via FCM)
[ Node.js / Express Backend ] ◄────► [ Firebase Firestore DB ]
            │
            ▼
[ Web Command Center (Admin Dashboard) ]
```

1. **Battery-Efficient On-Demand Pings:** The Android app stays completely dormant without draining battery. When requested from the admin dashboard, a high-priority FCM data message wakes the device up.
2. **Comprehensive Telemetry:** Gathers GPS coordinates (lat/lng), accuracy in meters, altitude, speed (km/h), compass heading, reverse-geocoded human street address, battery level/charging status, and hardware specs (brand, model, RAM, OS version).
3. **Multi-Layer Tactical Dashboard:** Leaflet dashboard with CARTO, Esri Satellite Imagery, OpenStreetMap, one-click Google Maps deep-links, zoom controls, and live 5-second polling.

---

## 📁 Repository Structure

```
├── client-app/                  # React Native (Expo) Android mobile app
│   ├── App.js                   # Main application code & telemetry collector
│   ├── app.json                 # Expo config & Android permissions
│   ├── eas.json                 # EAS build configuration for APK
│   └── google-services.json     # Firebase Android client configuration
├── public/                      # Web Admin Dashboard
│   ├── admin.html               # Real-time interactive command center map
│   └── index.html               # Web push client (optional)
├── src/                         # Backend Server (TypeScript)
│   ├── index.ts                 # Express entry point
│   ├── firebase.ts              # Firebase Admin SDK initialization
│   └── routes/
│       ├── deviceRoutes.ts      # Device registration & location telemetry APIs
│       └── adminRoutes.ts       # Device list & remote ping trigger APIs
├── .env.example                 # Example environment configuration
├── .gitignore                   # Git exclusion rules (safeguards secrets)
├── package.json                 # Root dependencies and scripts
└── tsconfig.json                # TypeScript compiler configuration
```

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js (v18+)
- Firebase Project with Firestore and Cloud Messaging enabled.

### 2. Configure Firebase Credentials
1. Download your **Service Account JSON key** from [Firebase Console](https://console.firebase.google.com/) > *Project Settings* > *Service Accounts*.
2. Save it in the project root as `firebase-service-account.json` (it is automatically gitignored).
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

### 3. Install & Start Backend
```bash
npm install
npm run dev
```
The server will start on `http://localhost:3000`. Access the Command Center at:
👉 **`http://localhost:3000/admin.html`**

---

## ☁️ Deploy to Cloud (Permanent 24/7 URL)

To avoid temporary tunnels (like localtunnel/serveo) and give your APK a permanent backend URL:

### Deploy to [Render.com](https://render.com) (Free):
1. Push this repository to your GitHub account.
2. Go to **Render Dashboard** > **New** > **Web Service**.
3. Connect your GitHub repository.
4. Set the following build and start commands:
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
5. In **Environment Variables**, add:
   * `FIREBASE_SERVICE_ACCOUNT`: Paste the entire raw JSON text of your Firebase Service Account file.
6. Click **Deploy**. Render will generate a permanent URL (e.g. `https://your-tracker.onrender.com`).

---

## 📱 Building the Android APK

1. In `client-app/App.js`, set your permanent backend URL:
   ```javascript
   const DEFAULT_SERVER_URL = 'https://your-tracker.onrender.com';
   ```
2. Build the APK using EAS:
   ```bash
   cd client-app
   npx eas-cli build -p android --profile preview
   ```
3. Download the generated `.apk` file and install it on any Android device.
4. Open the app and tap **Enable Tracking**. The device is now active and ready to report telemetry on demand!

---

## 🔒 Security Note
Private keys and `.env` files are excluded via `.gitignore`. Never commit `*-firebase-adminsdk-*.json` or `.env` files to public version control.
