import React from 'react';
import { Navigate } from 'react-router-dom';
import { isGuestSession, onAuthChanged } from '../firebase';

export default function ProtectedRoute({ children }: { children: React.ReactElement }) {
  if (isGuestSession()) return children;

  const [authed, setAuthed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    // subscribe
    let unsub: (() => void) | null = null;
    try {
      unsub = onAuthChanged((u) => setAuthed(!!u));
    } catch {
      // if auth not ready, treat as not authed
      setAuthed(false);
    }
    return () => { if (unsub) unsub(); };
  }, []);

  if (authed === null) return <div />; // loading
  if (!authed) return <Navigate to="/login" replace />;
  return children;
}
