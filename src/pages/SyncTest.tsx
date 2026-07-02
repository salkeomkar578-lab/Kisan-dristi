import React from 'react';
import { initFirebase, firestoreDb } from '../firebase';
import { disableNetwork, enableNetwork, collection, getDocs } from 'firebase/firestore';
import { addCattle } from '../db';
import { forceFullSync, pushAllLocalToCloud } from '../firebaseSync';

export default function SyncTest() {
  const [logs, setLogs] = React.useState<string[]>([]);
  const log = (t: string) => setLogs(l => [new Date().toISOString() + ' - ' + t, ...l]);

  const runTest = async () => {
    try {
      log('Initializing Firebase');
      await initFirebase();
      if (!firestoreDb) { log('No firestoreDb available'); return; }

      log('Disabling network (simulate offline)');
      await disableNetwork(firestoreDb);

      log('Adding local cattle record (offline)');
      const c = await addCattle({
        tagNumber: `SYNC-T-${Date.now()}`,
        name: `SyncTest-${Date.now()}`,
        breed: 'TestBreed', age: 3, weight: 320, color: 'Test',
        farmerId: 'F-TST', farmerName: 'Test Farmer', farmerPhone: '0000000000',
        village: 'Local', district: 'Local', state: 'Local',
        muzzleEmbedding: Array(1024).fill(0), retinaEmbedding: Array(1024).fill(0), faceEmbedding: Array(1024).fill(0),
        biometricStatus: { muzzle: false, retina: false, face: false },
        registeredBy: 'SYNC-TEST', status: 'Offline'
      });
      log(`Local record created: ${c.id}`);

      log('Attempting to push local changes while offline (expected to fail or queue)');
      try { await pushAllLocalToCloud(); log('pushAllLocalToCloud returned (offline)'); } catch (e) { log('push failed as expected: ' + (e as Error).message); }

      log('Re-enabling network');
      await enableNetwork(firestoreDb);

      log('Forcing full sync');
      await forceFullSync();

      log('Verifying presence in Firestore');
      const snap = await getDocs(collection(firestoreDb, 'cattle'));
      const found = snap.docs.some(d => d.id === c.id || (d.data() as any).tagNumber === c.tagNumber);
      log(found ? 'Record present in Firestore — sync succeeded' : 'Record NOT found in Firestore — sync failed');
    } catch (err: any) {
      log('Error during test: ' + err.message);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">Sync Test</h2>
      <p className="mt-2 text-slate-400">Simulate offline → online sync in browser.</p>
      <div className="mt-4">
        <button onClick={runTest} className="px-4 py-2 bg-emerald-600 rounded text-white">Run offline→online sync test</button>
      </div>
      <div className="mt-4 max-h-72 overflow-auto font-mono text-xs bg-slate-900/40 p-3 rounded">
        {logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
