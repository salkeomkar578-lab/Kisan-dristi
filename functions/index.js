const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize admin SDK — in Cloud Functions this uses the default service account.
try {
  admin.initializeApp();
} catch (e) {
  // already initialized in emulators/local runs
}

const db = admin.firestore();

// Example: onCattleCreated — server-side processing for new cattle records.
// This function can be extended to run verification, publish events, or update denormalized data.
exports.onCattleCreated = functions.firestore
  .document('cattle/{cattleId}')
  .onCreate(async (snap, context) => {
    const cattle = snap.data();
    const id = context.params.cattleId;
    try {
      // Set a server-side processed timestamp and a simple integrity flag
      await db.doc(`cattle/${id}`).set({ serverProcessedAt: admin.firestore.FieldValue.serverTimestamp(), serverVerified: true }, { merge: true });
      console.log('Processed cattle:', id);
    } catch (err) {
      console.error('Error processing cattle:', id, err);
    }
  });

// Example HTTP endpoint: verify ID token and return custom claims
exports.verifyToken = functions.https.onRequest(async (req, res) => {
  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer (.*)/);
  if (!match) return res.status(401).send('Missing Bearer token');
  const idToken = match[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return res.json({ uid: decoded.uid, claims: decoded });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Verify biometric: accept POST with { cattleId, channel, vector }
exports.verifyBiometric = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const body = req.body || {};
  // TODO: integrate ML model or call external verification service
  // For now, return a mock positive result with confidence 0.85
  const result = { matched: true, confidence: 0.85, cattleId: body.cattleId || null };
  // Optionally write verification results to a `verifications` collection
  try {
    await db.collection('verifications').add({ ...result, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    console.warn('Failed to write verification record', e);
  }
  return res.json(result);
});

// Notify sync: simple endpoint to write a notification document which clients can listen to
exports.notifySync = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const body = req.body || {};
  try {
    await db.collection('syncNotifications').add({ payload: body, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ ok: true });
  } catch (err) {
    console.error('notifySync error', err);
    return res.status(500).json({ ok: false });
  }
});
