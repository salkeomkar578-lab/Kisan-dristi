import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  Cpu,
  Leaf,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { initFirebase, setDemoSession, signInAsGuest, signInEmailPassword, signInWithGooglePopup, signUpEmailPassword } from '../firebase';

function friendlyAuthMessage(err: unknown, fallbackMessage: string) {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
  if (code === 'auth/operation-not-allowed') {
    return 'This Firebase auth provider is disabled in the project. Use guest mode, or enable the provider in Firebase Console > Authentication.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorized for Firebase Auth. Add the current domain in Firebase Console > Authentication > Settings > Authorized domains.';
  }
  return (err as { message?: string } | null)?.message || fallbackMessage;
}

function shouldUseDemoFallback(err: unknown) {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
  return code === 'auth/operation-not-allowed' || code === 'auth/unauthorized-domain' || code === 'auth/internal-error';
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    initFirebase().catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInEmailPassword(email, password);
      navigate('/');
    } catch (err: any) {
      if (shouldUseDemoFallback(err)) {
        setDemoSession(email.trim().toLowerCase());
        navigate('/');
        return;
      }
      setError(friendlyAuthMessage(err, 'Sign in failed'));
    } finally {
      setLoading(false);
    }
  };

  const signup = async () => {
    setError(null);
    setLoading(true);
    try {
      await signUpEmailPassword(email, password);
      navigate('/');
    } catch (err: any) {
      if (shouldUseDemoFallback(err)) {
        setDemoSession(email.trim().toLowerCase());
        navigate('/');
        return;
      }
      setError(friendlyAuthMessage(err, 'Sign up failed'));
    } finally {
      setLoading(false);
    }
  };

  const googleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGooglePopup();
      navigate('/');
    } catch (err: any) {
      if (shouldUseDemoFallback(err)) {
        setDemoSession();
        navigate('/');
        return;
      }
      setError(friendlyAuthMessage(err, 'Google sign-in failed'));
    } finally {
      setLoading(false);
    }
  };

  const guestSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInAsGuest();
      navigate('/');
    } catch (err: any) {
      setDemoSession();
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh relative overflow-hidden text-slate-100 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.20),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.16),_transparent_28%),linear-gradient(160deg,_#07111f_0%,_#0a0f1e_48%,_#120d1d_100%)]">
      <div className="absolute inset-0 opacity-40 pointer-events-none" aria-hidden>
        <div className="absolute -left-28 top-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute right-0 top-12 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-dvh max-w-6xl items-center gap-8 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="space-y-6"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-emerald-200 backdrop-blur-xl">
            <Sparkles size={14} className="text-emerald-400" />
            Fresh interface for field testing and demo sessions
          </div>

          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-emerald-400/20 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.18)]">
              <Leaf size={36} className="text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-400">Kisan-Drishti</p>
              <h1 className="mt-2 text-4xl font-black leading-tight text-white sm:text-5xl">
                Livestock identity, rebuilt for fast testing.
              </h1>
            </div>
          </div>

          <p className="max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
            Use the full app, jump into guest mode, or sign in with a real account. The layout is now split into clear surfaces so controls do not collide on smaller screens.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, title: 'Secure entry', body: 'Email, Google, or guest test mode.' },
              { icon: Cpu, title: 'AI ready', body: 'Triple biometric workflow and offline-first sync.' },
              { icon: WifiOff, title: 'Cleaner layout', body: 'More space, fewer overlaps, and stronger hierarchy.' },
            ].map((item) => (
              <div key={item.title} className="rounded-3xl border border-white/8 bg-white/5 p-4 backdrop-blur-xl">
                <item.icon size={18} className="text-emerald-300" />
                <p className="mt-3 text-sm font-bold text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[28px] border border-white/8 bg-slate-950/40 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-orange-500/20">
                <BadgeCheck size={24} className="text-emerald-300" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Guest mode for testing</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Open a disposable anonymous session and preview the product without creating a permanent account.
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.1 }}
          className="rounded-[32px] border border-white/10 bg-slate-950/75 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-7"
        >
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Access portal</p>
              <h2 className="mt-2 text-2xl font-black text-white">Sign in</h2>
            </div>
            <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              Demo ready
            </div>
          </div>

          {error && <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">
              Email
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
                className="input-field mt-2"
                placeholder="you@example.com"
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-300">
              Password
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                type="password"
                className="input-field mt-2"
                placeholder="••••••••"
                required
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="submit"
                disabled={loading}
                className="btn-emerald flex items-center justify-center gap-2 !w-full"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Sign in
              </button>
              <button
                type="button"
                onClick={signup}
                disabled={loading}
                className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-bold text-sky-200 transition-colors hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Create account
              </button>
            </div>
          </form>

          <div className="mt-4 grid gap-3">
            <button
              type="button"
              onClick={googleSignIn}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UserRound size={16} />
              Continue with Google
            </button>

            <button
              type="button"
              onClick={guestSignIn}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Continue as guest
            </button>
          </div>

          <p className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-100">
            If Firebase Auth is not configured for the current domain or provider, use guest mode for testing. Real sign-in requires the Firebase project to allow this domain and enable the requested provider.
          </p>

          <p className="mt-4 text-center text-xs leading-5 text-slate-500">
            Guest mode creates a temporary anonymous session for testing. You can leave it later from inside the app.
          </p>
        </motion.section>
      </div>
    </div>
  );
}
