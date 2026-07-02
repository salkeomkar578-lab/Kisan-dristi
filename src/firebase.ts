/**
 * firebase.ts — Kisan-Drishti Firebase Integration
 * Project: cow-project-316e7
 */

import { initializeApp, getApps } from 'firebase/app';
import { getAnalytics, logEvent, Analytics } from 'firebase/analytics';
import {
  getFirestore, Firestore,
  enableIndexedDbPersistence,
} from 'firebase/firestore';
import { getAuth, Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

// ─── Config ───────────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            'AIzaSyCZm2llSbLREjh0ne1tMQ_HlJ_szt4Lc-w',
  authDomain:        'cow-project-316e7.firebaseapp.com',
  projectId:         'cow-project-316e7',
  storageBucket:     'cow-project-316e7.firebasestorage.app',
  messagingSenderId: '5797140894',
  appId:             '1:5797140894:web:484f42a46d5e6cdeddde8f',
  measurementId:     'G-E17N7KG17K',
};

// ─── Initialize (idempotent) ──────────────────────────────────────────────────

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export let analytics: Analytics | null = null;
export let firestoreDb: Firestore | null = null;
export let auth: Auth | null = null;

export const GUEST_SESSION_KEY = 'kd-guest-mode';
export const DEMO_EMAIL_KEY = 'kd-demo-email';

export function isGuestSession(): boolean {
  return typeof window !== 'undefined' && sessionStorage.getItem(GUEST_SESSION_KEY) === '1';
}

function ensureAuth(): Auth {
  if (!auth) auth = getAuth(app);
  return auth;
}

export async function initFirebase(): Promise<void> {
  try {
    // Auth is always available even if analytics or persistence fail.
    ensureAuth();

    try {
      analytics = getAnalytics(app);
    } catch {
      analytics = null;
    }

    // Firestore with offline persistence
    if (!firestoreDb) {
      firestoreDb = getFirestore(app);
      try {
        await enableIndexedDbPersistence(firestoreDb);
      } catch {
        // Already enabled or multi-tab — fine to ignore
      }
    }

    console.log('[Firebase] Initialized ✓  project:', firebaseConfig.projectId);
  } catch (err) {
    console.warn('[Firebase] Init failed (offline mode will be used):', err);
  }
}

// ─── Auth Helpers ───────────────────────────────────────────────────────────

export async function signInEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(ensureAuth(), email, password);
}

export async function signUpEmailPassword(email: string, password: string) {
  return createUserWithEmailAndPassword(ensureAuth(), email, password);
}

export async function signInAsGuest() {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(GUEST_SESSION_KEY, '1');
  }
}

export function setDemoSession(email?: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(GUEST_SESSION_KEY, '1');
  if (email) {
    sessionStorage.setItem(DEMO_EMAIL_KEY, email);
  }
}

export async function signOutUser() {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    sessionStorage.removeItem(DEMO_EMAIL_KEY);
  }

  if (!auth?.currentUser) return;

  try {
    await signOut(ensureAuth());
  } catch {
    // If auth is not fully configured, still end the local session.
  }
}

export function onAuthChanged(cb: (user: import('firebase/auth').User | null) => void) {
  return onAuthStateChanged(ensureAuth(), cb);
}

export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(ensureAuth(), provider);
}

// ─── Analytics Helper ─────────────────────────────────────────────────────────

export function track(event: string, params?: Record<string, unknown>): void {
  if (!analytics) return;
  try {
    logEvent(analytics, event as string, params as Record<string, string>);
  } catch { /* analytics errors are non-fatal */ }
}
