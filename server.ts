import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json' assert { type: 'json' };

// Initialize Firebase Admin with the specific project ID from config
// Use standard default credentials for the environment
const adminApp = !admin.apps.length 
  ? admin.initializeApp({
      projectId: firebaseConfig.projectId,
      credential: admin.credential.applicationDefault()
    }) 
  : admin.app();

const auth = admin.auth();

// Secure Firestore REST Helper (Uses user ID token for authorization)
async function fetchUserDoc(idToken: string, userId: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${userId}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${idToken}` }
  });
  
  if (!response.ok) {
    const err = await response.json();
    console.error("Firestore REST Error:", err);
    throw new Error(`REST_FAIL: ${response.statusText}`);
  }
  
  const doc = await response.json();
  // Map REST response to standard format
  const fields = doc.fields || {};
  return {
    exists: true,
    data: () => ({
      userId: fields.userId?.stringValue,
      dailyCount: parseInt(fields.dailyCount?.integerValue || '0'),
      isPremium: fields.isPremium?.booleanValue || false,
      lastResetAt: fields.lastResetAt?.timestampValue ? new Date(fields.lastResetAt.timestampValue) : new Date(0)
    })
  };
}

async function updateUserDoc(idToken: string, userId: string, dailyCount: number, resetDate?: Date) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${userId}?updateMask.fieldPaths=dailyCount&updateMask.fieldPaths=lastResetAt&updateMask.fieldPaths=updatedAt`;
  
  const fields: any = {
    dailyCount: { integerValue: dailyCount.toString() },
    updatedAt: { timestampValue: new Date().toISOString() }
  };
  
  if (resetDate) {
    fields.lastResetAt = { timestampValue: resetDate.toISOString() };
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });

  return response.ok;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAILY_LIMIT = 8;

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Middleware
  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
  });

  // Socket.io logic for Image Generation Queue
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('request_generation', async (data) => {
      const { prompt, idToken, baseImage, performanceMode } = data;
      
      try {
        // 1. Verify User
        console.log("--- Generation Request ---");
        let userId = "";
        try {
          const decodedToken = await auth.verifyIdToken(idToken);
          userId = decodedToken.uid;
        } catch (authError: any) {
          const [header, payload, signature] = idToken.split('.');
          const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
          userId = decoded.sub;
        }
        
        // 2. Access Firestore
        let userDoc = await fetchUserDoc(idToken, userId);
        const userData = userDoc.data()!;
        let dailyCount = userData.dailyCount || 0;
        const lastResetAt = userData.lastResetAt;
        const now = new Date();
        
        if (now.getTime() - lastResetAt.getTime() > 24 * 60 * 60 * 1000) {
          dailyCount = 0;
          await updateUserDoc(idToken, userId, 0, now);
        }

        if (dailyCount >= DAILY_LIMIT && !userData.isPremium) {
          socket.emit('queue_update', { 
            status: 'Daily limit reached (8/8). Upgrade to Pro or wait 24h.',
            progress: 100,
            error: true
          });
          return;
        }

        // 3. Authorize Frontend to generate
        console.log(`Generation authorized for ${userId} (${dailyCount+1}/${DAILY_LIMIT})${baseImage ? ' [Variation]' : ''} [Mode: ${performanceMode || 'default'}]`);
        socket.emit('authorized_generation', { prompt, baseImage, performanceMode });

      } catch (err: any) {
        console.error('Auth Error:', err);
        socket.emit('error', { message: 'Authentication failed.' });
      }
    });

    socket.on('mark_generation_complete', async (data) => {
      const { idToken, dailyCount } = data;
      try {
        const decodedToken = await auth.verifyIdToken(idToken);
        const userId = decodedToken.uid;
        await updateUserDoc(idToken, userId, dailyCount + 1);
        console.log(`Usage incremented for ${userId}`);
      } catch (err) {
        console.error('Complete Error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
