/**
 * firebaseSync.ts — Bidirectional sync between IndexedDB ↔ Firestore
 * Strategy: IndexedDB = offline-first truth, Firestore = cloud backup + cross-device
 */

import {
  collection, doc, setDoc, getDocs, onSnapshot,
  serverTimestamp, query, orderBy, Timestamp,
  DocumentData, Unsubscribe,
} from 'firebase/firestore';
import { firestoreDb, track } from './firebase';
import {
  getAllCattle, getLedgerEntries, getDB,
  Cattle, LedgerEntry,
} from './db';

// ─── Collection refs ──────────────────────────────────────────────────────────

const CATTLE_COL  = 'cattle';
const LEDGER_COL  = 'ledger';

// ─── Type helpers ─────────────────────────────────────────────────────────────

/** Strip functions/undefined from an object so Firestore can serialize it */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * Push a single cattle record to Firestore.
 * Embeddings are stored as-is (1024-float arrays).
 */
export async function pushCattleToCloud(cattle: Cattle): Promise<void> {
  if (!firestoreDb) return;
  try {
    const payload = { ...clean(cattle as unknown as Record<string, unknown>), lastModified: cattle.lastModified || Date.now(), syncedAt: serverTimestamp() };
    await setDoc(
      doc(firestoreDb, CATTLE_COL, cattle.id),
      payload,
      { merge: true }
    );
    track('cattle_synced_to_cloud', { cattleId: cattle.id });
  } catch (err) {
    console.warn('[Sync] pushCattleToCloud failed:', err);
  }
}

/**
 * Push a ledger entry to Firestore.
 */
export async function pushLedgerToCloud(entry: LedgerEntry): Promise<void> {
  if (!firestoreDb) return;
  try {
    const payload = { ...clean(entry as unknown as Record<string, unknown>), lastModified: entry.lastModified || entry.timestamp, syncedAt: serverTimestamp() };
    await setDoc(
      doc(firestoreDb, LEDGER_COL, entry.id),
      payload,
      { merge: true }
    );
  } catch (err) {
    console.warn('[Sync] pushLedgerToCloud failed:', err);
  }
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/**
 * Pull all cattle from Firestore and merge into local IndexedDB.
 * Local records win on conflict (offline-first).
 */
export async function pullAllFromCloud(): Promise<{ added: number; skipped: number }> {
  if (!firestoreDb) return { added: 0, skipped: 0 };
  let added = 0; let skipped = 0;

  try {
    const db = await getDB();
    const snap = await getDocs(collection(firestoreDb, CATTLE_COL));

    for (const d of snap.docs) {
      const remote = d.data() as Cattle & { syncedAt?: unknown };
      const local = await db.get('cattle', remote.id);

      // Determine remote last-modified time (from syncedAt) and local last-modified heuristic
      const remoteMs = remote.syncedAt && (remote.syncedAt as any) instanceof Timestamp
        ? (remote.syncedAt as Timestamp).toMillis()
        : typeof remote.syncedAt === 'number' ? (remote.syncedAt as number) : 0;

      const localLast = (() => {
        if (!local) return 0;
        let m = local.registeredAt || 0;
        if (Array.isArray(local.healthMetrics) && local.healthMetrics.length) {
          const lastHealth = Math.max(...local.healthMetrics.map(h => new Date(h.date).getTime()));
          m = Math.max(m, lastHealth);
        }
        return m;
      })();

      if (!local) {
        const { syncedAt: _s, ...cattleData } = remote as Cattle & { syncedAt?: unknown };
        await db.put('cattle', cattleData as Cattle);
        added++;
      } else if (remoteMs && remoteMs > localLast) {
        // Remote is newer — overwrite local
        const { syncedAt: _s, ...cattleData } = remote as Cattle & { syncedAt?: unknown };
        await db.put('cattle', cattleData as Cattle);
        added++;
      } else {
        skipped++;
      }
    }

    // Pull ledger entries too
    const lSnap = await getDocs(collection(firestoreDb, LEDGER_COL));
    for (const d of lSnap.docs) {
      const remote = d.data() as LedgerEntry;
      const local = await db.get('ledger', remote.id);
      if (!local) {
        const { syncedAt: _s, ...entryData } = remote as LedgerEntry & { syncedAt?: unknown };
        await db.put('ledger', entryData as LedgerEntry);
        added++;
      }
    }
  } catch (err) {
    console.warn('[Sync] pullAllFromCloud failed:', err);
  }

  return { added, skipped };
}

// ─── Upload all local ─────────────────────────────────────────────────────────

/**
 * Push all local IndexedDB records that may not be in Firestore yet.
 */
export async function pushAllLocalToCloud(): Promise<void> {
  if (!firestoreDb) return;
  try {
    const cattle = await getAllCattle();
    const ledger = await getLedgerEntries();
    await Promise.all([
      ...cattle.map(c => pushCattleToCloud(c)),
      ...ledger.map(e => pushLedgerToCloud(e)),
    ]);
    console.log(`[Sync] Pushed ${cattle.length} cattle + ${ledger.length} ledger entries to cloud`);
  } catch (err) {
    console.warn('[Sync] pushAllLocalToCloud failed:', err);
  }
}

/**
 * Force a full bidirectional sync: pull cloud -> local, then push local -> cloud.
 */
export async function forceFullSync(): Promise<void> {
  try {
    console.log('[Sync] Starting full sync');
    await pullAllFromCloud();
    await pushAllLocalToCloud();
    console.log('[Sync] Full sync complete');
  } catch (err) {
    console.warn('[Sync] forceFullSync failed:', err);
  }
}

// ─── Real-time listener ───────────────────────────────────────────────────────

/**
 * Subscribe to Firestore cattle collection.
 * Calls `onNewCattle` whenever a cattle is added/modified in the cloud.
 */
export function subscribeToCattleChanges(
  onNewCattle: (cattle: Cattle) => void
): Unsubscribe {
  if (!firestoreDb) return () => {};
  return onSnapshot(
    collection(firestoreDb, CATTLE_COL),
    async (snap) => {
      const db = await getDB();
      for (const change of snap.docChanges()) {
        if (change.type === 'added' || change.type === 'modified') {
          const remote = change.doc.data() as Cattle & { syncedAt?: unknown };
          const local = await db.get('cattle', remote.id);

          const remoteMs = remote.syncedAt && (remote.syncedAt as any) instanceof Timestamp
            ? (remote.syncedAt as Timestamp).toMillis()
            : typeof remote.syncedAt === 'number' ? (remote.syncedAt as number) : 0;

          const localLast = (() => {
            if (!local) return 0;
            let m = local.registeredAt || 0;
            if (Array.isArray(local.healthMetrics) && local.healthMetrics.length) {
              const lastHealth = Math.max(...local.healthMetrics.map(h => new Date(h.date).getTime()));
              m = Math.max(m, lastHealth);
            }
            return m;
          })();

          if (!local) {
            const { syncedAt: _s, ...cattleData } = remote as Cattle & { syncedAt?: unknown };
            await db.put('cattle', cattleData as Cattle);
            onNewCattle(cattleData as Cattle);
          } else if (remoteMs && remoteMs > localLast) {
            const { syncedAt: _s, ...cattleData } = remote as Cattle & { syncedAt?: unknown };
            await db.put('cattle', cattleData as Cattle);
            onNewCattle(cattleData as Cattle);
          }
          // else: local is newer — ignore remote change
        }
      }
    },
    (err) => console.warn('[Sync] onSnapshot error:', err)
  );
}

// ─── Connectivity check ───────────────────────────────────────────────────────

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
