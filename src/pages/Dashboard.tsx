import React from 'react';
import { signOutUser } from '../firebase';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [loading, setLoading] = React.useState(false);
  const logout = async () => { setLoading(true); await signOutUser(); setLoading(false); };
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2">Welcome — you are signed in.</p>
      <div className="mt-4 flex gap-2">
        <Link to="/cattle" className="px-3 py-2 bg-emerald-600 rounded text-white">Cattle</Link>
        <Link to="/scan" className="px-3 py-2 bg-sky-600 rounded text-white">Scan</Link>
        <Link to="/debug/sync-test" className="px-3 py-2 bg-indigo-600 rounded text-white">Sync Test</Link>
        <button onClick={logout} className="px-3 py-2 bg-red-600 rounded text-white" disabled={loading}>{loading? 'Signing out...': 'Sign out'}</button>
      </div>
    </div>
  );
}
