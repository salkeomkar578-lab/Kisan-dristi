import React, {
  useState, useEffect, useRef, useCallback, createContext, useContext,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Camera, ShieldCheck, BookOpen, Settings, CheckCircle2, XCircle,
  AlertTriangle, Download, Eye, Scan, Users, TrendingUp, ChevronRight,
  Loader2, RefreshCw, Cpu, Database, Wifi, WifiOff, Plus, X, Search,
  ArrowLeft, Info, Droplets, Thermometer, Zap, Heart, Building2,
  PhoneCall, MapPin, Star, FileText, Shield, Banknote, Stethoscope,
  BadgeCheck, Activity, Clock, BarChart3, UserCircle, Globe, Leaf,
  ChevronDown, Bell, Cloud, CloudOff, CloudCog, AlertCircle, CheckCheck,
} from 'lucide-react';
import { initFirebase, isGuestSession, signOutUser, track } from './firebase';
import {
  pushCattleToCloud, pushLedgerToCloud, pullAllFromCloud,
  pushAllLocalToCloud, subscribeToCattleChanges,
  isOnline, SyncStatus,
} from './firebaseSync';
import {
  getAllCattle, getCattleByFarmer, addCattle, updateCattleHealth,
  getLedgerEntries, seedDemoData, addVerificationLedger,
  Cattle, LedgerEntry, DairyHealthRecord, HealthStatus, BiometricChannel,
  InsuranceRecord, LoanRecord,
} from './db';
import {
  loadModel, isModelLoaded, extractVector, extractMultiFrameEmbedding,
  cosineSimilarity, checkLiveness, getFrameQuality, findBestMatch,
} from './ai';
import jsPDF from 'jspdf';

// ─── Settings Context ─────────────────────────────────────────────────────────

interface AppSettings {
  muzzleThreshold: number;
  retinaThreshold: number;
  faceThreshold: number;
  livenessEnabled: boolean;
  agentId: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  muzzleThreshold: 0.72,
  retinaThreshold: 0.70,
  faceThreshold:   0.68,
  livenessEnabled: true,
  agentId: 'AGENT-001',
};

const SettingsContext = createContext<{
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
}>({ settings: DEFAULT_SETTINGS, update: () => {} });
const useSettings = () => useContext(SettingsContext);

// ─── App Types ────────────────────────────────────────────────────────────────

type AppRole    = 'farmer' | 'agent' | null;
type AgentView  = 'dashboard' | 'register' | 'verify' | 'records' | 'ledger' | 'config';
type FarmerView = 'dashboard' | 'cattle' | 'detail' | 'services' | 'insurance' | 'loan' | 'vet' | 'schemes' | 'profile';

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmt = (ts: number) => new Date(ts).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});
const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

function healthClass(s: HealthStatus) {
  if (s === 'Excellent')       return 'health-excellent';
  if (s === 'Good')            return 'health-good';
  if (s === 'Needs Attention') return 'health-attention';
  return 'health-critical';
}
function statusClass(s: string) {
  if (s === 'Synced')   return 'status-synced';
  if (s === 'Verified') return 'status-verified';
  if (s === 'Offline')  return 'status-offline';
  return 'status-pending';
}

// ─── Toast System ─────────────────────────────────────────────────────────────

interface ToastMsg { id: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }

function Toast({ toasts, remove }: { toasts: ToastMsg[]; remove: (id: string) => void }) {
  return (
    <div className="fixed top-4 left-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id}
            initial={{ opacity: 0, y: -24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92, y: -8 }}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl shadow-2xl border ${
              t.type === 'success' ? 'bg-emerald-950/95 border-emerald-500/30 text-emerald-200' :
              t.type === 'error'   ? 'bg-red-950/95 border-red-500/30 text-red-200' :
              t.type === 'warning' ? 'bg-amber-950/95 border-amber-500/30 text-amber-200' :
              'bg-slate-900/95 border-slate-500/30 text-slate-200'
            }`}
            style={{ backdropFilter: 'blur(20px)' }}
          >
            <div className="flex-shrink-0 mt-0.5">
              {t.type === 'success' ? <CheckCircle2 size={16} className="text-emerald-400" /> :
               t.type === 'error'   ? <XCircle      size={16} className="text-red-400" /> :
               t.type === 'warning' ? <AlertTriangle size={16} className="text-amber-400" /> :
               <Info size={16} className="text-slate-400" />}
            </div>
            <p className="text-sm font-medium flex-1 leading-relaxed">{t.message}</p>
            <button onClick={() => remove(t.id)} className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const add = useCallback((message: string, type: ToastMsg['type'] = 'info') => {
    const id = Date.now().toString();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);
  const remove = useCallback((id: string) => setToasts(p => p.filter(t => t.id !== id)), []);
  return { toasts, add, remove };
}

// ─── Error Modal ──────────────────────────────────────────────────────────────

function ErrorModal({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}>
      <motion.div className="modal-panel" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={22} className="text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-black text-white text-lg">{title}</h3>
            <p className="text-sm text-slate-400 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <button onClick={onClose} className="btn-base btn-ghost mt-5">Understood</button>
      </motion.div>
    </motion.div>
  );
}

// ─── Cloud Sync Badge ─────────────────────────────────────────────────────────

function SyncBadge({ status }: { status: SyncStatus }) {
  const cfg = {
    idle:    { icon: Cloud,    label: 'Cloud',   cls: 'text-slate-500 border-slate-700' },
    syncing: { icon: CloudCog, label: 'Syncing', cls: 'text-amber-400 border-amber-500/40 animate-pulse' },
    synced:  { icon: Cloud,    label: 'Synced',  cls: 'text-emerald-400 border-emerald-500/40' },
    offline: { icon: CloudOff, label: 'Offline', cls: 'text-slate-500 border-slate-700' },
    error:   { icon: CloudOff, label: 'Err',     cls: 'text-red-400 border-red-500/40' },
  } as const;
  const { icon: Icon, label, cls } = cfg[status];
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cls}`}>
      <Icon size={11} />{label}
    </div>
  );
}

// ─── 3D Cow Logo ──────────────────────────────────────────────────────────────

function CowLogo3D({ size = 80, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Rotating scan rings */}
      {animated && (
        <>
          <svg className="absolute inset-0 scan-ring-rotate" width={size} height={size} viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="56" stroke="url(#ring1)" strokeWidth="2"
              strokeDasharray="14 7" strokeLinecap="round" fill="none" />
            <defs>
              <linearGradient id="ring1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop stopColor="#10B981" offset="0%" />
                <stop stopColor="#7C3AED" offset="50%" />
                <stop stopColor="#F97316" offset="100%" />
              </linearGradient>
            </defs>
          </svg>
          <svg className="absolute inset-0 scan-ring-pulse" width={size} height={size} viewBox="0 0 120 120"
            style={{ animationDelay: '1s' }}>
            <circle cx="60" cy="60" r="48" stroke="#10B981" strokeWidth="1"
              strokeDasharray="4 8" fill="none" opacity="0.4" />
          </svg>
        </>
      )}
      {/* Cow face SVG */}
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"
        className="relative z-10">
        {/* Glow */}
        <ellipse cx="60" cy="65" rx="30" ry="26" fill="rgba(16,185,129,0.08)" />
        {/* Head */}
        <ellipse cx="60" cy="65" rx="30" ry="26" fill="url(#cowHead)" />
        {/* Ears */}
        <ellipse cx="30" cy="50" rx="10" ry="13" fill="url(#cowEar)" transform="rotate(-15 30 50)" />
        <ellipse cx="90" cy="50" rx="10" ry="13" fill="url(#cowEar)" transform="rotate(15 90 50)" />
        <ellipse cx="30" cy="50" rx="6" ry="8" fill="#F9A8D4" transform="rotate(-15 30 50)" />
        <ellipse cx="90" cy="50" rx="6" ry="8" fill="#F9A8D4" transform="rotate(15 90 50)" />
        {/* Horns */}
        <path d="M38 42 Q28 24 22 18" stroke="#D97706" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M82 42 Q92 24 98 18" stroke="#D97706" strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* Eyes — with scan rings */}
        <circle cx="46" cy="60" r="9" fill="#1E293B" />
        <circle cx="74" cy="60" r="9" fill="#1E293B" />
        <circle cx="46" cy="60" r="6" fill="url(#eyeGrad)" />
        <circle cx="74" cy="60" r="6" fill="url(#eyeGrad)" />
        <circle cx="48" cy="58" r="2.5" fill="white" opacity="0.85" />
        <circle cx="76" cy="58" r="2.5" fill="white" opacity="0.85" />
        {/* Eye scan rings */}
        <circle cx="74" cy="60" r="11" stroke="#34D399" strokeWidth="1.5" strokeDasharray="3 3" fill="none" opacity="0.7" />
        <circle cx="46" cy="60" r="11" stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="3 3" fill="none" opacity="0.5" />
        {/* Muzzle */}
        <ellipse cx="60" cy="80" rx="18" ry="12" fill="#F3D5B5" />
        <circle cx="54" cy="80" r="4.5" fill="#C8A882" />
        <circle cx="66" cy="80" r="4.5" fill="#C8A882" />
        {/* Muzzle scan dots */}
        <circle cx="54" cy="80" r="2" fill="#10B981" opacity="0.9" />
        <circle cx="66" cy="80" r="2" fill="#10B981" opacity="0.9" />
        {/* Ear tag */}
        <rect x="84" y="44" width="12" height="8" rx="2" fill="#F97316" opacity="0.9" />
        <text x="86" y="51" fontSize="5" fill="white" fontWeight="bold">ID</text>
        <defs>
          <linearGradient id="cowHead" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#9B6B3A" /><stop offset="1" stopColor="#6B3F15" />
          </linearGradient>
          <linearGradient id="cowEar" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#9B6B3A" /><stop offset="1" stopColor="#7A4F22" />
          </linearGradient>
          <radialGradient id="eyeGrad" cx="50%" cy="50%" r="50%">
            <stop stopColor="#7C3AED" /><stop offset="1" stopColor="#4C1D95" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

// ─── Floating Orbs Background ─────────────────────────────────────────────────

function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="orb1 absolute -top-32 -left-32 w-96 h-96 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.18) 0%, transparent 70%)' }} />
      <div className="orb2 absolute -top-16 -right-24 w-80 h-80 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.14) 0%, transparent 70%)' }} />
      <div className="orb3 absolute bottom-0 left-1/3 w-72 h-72 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)' }} />
    </div>
  );
}

// ─── Biometric Scanner Component ──────────────────────────────────────────────

const CHANNEL_META = {
  muzzle: {
    label: 'Muzzle Scan',
    hint: 'Position the nose/muzzle close to camera. The unique ridge pattern is the fingerprint.',
    icon: Scan,
    color: 'text-emerald-400',
    gradient: 'from-emerald-700 to-teal-600',
    overlay: '🐽',
    ring: '#10B981',
  },
  retina: {
    label: 'Retina Scan',
    hint: 'Hold camera level with the animal\'s eye. Keep steady for 2 seconds.',
    icon: Eye,
    color: 'text-violet-400',
    gradient: 'from-violet-700 to-purple-600',
    overlay: '👁',
    ring: '#7C3AED',
  },
  face: {
    label: 'Face ID',
    hint: 'Hold camera 1–2 feet from face. Capture full facial geometry.',
    icon: UserCircle,
    color: 'text-orange-400',
    gradient: 'from-orange-700 to-amber-600',
    overlay: '🐄',
    ring: '#F97316',
  },
} as const;

type ScanStage = 'starting' | 'positioning' | 'liveness' | 'extracting' | 'done' | 'error';

interface ScannerProps {
  channel: BiometricChannel;
  multiFrame?: boolean;
  onComplete: (vec: number[], ch: BiometricChannel) => void;
  onError: (msg: string) => void;
}

function Scanner({ channel, multiFrame = false, onComplete, onError }: ScannerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const imageRef   = useRef<HTMLImageElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [stage, setStage]     = useState<ScanStage>('starting');
  const [quality, setQuality] = useState(0);
  const [hist, setHist]       = useState<number[]>(Array(24).fill(0));
  const [errMsg, setErrMsg]   = useState('');
  const [photoMode, setPhotoMode] = useState(false);
  const [photoSrc, setPhotoSrc]   = useState<string | null>(null);
  const [progress, setProgress]   = useState(0);

  const meta = CHANNEL_META[channel];

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const frameReady = () => photoMode ? imageRef.current : videoRef.current;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (photoMode) { setStage('positioning'); return; }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API unavailable. Try a modern browser or use photo upload below.');
        }
        if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
          throw new Error('Camera requires HTTPS. Open the app on https:// or use localhost.');
        }

        const attempts: MediaStreamConstraints[] = [
          { video: { width: 640, height: 480, facingMode: { ideal: 'environment' } } },
          { video: { facingMode: { ideal: 'user' } } },
          { video: true },
        ];

        let stream: MediaStream | null = null;
        for (const c of attempts) {
          try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
          catch { /* try next */ }
        }
        if (!stream) throw new Error('Unable to access camera. Check browser permissions.');

        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          await videoRef.current.play().catch(() => {});
        }
        setStage('positioning');
        intervalRef.current = setInterval(async () => {
          if (videoRef.current && alive) {
            const q = await getFrameQuality(videoRef.current);
            setQuality(q);
            setHist(p => [...p.slice(1), q]);
          }
        }, 150);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Camera denied.';
        if (alive) { setErrMsg(msg); setStage('error'); onError(msg); }
      }
    })();
    return () => { alive = false; stopCamera(); };
  }, [onError, photoMode, stopCamera]);

  const capture = async () => {
    const frame = frameReady();
    if (!frame || stage !== 'positioning') return;
    if (photoMode && imageRef.current && !imageRef.current.complete) {
      onError('Please wait for the photo to finish loading.'); return;
    }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    try {
      setStage('liveness');
      setProgress(20);
      const live = await checkLiveness(frame as HTMLVideoElement | HTMLImageElement | HTMLCanvasElement);
      if (!live) {
        setStage('positioning');
        onError('Liveness check failed — please move slightly or ensure you\'re not using a photo.');
        return;
      }

      setStage('extracting');
      setProgress(50);

      let vec: number[];
      if (multiFrame && !photoMode && frame instanceof HTMLVideoElement) {
        // 3-frame average for more stable registration
        vec = await extractMultiFrameEmbedding(frame as HTMLVideoElement, 3, 300);
      } else {
        vec = await extractVector(frame as HTMLVideoElement | HTMLImageElement | HTMLCanvasElement);
      }

      setProgress(100);
      stopCamera();
      if (photoSrc) URL.revokeObjectURL(photoSrc);
      setStage('done');
      onComplete(vec, channel);
    } catch (e) {
      const msg = (e as Error).message;
      setErrMsg(msg);
      setStage('error');
      onError(msg);
    }
  };

  const stageLabel: Record<ScanStage, string> = {
    starting:   'Starting camera…',
    positioning: multiFrame ? 'Ready · Tap for 3-Frame Capture' : 'Ready · Tap to Capture',
    liveness:   'Liveness check…',
    extracting: multiFrame ? 'Extracting biometric (3 frames)…' : 'Extracting biometric…',
    done:       'Complete ✓',
    error:      errMsg,
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    setPhotoMode(true);
    setErrMsg('');
    setStage('positioning');
  };

  return (
    <div className="space-y-4">
      {/* Channel Header */}
      <div className={`flex items-center gap-3 p-4 rounded-2xl glass-card border-l-4`}
        style={{ borderLeftColor: meta.ring }}>
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center shadow-lg`}>
          <meta.icon size={20} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-white">{meta.label}</p>
          <p className="text-xs text-slate-400 leading-snug max-w-xs">{meta.hint}</p>
        </div>
        {multiFrame && (
          <span className="ml-auto text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full font-semibold">
            3-Frame
          </span>
        )}
      </div>

      {/* Viewfinder */}
      <div className="relative rounded-3xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {/* Animated gradient border */}
        <div className="scanner-ring-outer">
          <div className="scanner-ring-inner" />
        </div>

        {/* Video / Photo */}
        {photoMode ? (
          <img ref={imageRef} src={photoSrc ?? ''} alt="Scan preview"
            className="absolute inset-[3px] z-10 rounded-[18px] w-[calc(100%-6px)] h-[calc(100%-6px)] object-cover bg-black"
            onLoad={() => { setQuality(1); setHist(p => [...p.slice(1), 1]); }} />
        ) : (
          <video ref={videoRef}
            className="absolute inset-[3px] z-10 rounded-[18px] w-[calc(100%-6px)] h-[calc(100%-6px)] object-cover bg-black"
            playsInline muted autoPlay />
        )}

        {/* Channel overlay emoji */}
        <div className="absolute top-4 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <div className="text-4xl drop-shadow-lg">{meta.overlay}</div>
        </div>

        {/* Corner brackets */}
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="scan-corner scan-corner-tl" />
          <div className="scan-corner scan-corner-tr" />
          <div className="scan-corner scan-corner-bl" />
          <div className="scan-corner scan-corner-br" />

          {/* Channel-specific targeting overlay */}
          {channel === 'muzzle' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-28 h-16 border-2 border-emerald-400/50 rounded-full opacity-60" />
            </div>
          )}
          {channel === 'retina' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <div className="w-20 h-12 border-2 border-violet-400/60 rounded-full" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 border border-violet-400/40 rounded-full" />
                </div>
              </div>
            </div>
          )}
          {channel === 'face' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-36 h-40 border-2 border-orange-400/50 rounded-[40px]" />
            </div>
          )}

          {/* Laser sweep */}
          {(stage === 'positioning' || stage === 'extracting' || stage === 'liveness') && (
            <div className="laser-line" />
          )}
        </div>

        {/* Stage badge */}
        <div className="absolute bottom-4 left-0 right-0 z-20 flex justify-center px-4">
          <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2">
            {(stage === 'starting' || stage === 'liveness' || stage === 'extracting') &&
              <Loader2 size={13} className="animate-spin text-emerald-400" />}
            {stage === 'done' && <CheckCircle2 size={13} className="text-emerald-400" />}
            <span className="text-xs text-white font-semibold">{stageLabel[stage]}</span>
          </div>
        </div>
      </div>

      {/* Extraction progress */}
      {stage === 'extracting' && (
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <motion.div className="h-full rounded-full confidence-bar"
            style={{ background: `linear-gradient(90deg, ${meta.ring}, #34D399)` }}
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }} />
        </div>
      )}

      {/* Signal Quality Histogram */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
            <BarChart3 size={13} /> Signal Quality
          </span>
          <span className="text-xs font-bold" style={{ color: meta.ring }}>
            {Math.round(quality * 100)}%
          </span>
        </div>
        <div className="flex items-end gap-0.5 h-10 mb-2">
          {hist.map((v, i) => (
            <div key={i} className="hist-bar"
              style={{
                height: `${Math.max(6, v * 100)}%`,
                opacity: 0.3 + (i / hist.length) * 0.7,
                background: `linear-gradient(to top, ${meta.ring}, ${meta.ring}88)`,
              }} />
          ))}
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <motion.div className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${meta.ring}, #34D399)` }}
            animate={{ width: `${quality * 100}%` }} transition={{ duration: 0.2 }} />
        </div>
        {quality < 0.3 && stage === 'positioning' && (
          <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
            <AlertTriangle size={11} /> Low signal — improve lighting or get closer
          </p>
        )}
      </div>

      {/* Capture Buttons */}
      {stage === 'positioning' && (
        <div className="space-y-3">
          <motion.button
            id={`btn-capture-${channel}`}
            onClick={capture}
            whileTap={{ scale: 0.97 }}
            className={`btn-base ${channel === 'muzzle' ? 'btn-emerald' : channel === 'retina' ? 'btn-violet' : 'btn-saffron'}`}
          >
            <Camera size={18} />
            {photoMode ? `Use ${meta.label} Photo` : `Capture ${meta.label}`}
            {multiFrame && !photoMode && <span className="text-xs opacity-75 ml-1">(3 frames)</span>}
          </motion.button>
          {!photoMode && (
            <label className="btn-base btn-ghost cursor-pointer">
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
              <Camera size={16} />
              <span>Upload photo instead</span>
            </label>
          )}
        </div>
      )}

      {/* Error Fallback */}
      {stage === 'error' && (
        <div className="glass-card-rose p-4 rounded-2xl space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-rose-300 text-sm">Camera unavailable</p>
              <p className="text-xs text-rose-200/70 mt-1 leading-relaxed">{errMsg}</p>
            </div>
          </div>
          <label className="btn-base btn-ghost cursor-pointer">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
            <Camera size={16} />
            <span>Use photo fallback</span>
          </label>
        </div>
      )}
    </div>
  );
}

// ─── Role Landing ─────────────────────────────────────────────────────────────

function RoleLanding({ onSelectRole }: { onSelectRole: (role: AppRole, farmerId?: string) => void }) {
  const [showFarmerLogin, setShowFarmerLogin] = useState(false);
  const [farmerId, setFarmerId] = useState('');
  const [err, setErr] = useState('');
  const [modelLoaded, setModelLoaded] = useState(isModelLoaded());

  useEffect(() => {
    loadModel().then(() => setModelLoaded(true)).catch(console.error);
  }, []);

  const handleFarmerLogin = () => {
    if (!farmerId.trim()) { setErr('Please enter your Farmer ID'); return; }
    onSelectRole('farmer', farmerId.trim().toUpperCase());
  };

  return (
    <div className="min-h-dvh relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #020817 0%, #0a1628 60%, #0d0a1e 100%)' }}>
      <FloatingOrbs />
      <div className="bg-grid absolute inset-0 opacity-40" />

      <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-sm space-y-6">

          {/* Logo & Branding */}
          <motion.div
            className="text-center space-y-4"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex justify-center">
              <div className="cow-float relative">
                <CowLogo3D size={120} animated />
                {/* 3D shadow */}
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-20 h-4 rounded-full opacity-30"
                  style={{ background: 'radial-gradient(ellipse, #10B981 0%, transparent 70%)' }} />
              </div>
            </div>
            <div>
              <h1 className="text-4xl font-black gradient-text-emerald tracking-tight">किसान-दृष्टि</h1>
              <p className="text-slate-400 text-sm mt-1 font-medium">Kisan-Drishti · Livestock Biometric ID</p>
            </div>
            {/* AI Status */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-medium">
              <div className={`w-2 h-2 rounded-full pulse-glow ${modelLoaded ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {modelLoaded ? '✓ AI Biometric Engine Ready' : 'Loading AI Engine…'}
            </div>
          </motion.div>

          {/* Role Cards */}
          <AnimatePresence mode="wait">
            {!showFarmerLogin ? (
              <motion.div key="roles" className="space-y-3"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}>

                {/* Agent Card */}
                <motion.button
                  onClick={() => onSelectRole('agent')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full p-5 rounded-3xl text-left group relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(124,58,237,0.08) 100%)',
                    border: '1px solid rgba(249,115,22,0.25)',
                    boxShadow: '0 8px 32px rgba(249,115,22,0.12)',
                  }}
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.06), transparent)' }} />
                  <div className="relative flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #7c2d12, #c2410c)', boxShadow: '0 4px 16px rgba(249,115,22,0.4)' }}>
                      🛡
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-white text-lg">Field Agent</p>
                      <p className="text-sm text-slate-400">Register & verify cattle biometrics</p>
                    </div>
                    <ChevronRight size={20} className="text-orange-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                </motion.button>

                {/* Farmer Card */}
                <motion.button
                  onClick={() => setShowFarmerLogin(true)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full p-5 rounded-3xl text-left group relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(14,165,233,0.08) 100%)',
                    border: '1px solid rgba(16,185,129,0.25)',
                    boxShadow: '0 8px 32px rgba(16,185,129,0.12)',
                  }}
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.06), transparent)' }} />
                  <div className="relative flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg, #064e3b, #059669)', boxShadow: '0 4px 16px rgba(16,185,129,0.4)' }}>
                      👨‍🌾
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-white text-lg">Farmer</p>
                      <p className="text-sm text-slate-400">View your cattle records & services</p>
                    </div>
                    <ChevronRight size={20} className="text-emerald-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                </motion.button>

                {/* Feature tags */}
                <div className="flex flex-wrap gap-2 justify-center pt-2">
                  {['🔒 Triple Biometric', '☁️ Cloud Sync', '📱 Offline-First', '🤖 AI Verified'].map(tag => (
                    <span key={tag} className="text-xs text-slate-500 bg-white/4 border border-white/8 px-2.5 py-1 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div key="farmer-login" className="space-y-4"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}>
                <div className="flex items-center gap-3">
                  <button onClick={() => { setShowFarmerLogin(false); setErr(''); }}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <h2 className="font-black text-white">Farmer Login</h2>
                    <p className="text-xs text-slate-400">Enter your Farmer ID to continue</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block font-medium">Farmer ID *</label>
                  <input
                    value={farmerId}
                    onChange={e => { setFarmerId(e.target.value.toUpperCase()); setErr(''); }}
                    placeholder="e.g. F001"
                    className={`input-field font-mono text-lg tracking-wider ${err ? 'input-field-error' : ''}`}
                    onKeyDown={e => e.key === 'Enter' && handleFarmerLogin()}
                    autoFocus
                  />
                  {err && (
                    <p className="text-xs text-rose-400 mt-2 flex items-center gap-1">
                      <AlertCircle size={11} /> {err}
                    </p>
                  )}
                </div>
                <button onClick={handleFarmerLogin} className="btn-base btn-emerald">
                  <CheckCheck size={18} /> View My Cattle
                </button>
                <p className="text-center text-xs text-slate-600">
                  Demo IDs: F001, F002, F003
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── CSV / PDF Export ─────────────────────────────────────────────────────────

function exportCSV(c: Cattle) {
  const rows = [
    ['ID','Name','Breed','Farmer','Date','Fat%','SNF%','SCC(k)','Milk(L)','Temp(°C)','Status'],
    ...c.healthMetrics.map(h => [
      c.id, c.name, c.breed, c.farmerName,
      h.date, h.fatContent.toFixed(2), h.snf.toFixed(2), h.scc.toString(),
      h.milkYield.toString(), h.temperature.toFixed(1), h.healthStatus,
    ]),
  ];
  const blob = new Blob([rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${c.id}_health.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

function exportPDF(c: Cattle) {
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(2, 8, 23); doc.rect(0, 0, W, 40, 'F');
  doc.setTextColor(52, 211, 153); doc.setFontSize(20); doc.text('Kisan-Drishti', 14, 16);
  doc.setTextColor(200, 200, 200); doc.setFontSize(10); doc.text('किसान-दृष्टि · Livestock Health Report', 14, 24);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 14, 32);
  doc.setTextColor(0, 0, 0); doc.setFontSize(12); doc.text('Cattle Information', 14, 52);
  doc.setFontSize(9);
  [[`ID: ${c.id}`, `Tag: ${c.tagNumber}`],[`Name: ${c.name}`,`Breed: ${c.breed}`],
   [`Age: ${c.age}yr`,`Weight: ${c.weight}kg`],[`Farmer: ${c.farmerName}`,`Phone: ${c.farmerPhone}`],
   [`Village: ${c.village}, ${c.district}`,`State: ${c.state}`],
  ].forEach(([a,b], i) => { doc.text(a, 14, 62 + i * 7); doc.text(b, W/2, 62 + i * 7); });
  let y = 102;
  doc.setFillColor(2, 8, 23); doc.rect(14, y-5, W-28, 8, 'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8);
  ['Date','Fat%','SNF%','SCC','Milk(L)','Temp','Status'].forEach((h, i) => doc.text(h, 14 + i * 27, y));
  y += 10;
  c.healthMetrics.forEach((h, idx) => {
    doc.setTextColor(0,0,0);
    if (idx%2===0) { doc.setFillColor(240,253,244); doc.rect(14, y-5, W-28, 8, 'F'); }
    [h.date, h.fatContent.toFixed(1), h.snf.toFixed(1), h.scc.toString(), h.milkYield.toString(), h.temperature.toFixed(1), h.healthStatus]
      .forEach((v, i) => doc.text(v, 14 + i * 27, y));
    y += 9; if (y > 270) { doc.addPage(); y = 20; }
  });
  doc.save(`${c.id}_report.pdf`);
}

// ─── Farmer App ───────────────────────────────────────────────────────────────

function FarmerDashboard({ cattle, farmerName, farmerId, onNavigate, onSelectCattle }: {
  cattle: Cattle[]; farmerName: string; farmerId: string;
  onNavigate: (v: FarmerView) => void;
  onSelectCattle: (c: Cattle) => void;
}) {
  const latestHealth = (c: Cattle) => c.healthMetrics[c.healthMetrics.length - 1];
  const totalMilk = cattle.reduce((s, c) => s + (latestHealth(c)?.milkYield ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden p-5"
        style={{ background: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)', boxShadow: '0 8px 32px rgba(16,185,129,0.25)' }}>
        <FloatingOrbs />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-emerald-300/70 text-xs font-medium">Welcome back</p>
              <h2 className="text-2xl font-black text-white mt-0.5">{farmerName}</h2>
              <p className="text-emerald-400/60 text-xs font-mono mt-1">{farmerId}</p>
            </div>
            <CowLogo3D size={56} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { val: cattle.length, label: 'My Cattle', icon: '🐄' },
              { val: totalMilk, label: 'Milk L/day', icon: '🥛' },
              { val: cattle.filter(c => c.insurance?.status === 'Active').length, label: 'Insured', icon: '🛡' },
            ].map(({ val, label, icon }) => (
              <div key={label} className="bg-white/10 rounded-2xl p-3 text-center">
                <p className="text-lg">{icon}</p>
                <p className="text-xl font-black text-white">{val}</p>
                <p className="text-xs text-emerald-200/60 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: '🐄', label: 'My Cattle', sub: `${cattle.length} animals`, view: 'cattle' as FarmerView, grad: 'from-emerald-800 to-teal-700' },
          { icon: '🛡', label: 'Insurance', sub: 'Policies & claims', view: 'insurance' as FarmerView, grad: 'from-violet-800 to-purple-700' },
          { icon: '🏦', label: 'Loans', sub: 'KCC & credit', view: 'loan' as FarmerView, grad: 'from-amber-800 to-orange-700' },
          { icon: '📋', label: 'Schemes', sub: 'Govt. programs', view: 'schemes' as FarmerView, grad: 'from-blue-800 to-sky-700' },
        ].map(a => (
          <motion.button key={a.label} onClick={() => onNavigate(a.view)}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="p-4 rounded-2xl text-left glass-card hover:border-white/16 transition-all">
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${a.grad} flex items-center justify-center text-2xl mb-3 shadow-md`}>
              {a.icon}
            </div>
            <p className="font-bold text-white text-sm">{a.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{a.sub}</p>
          </motion.button>
        ))}
      </div>

      {/* Recent Cattle */}
      {cattle.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Recent Cattle</h3>
            <button onClick={() => onNavigate('cattle')} className="text-xs text-emerald-400 font-semibold">View All →</button>
          </div>
          {cattle.slice(0, 3).map(c => {
            const latest = latestHealth(c);
            return (
              <motion.button key={c.id} onClick={() => onSelectCattle(c)} whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-3 p-3 mb-2 glass-card text-left hover:border-emerald-500/30 transition-all">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>🐄</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">{c.name} <span className="text-slate-500 font-normal">· {c.breed}</span></p>
                  <p className="text-xs text-slate-500 font-mono truncate">{c.id}</p>
                </div>
                {latest && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${healthClass(latest.healthStatus)}`}>
                    {latest.healthStatus}
                  </span>
                )}
                <ChevronRight size={14} className="text-slate-600" />
              </motion.button>
            );
          })}
        </div>
      )}

      {cattle.length === 0 && (
        <div className="glass-card p-8 text-center space-y-3">
          <p className="text-4xl">🐄</p>
          <p className="text-white font-bold">No cattle registered yet</p>
          <p className="text-xs text-slate-500">Contact a field agent to register your cattle with biometric identity.</p>
        </div>
      )}
    </div>
  );
}

function MyCattleView({ cattle, onSelectCattle, onBack }: {
  cattle: Cattle[]; onSelectCattle: (c: Cattle) => void; onBack: () => void
}) {
  const [search, setSearch] = useState('');
  const filtered = cattle.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase()) ||
    c.breed.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-black text-white text-lg">My Cattle</h2>
          <p className="text-xs text-slate-400">{cattle.length} registered animals</p>
        </div>
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, ID or breed…" className="input-field pl-9" />
      </div>
      <div className="space-y-2">
        {filtered.map(c => {
          const latest = c.healthMetrics[c.healthMetrics.length - 1];
          return (
            <motion.button key={c.id} onClick={() => onSelectCattle(c)} whileTap={{ scale: 0.98 }}
              className="w-full glass-card p-4 text-left flex items-start gap-3 hover:border-white/15">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>🐄</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-black text-white">{c.name}</p>
                  <span className="text-xs text-slate-500">{c.breed}</span>
                  {c.tagNumber && <span className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{c.tagNumber}</span>}
                </div>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{c.id}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => (
                    <span key={ch} className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${c.biometricStatus[ch] ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                      {ch === 'muzzle' ? '🐽' : ch === 'retina' ? '👁' : '🐄'} {ch}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {latest && <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${healthClass(latest.healthStatus)}`}>{latest.healthStatus}</span>}
                {c.insurance?.status === 'Active' && <span className="text-xs text-blue-400">🛡 Insured</span>}
              </div>
            </motion.button>
          );
        })}
        {filtered.length === 0 && <p className="text-center text-slate-500 py-10">No cattle found</p>}
      </div>
    </div>
  );
}

function CattleDetailView({ cattle, onBack }: { cattle: Cattle; onBack: () => void }) {
  const [tab, setTab] = useState<'health' | 'info' | 'finance'>('health');
  const latest = cattle.healthMetrics[cattle.healthMetrics.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-black text-white text-lg">{cattle.name}</h2>
          <p className="text-xs text-slate-400 font-mono">{cattle.id}</p>
        </div>
        {latest && <span className={`text-xs px-3 py-1 rounded-full border font-bold ${healthClass(latest.healthStatus)}`}>{latest.healthStatus}</span>}
      </div>

      {/* Hero card */}
      <div className="relative rounded-3xl overflow-hidden p-4"
        style={{ background: 'linear-gradient(135deg, #0c1a2e, #0d2b1e)' }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl"
            style={{ background: 'linear-gradient(135deg, #064e3b, #065f46)' }}>🐄</div>
          <div>
            <p className="font-black text-white text-xl">{cattle.name}</p>
            <p className="text-emerald-400 font-medium">{cattle.breed}</p>
            <p className="text-slate-400 text-xs">{cattle.color} · {cattle.age} years · {cattle.weight}kg</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => (
            <div key={ch} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-semibold border ${cattle.biometricStatus[ch] ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
              {cattle.biometricStatus[ch] ? <CheckCircle2 size={11} /> : <X size={11} />}
              {ch === 'muzzle' ? '🐽 Muzzle' : ch === 'retina' ? '👁 Retina' : '🐄 Face'}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-2xl">
        {(['health', 'info', 'finance'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all ${tab === t ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400'}`}>
            {t === 'health' ? '❤️ Health' : t === 'info' ? '📋 Info' : '💰 Finance'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'health' && (
          <motion.div key="health" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {latest && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Fat %',  val: latest.fatContent.toFixed(1), icon: Droplets,    color: 'text-blue-400' },
                  { label: 'SNF %',  val: latest.snf.toFixed(1),        icon: Activity,    color: 'text-violet-400' },
                  { label: 'Milk L', val: latest.milkYield.toString(),   icon: Zap,         color: 'text-emerald-400' },
                  { label: 'SCC (k)',val: latest.scc.toString(),          icon: BarChart3,   color: 'text-rose-400' },
                  { label: 'Temp °C',val: latest.temperature.toFixed(1), icon: Thermometer, color: 'text-amber-400' },
                  { label: 'Weight', val: `${latest.weight}kg`,          icon: TrendingUp,  color: 'text-teal-400' },
                ].map(m => (
                  <div key={m.label} className="glass-card p-3 text-center">
                    <m.icon size={14} className={`${m.color} mx-auto mb-1`} />
                    <p className="font-bold text-white text-sm">{m.val}</p>
                    <p className="text-xs text-slate-500">{m.label}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => exportCSV(cattle)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm font-semibold">
                <Download size={14} /> CSV
              </button>
              <button onClick={() => exportPDF(cattle)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-violet-600/20 border border-violet-500/30 text-violet-300 text-sm font-semibold">
                <Download size={14} /> PDF
              </button>
            </div>
            {[...cattle.healthMetrics].reverse().map(h => (
              <div key={h.dairyId} className={`p-3 border rounded-2xl ${healthClass(h.healthStatus)}`}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-slate-400 font-mono">{h.date}</span>
                  <span className="text-xs font-bold">{h.healthStatus}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-xs">
                  <span><span className="text-slate-500">Fat: </span><span className="font-semibold">{h.fatContent.toFixed(1)}%</span></span>
                  <span><span className="text-slate-500">Milk: </span><span className="font-semibold">{h.milkYield}L</span></span>
                  <span><span className="text-slate-500">SCC: </span><span className="font-semibold">{h.scc}k</span></span>
                </div>
                {h.vetNotes && <p className="text-xs text-slate-500 mt-1 italic">{h.vetNotes}</p>}
              </div>
            ))}
          </motion.div>
        )}
        {tab === 'info' && (
          <motion.div key="info" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <div className="glass-card p-4 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cattle Details</p>
              {[['Tag Number', cattle.tagNumber], ['Breed', cattle.breed], ['Age', `${cattle.age} years`],
                ['Weight', `${cattle.weight} kg`], ['Color', cattle.color], ['Status', cattle.status],
                ['Registered', fmt(cattle.registeredAt)], ['Agent ID', cattle.registeredBy],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-t border-white/5">
                  <span className="text-xs text-slate-400">{k}</span>
                  <span className="text-xs font-semibold text-white font-mono">{v}</span>
                </div>
              ))}
            </div>
            <div className="glass-card p-4 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Farmer Details</p>
              {[['Name', cattle.farmerName], ['Farmer ID', cattle.farmerId],
                ['Phone', cattle.farmerPhone], ['Village', cattle.village],
                ['District', cattle.district], ['State', cattle.state],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-t border-white/5">
                  <span className="text-xs text-slate-400">{k}</span>
                  <span className="text-xs font-semibold text-white">{v}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
        {tab === 'finance' && (
          <motion.div key="finance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {cattle.insurance && (
              <div className="glass-card p-4 space-y-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">🛡 Insurance</p>
                {[['Policy No.', cattle.insurance.policyNumber],
                  ['Provider', cattle.insurance.provider.split(' ').slice(0,3).join(' ')],
                  ['Sum Assured', inr(cattle.insurance.sumAssured)],
                  ['Premium', inr(cattle.insurance.premium) + '/yr'],
                  ['Valid Till', cattle.insurance.endDate],
                  ['Status', cattle.insurance.status],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-t border-white/5">
                    <span className="text-xs text-slate-400">{k}</span>
                    <span className={`text-xs font-semibold ${v === 'Active' ? 'text-emerald-400' : v === 'Expired' ? 'text-red-400' : 'text-white'}`}>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {cattle.loan && (
              <div className="glass-card p-4 space-y-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">🏦 Loan</p>
                {[['Loan ID', cattle.loan.loanId], ['Bank', cattle.loan.bank],
                  ['Principal', inr(cattle.loan.principal)],
                  ['Outstanding', inr(cattle.loan.outstanding)],
                  ['EMI', inr(cattle.loan.emi) + '/month'],
                  ['Next Due', cattle.loan.nextDueDate],
                  ['Status', cattle.loan.status],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-t border-white/5">
                    <span className="text-xs text-slate-400">{k}</span>
                    <span className={`text-xs font-semibold ${v === 'Overdue' ? 'text-red-400' : 'text-white'}`}>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {!cattle.insurance && !cattle.loan && (
              <div className="glass-card p-8 text-center text-slate-500">No financial records found</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FarmerApp({ farmerId, farmerName, onLogout }: { farmerId: string; farmerName: string; onLogout: () => void }) {
  const [view, setView] = useState<FarmerView>('dashboard');
  const [cattle, setCattle] = useState<Cattle[]>([]);
  const [selectedCattle, setSelectedCattle] = useState<Cattle | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const { toasts, add: addToast, remove } = useToast();

  const refresh = useCallback(async () => {
    const all = await getCattleByFarmer(farmerId);
    setCattle(all);
  }, [farmerId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!isOnline()) { setSyncStatus('offline'); return; }
    setSyncStatus('syncing');
    pullAllFromCloud()
      .then(() => { setSyncStatus('synced'); refresh(); })
      .catch(() => setSyncStatus('error'));
    track('farmer_portal_opened', { farmerId });
  }, [farmerId, refresh]);

  const navigate = (v: FarmerView) => { setSelectedCattle(null); setView(v); };

  const farmerNav = [
    { v: 'dashboard' as FarmerView, icon: Home, label: 'Home' },
    { v: 'cattle' as FarmerView,    icon: Database, label: 'Cattle' },
    { v: 'services' as FarmerView,  icon: Settings, label: 'Services' },
    { v: 'profile' as FarmerView,   icon: UserCircle, label: 'Profile' },
  ];

  return (
    <div className="min-h-dvh" style={{ background: 'linear-gradient(160deg, #020817 0%, #0a1a10 100%)' }}>
      <Toast toasts={toasts} remove={remove} />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/6"
        style={{ background: 'rgba(2,8,23,0.9)', backdropFilter: 'blur(20px)' }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <CowLogo3D size={32} />
            <div>
              <p className="text-sm font-black text-white leading-none">किसान-दृष्टि</p>
              <p className="text-xs text-emerald-400">Farmer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncBadge status={syncStatus} />
            <button onClick={onLogout} className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded-lg bg-white/5">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-2xl px-4 py-5 safe-bottom">
        <AnimatePresence mode="wait">
          <motion.div key={view + (selectedCattle?.id ?? '')}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {view === 'dashboard' && !selectedCattle &&
              <FarmerDashboard cattle={cattle} farmerName={farmerName} farmerId={farmerId}
                onNavigate={navigate} onSelectCattle={c => { setSelectedCattle(c); setView('detail'); }} />}
            {view === 'cattle' && !selectedCattle &&
              <MyCattleView cattle={cattle} onSelectCattle={c => { setSelectedCattle(c); setView('detail'); }} onBack={() => navigate('dashboard')} />}
            {view === 'detail' && selectedCattle &&
              <CattleDetailView cattle={selectedCattle} onBack={() => { setSelectedCattle(null); setView('cattle'); }} />}
            {(view === 'services' || view === 'insurance' || view === 'loan' || view === 'vet' || view === 'schemes') && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => navigate('dashboard')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                    <ArrowLeft size={18} />
                  </button>
                  <h2 className="font-black text-white text-lg">Services</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: '🛡', label: 'Insurance', view: 'insurance' as FarmerView, grad: 'from-violet-800 to-purple-700' },
                    { icon: '🏦', label: 'Loans & Credit', view: 'loan' as FarmerView, grad: 'from-amber-800 to-orange-700' },
                    { icon: '🩺', label: 'Vet Booking', view: 'vet' as FarmerView, grad: 'from-rose-800 to-pink-700' },
                    { icon: '📋', label: 'Govt. Schemes', view: 'schemes' as FarmerView, grad: 'from-blue-800 to-sky-700' },
                  ].map(s => (
                    <motion.button key={s.label} onClick={() => navigate(s.view)}
                      whileTap={{ scale: 0.97 }} className="p-4 rounded-2xl text-left glass-card">
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${s.grad} flex items-center justify-center text-2xl mb-3`}>{s.icon}</div>
                      <p className="font-bold text-white text-sm">{s.label}</p>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
            {view === 'profile' && (
              <div className="space-y-4">
                <h2 className="font-black text-white text-lg">Profile</h2>
                <div className="glass-card p-5 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-700 to-teal-600 flex items-center justify-center text-3xl">👨‍🌾</div>
                    <div>
                      <p className="font-black text-white text-xl">{farmerName}</p>
                      <p className="text-emerald-400 font-mono text-sm">{farmerId}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/5">
                    <div className="glass-card p-3 text-center">
                      <p className="text-2xl font-black text-white">{cattle.length}</p>
                      <p className="text-xs text-slate-400">Cattle</p>
                    </div>
                    <div className="glass-card p-3 text-center">
                      <p className="text-2xl font-black text-white">{cattle.filter(c => c.insurance?.status === 'Active').length}</p>
                      <p className="text-xs text-slate-400">Insured</p>
                    </div>
                  </div>
                </div>
                <button onClick={onLogout} className="btn-base btn-danger">
                  <X size={16} /> Logout
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        <div className="mx-auto max-w-2xl flex items-stretch h-16">
          {farmerNav.map(({ v, icon: Icon, label }) => {
            const active = view === v;
            return (
              <button key={v} onClick={() => navigate(v)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${active ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[10px] font-semibold">{label}</span>
                {active && <div className="absolute bottom-1 w-1 h-1 bg-emerald-400 rounded-full" />}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ─── Agent Dashboard ──────────────────────────────────────────────────────────

function AgentDashboard({ cattle, agentId, onNavigate }: {
  cattle: Cattle[]; agentId: string;
  onNavigate: (v: AgentView) => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const todayCount = cattle.filter(c => new Date(c.registeredAt).toISOString().split('T')[0] === today).length;
  const verified = cattle.filter(c => c.status === 'Verified').length;
  const synced   = cattle.filter(c => c.status === 'Synced').length;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden p-5"
        style={{ background: 'linear-gradient(135deg, #431407 0%, #7c2d12 40%, #c2410c 100%)', boxShadow: '0 8px 32px rgba(249,115,22,0.3)' }}>
        <FloatingOrbs />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-orange-300/70 text-xs font-medium">Agent Portal 🛡</p>
              <h2 className="text-2xl font-black text-white mt-0.5">Field Dashboard</h2>
              <p className="text-orange-400/60 text-xs font-mono mt-1">{agentId}</p>
            </div>
            <CowLogo3D size={56} animated />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { val: cattle.length, label: 'Total', icon: '🐄' },
              { val: todayCount,    label: 'Today',  icon: '➕' },
              { val: verified,      label: 'Verified', icon: '✅' },
              { val: synced,        label: 'Synced',  icon: '☁️' },
            ].map(({ val, label, icon }) => (
              <div key={label} className="bg-white/10 rounded-2xl p-2 text-center">
                <p className="text-base">{icon}</p>
                <p className="text-lg font-black text-white">{val}</p>
                <p className="text-[10px] text-orange-200/60 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Cards */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent Actions</h3>
        {[
          { icon: Plus,        label: 'Register New Cattle',   sub: 'Triple biometric enrollment (Muzzle + Retina + Face ID)',  view: 'register' as AgentView, grad: 'from-emerald-700 to-teal-600', glow: 'rgba(16,185,129,0.3)',  btn: 'btn-emerald' },
          { icon: ShieldCheck, label: 'Verify Cattle',         sub: 'Biometric scan → AI match → registered or unregistered',  view: 'verify' as AgentView,   grad: 'from-orange-700 to-amber-600', glow: 'rgba(249,115,22,0.3)',  btn: 'btn-saffron' },
          { icon: Database,    label: 'All Records',           sub: 'Browse and search the full cattle database',             view: 'records' as AgentView,  grad: 'from-blue-700 to-sky-600',    glow: 'rgba(14,165,233,0.3)', btn: 'btn-ghost' },
          { icon: BookOpen,    label: 'Audit Ledger',          sub: 'Immutable log of all registrations and verifications',   view: 'ledger' as AgentView,   grad: 'from-violet-700 to-purple-600', glow: 'rgba(124,58,237,0.3)', btn: 'btn-ghost' },
          { icon: Settings,    label: 'Agent Config',          sub: 'Adjust biometric thresholds and sensitivity',           view: 'config' as AgentView,   grad: 'from-slate-700 to-slate-600', glow: 'rgba(100,116,139,0.3)', btn: 'btn-ghost' },
        ].map(a => (
          <motion.button key={a.label}
            id={`btn-agent-${a.view}`}
            onClick={() => onNavigate(a.view)}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            className="w-full flex items-center gap-4 p-4 glass-card text-left hover:border-white/16 transition-all group">
            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${a.grad} flex items-center justify-center flex-shrink-0`}
              style={{ boxShadow: `0 4px 16px ${a.glow}` }}>
              <a.icon size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white">{a.label}</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-snug">{a.sub}</p>
            </div>
            <ChevronRight size={18} className="text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
          </motion.button>
        ))}
      </div>

      {/* Recent */}
      {cattle.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Recently Registered</h3>
          {cattle.slice(0, 3).map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 mb-2 glass-card">
              <span className="text-xl flex-shrink-0">🐄</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm truncate">{c.name} · {c.breed}</p>
                <p className="text-xs text-slate-500 font-mono truncate">{c.id}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusClass(c.status)}`}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Register Cattle View ─────────────────────────────────────────────────────

function RegisterCattleView({ onSuccess, onBack }: {
  onSuccess: (cattle: Cattle) => void; onBack: () => void
}) {
  type RegStep = 'details' | 'muzzle' | 'retina' | 'face' | 'review' | 'saving' | 'done';
  const { settings } = useSettings();
  const [step, setStep] = useState<RegStep>('details');
  const [form, setForm] = useState({
    name: '', breed: '', tagNumber: '', age: '', weight: '', color: '',
    farmerName: '', farmerId: '', farmerPhone: '', village: '', district: '', state: '',
  });
  const [muzzleVec, setMuzzleVec] = useState<number[] | null>(null);
  const [retinaVec, setRetinaVec] = useState<number[] | null>(null);
  const [faceVec,   setFaceVec]   = useState<number[] | null>(null);
  const [savedId, setSavedId] = useState('');
  const [err, setErr] = useState('');
  const [syncing, setSyncing] = useState(false);

  const breeds = ['Gir', 'Sahiwal', 'Murrah Buffalo', 'Tharparkar', 'Red Sindhi', 'Jersey Cross', 'HF Cross', 'Ongole'];

  const STEPS: RegStep[] = ['details', 'muzzle', 'retina', 'face', 'review'];
  const stepIdx = STEPS.indexOf(step);

  const validateDetails = () => {
    const { name, breed, farmerId, farmerName, farmerPhone } = form;
    if (!name.trim() || !breed || !farmerId.trim() || !farmerName.trim() || !farmerPhone.trim()) {
      setErr('Please fill all required fields marked with *'); return false;
    }
    if (!/^\d{10}$/.test(farmerPhone.trim())) {
      setErr('Farmer phone must be a 10-digit number'); return false;
    }
    setErr(''); return true;
  };

  const handleSave = async () => {
    setStep('saving');
    try {
      const cattle = await addCattle({
        tagNumber:  form.tagNumber || `TAG-${Date.now()}`,
        name:       form.name.trim(),
        breed:      form.breed,
        age:        parseInt(form.age) || 3,
        weight:     parseInt(form.weight) || 350,
        color:      form.color || 'Brown',
        farmerId:   form.farmerId.trim().toUpperCase(),
        farmerName: form.farmerName.trim(),
        farmerPhone: form.farmerPhone.trim(),
        village:    form.village.trim() || 'Unknown',
        district:   form.district.trim() || 'Unknown',
        state:      form.state.trim() || 'Unknown',
        muzzleEmbedding: muzzleVec!,
        retinaEmbedding: retinaVec!,
        faceEmbedding:   faceVec!,
        biometricStatus: { muzzle: true, retina: true, face: true },
        registeredBy: settings.agentId,
        lastModified: Date.now(),
        status: 'Offline',
      });

      setSavedId(cattle.id);

      // ✅ CRITICAL FIX: Push to Firestore immediately after local save
      setSyncing(true);
      try {
        await pushCattleToCloud(cattle);
        // Also push the ledger entries
        const ledgerEntries = await getLedgerEntries(cattle.id);
        await Promise.all(ledgerEntries.map(e => pushLedgerToCloud(e)));
      } catch (syncErr) {
        console.warn('[Register] Cloud sync failed (data saved locally):', syncErr);
      } finally {
        setSyncing(false);
      }

      setStep('done');
      onSuccess(cattle);
    } catch (e) {
      setErr((e as Error).message);
      setStep('details');
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={step === 'details' ? onBack : () => setStep('details')}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-black text-white text-lg">Register Cattle</h2>
          <p className="text-xs text-slate-400">Triple biometric enrollment + Firebase sync</p>
        </div>
      </div>

      {/* Step Progress */}
      {step !== 'saving' && step !== 'done' && (
        <div className="flex items-center gap-1">
          {['Details','Muzzle','Retina','Face','Review'].map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1 text-xs font-semibold transition-colors ${i <= stepIdx ? 'text-emerald-400' : 'text-slate-600'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border-2 transition-all font-bold ${
                  i < stepIdx  ? 'bg-emerald-500 border-emerald-500 text-white' :
                  i === stepIdx ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10' :
                  'border-slate-700 text-slate-600'
                }`}>
                  {i < stepIdx ? '✓' : i + 1}
                </div>
                <span className="hidden sm:block text-xs">{s}</span>
              </div>
              {i < 4 && <div className={`step-connector ${i < stepIdx ? 'done' : 'pending'}`} />}
            </React.Fragment>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* Details */}
        {step === 'details' && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-4 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">🐄 Cattle Information</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { k: 'name' as const,      label: 'Name *',       ph: 'Lakshmi',   span: 2 },
                  { k: 'breed' as const,     label: 'Breed *',      ph: '',           span: 2, isSelect: true },
                  { k: 'tagNumber' as const, label: 'Ear Tag',      ph: 'TAG-001',   span: 1 },
                  { k: 'color' as const,     label: 'Color',        ph: 'Brown',     span: 1 },
                  { k: 'age' as const,       label: 'Age (yrs)',    ph: '3',         span: 1, type: 'number' },
                  { k: 'weight' as const,    label: 'Weight (kg)',  ph: '350',       span: 1, type: 'number' },
                ].map(f => (
                  <div key={f.k} className={f.span === 2 ? 'col-span-2' : ''}>
                    <label className="text-xs text-slate-400 mb-1.5 block">{f.label}</label>
                    {f.isSelect ? (
                      <select id={`sel-${f.k}`} value={form[f.k]} onChange={set(f.k)} className="input-field">
                        <option value="">Select breed…</option>
                        {breeds.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : (
                      <input id={`inp-${f.k}`} value={form[f.k]} onChange={set(f.k)}
                        placeholder={f.ph} type={f.type || 'text'} className="input-field" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-4 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">👤 Farmer Information</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { k: 'farmerName' as const,  label: 'Farmer Name *', ph: 'Rajesh Kumar',  span: 2 },
                  { k: 'farmerId' as const,    label: 'Farmer ID *',   ph: 'F001',          span: 1 },
                  { k: 'farmerPhone' as const, label: 'Phone * (10d)', ph: '9876543210',    span: 1 },
                  { k: 'village' as const,     label: 'Village',       ph: 'Wadgaon',       span: 1 },
                  { k: 'district' as const,    label: 'District',      ph: 'Pune',          span: 1 },
                  { k: 'state' as const,       label: 'State',         ph: 'Maharashtra',   span: 2 },
                ].map(f => (
                  <div key={f.k} className={f.span === 2 ? 'col-span-2' : ''}>
                    <label className="text-xs text-slate-400 mb-1.5 block">{f.label}</label>
                    <input id={`inp-${f.k}`} value={form[f.k]} onChange={set(f.k)}
                      placeholder={f.ph} className="input-field" />
                  </div>
                ))}
              </div>
            </div>

            {err && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-950/50 border border-red-500/30">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{err}</p>
              </div>
            )}
            <button className="btn-base btn-emerald" onClick={() => validateDetails() && setStep('muzzle')}>
              Next: Muzzle Scan 🐽 →
            </button>
          </motion.div>
        )}

        {/* Muzzle */}
        {step === 'muzzle' && (
          <motion.div key="muzzle" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel="muzzle" multiFrame
              onComplete={(v) => { setMuzzleVec(v); setStep('retina'); }}
              onError={setErr} />
            {err && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertCircle size={11} />{err}</p>}
          </motion.div>
        )}

        {/* Retina */}
        {step === 'retina' && (
          <motion.div key="retina" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel="retina" multiFrame
              onComplete={(v) => { setRetinaVec(v); setStep('face'); }}
              onError={setErr} />
            {err && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertCircle size={11} />{err}</p>}
          </motion.div>
        )}

        {/* Face */}
        {step === 'face' && (
          <motion.div key="face" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel="face" multiFrame
              onComplete={(v) => { setFaceVec(v); setStep('review'); }}
              onError={setErr} />
            {err && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertCircle size={11} />{err}</p>}
          </motion.div>
        )}

        {/* Review */}
        {step === 'review' && (
          <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-4 space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">📋 Registration Summary</p>
              {[['Name', form.name], ['Breed', form.breed], ['Farmer', form.farmerName],
                ['Farmer ID', form.farmerId.toUpperCase()], ['Village', form.village || '—'],
                ['Phone', form.farmerPhone]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-t border-white/5">
                  <span className="text-xs text-slate-400">{k}</span>
                  <span className="text-xs font-semibold text-white">{v}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { ch: 'muzzle', icon: '🐽', label: 'Muzzle', ok: !!muzzleVec },
                { ch: 'retina', icon: '👁',  label: 'Retina', ok: !!retinaVec },
                { ch: 'face',   icon: '🐄', label: 'Face ID', ok: !!faceVec   },
              ].map(b => (
                <div key={b.ch} className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border font-medium text-xs ${b.ok ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'}`}>
                  <span className="text-2xl">{b.icon}</span>
                  <span>{b.label}</span>
                  {b.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/25">
              <Info size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-300/80">Data will be saved locally and synced to Firebase cloud automatically.</p>
            </div>

            {err && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-950/50 border border-red-500/30">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{err}</p>
              </div>
            )}
            <button className="btn-base btn-emerald" onClick={handleSave}>
              <Database size={18} /> Save & Sync to Firebase
            </button>
          </motion.div>
        )}

        {/* Saving */}
        {step === 'saving' && (
          <motion.div key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-5 py-16">
            <div className="relative">
              <Loader2 size={52} className="animate-spin text-emerald-400" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Database size={18} className="text-emerald-300" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-white font-bold">{syncing ? 'Syncing to Firebase…' : 'Saving biometric data…'}</p>
              <p className="text-xs text-slate-500">Triple biometric enrollment in progress</p>
            </div>
          </motion.div>
        )}

        {/* Done */}
        {step === 'done' && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-5 py-8">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
              className="w-24 h-24 rounded-full flex items-center justify-center success-pulse"
              style={{ background: 'linear-gradient(135deg, #064e3b, #059669)', boxShadow: '0 0 40px rgba(16,185,129,0.5)' }}>
              <CheckCircle2 size={48} className="text-emerald-200" />
            </motion.div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black text-white">Cattle Aadhaar Issued! 🎉</h3>
              <p className="text-slate-400 text-sm">Triple biometric enrolled · Synced to Firebase</p>
              <div className="mt-4 p-4 glass-card-emerald rounded-2xl">
                <p className="text-xs text-slate-400 mb-1">Cattle Biometric ID</p>
                <p className="font-mono font-black text-emerald-400 text-lg tracking-wider">{savedId}</p>
              </div>
              <div className="flex gap-2 mt-2 justify-center">
                {['🐽 Muzzle', '👁 Retina', '🐄 Face'].map(b => (
                  <span key={b} className="text-xs bg-emerald-500/15 text-emerald-300 px-2 py-1 rounded-full border border-emerald-500/25">{b} ✓</span>
                ))}
              </div>
            </div>
            <button className="btn-base btn-emerald" onClick={onBack}>← Back to Dashboard</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Verify Cattle View ───────────────────────────────────────────────────────

function VerifyCattleView({ cattle, onBack }: { cattle: Cattle[]; onBack: () => void }) {
  const { settings } = useSettings();
  const [selectedChannel, setSelectedChannel] = useState<BiometricChannel | null>(null);
  const [step, setStep] = useState<'select' | 'scan' | 'result'>('select');
  const [result, setResult] = useState<ReturnType<typeof findBestMatch> | null>(null);
  const [err, setErr] = useState('');

  const thresholds: Record<BiometricChannel, number> = {
    muzzle: settings.muzzleThreshold,
    retina: settings.retinaThreshold,
    face:   settings.faceThreshold,
  };

  const handleScanComplete = async (vec: number[], ch: BiometricChannel) => {
    const res = findBestMatch(vec, cattle, ch, thresholds[ch]);
    setResult(res);

    if (res.cattle) {
      await addVerificationLedger(res.cattle.id, ch, res.confidence, settings.agentId, res.matched);
    }

    setStep('result');
  };

  const reset = () => {
    setStep('select');
    setSelectedChannel(null);
    setResult(null);
    setErr('');
  };

  // User-friendly reason messages
  const reasonMessages: Record<string, { title: string; detail: string; advice: string }> = {
    MATCH: {
      title: '✅ Match Found!',
      detail: 'Biometric signature verified against registered database.',
      advice: 'This cattle is registered and authenticated.',
    },
    BELOW_THRESHOLD: {
      title: '❌ Verification Failed',
      detail: `Biometric confidence (${((result?.confidence ?? 0) * 100).toFixed(1)}%) is below the ${(thresholds[selectedChannel ?? 'muzzle'] * 100).toFixed(0)}% required threshold.`,
      advice: 'This animal does not match any registered cattle. Try a different channel or re-scan in better lighting.',
    },
    UNREGISTERED: {
      title: '🚫 Unregistered Animal',
      detail: 'Ambiguous biometric match — no single cattle has a clear majority confidence.',
      advice: 'This animal is likely NOT registered in the system. Register it first using the "Register Cattle" flow.',
    },
    NO_CATTLE_IN_DB: {
      title: '📭 No Cattle in Database',
      detail: 'There are no registered cattle to compare against.',
      advice: 'Please register cattle first before attempting verification.',
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={step !== 'select' ? reset : onBack}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-black text-white text-lg">Verify Cattle</h2>
          <p className="text-xs text-slate-400">Match against {cattle.length} registered animals</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Channel Select */}
        {step === 'select' && (
          <motion.div key="select" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
            <div className="glass-card p-4 rounded-3xl">
              <p className="font-bold text-white mb-1">Select Biometric Channel</p>
              <p className="text-xs text-slate-400">Choose ONE channel. Any single channel is sufficient for identification.</p>
            </div>
            {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => {
              const meta = CHANNEL_META[ch];
              const isSelected = selectedChannel === ch;
              return (
                <motion.button key={ch} id={`btn-channel-${ch}`} onClick={() => setSelectedChannel(ch)}
                  whileTap={{ scale: 0.97 }}
                  className={`w-full p-5 rounded-3xl text-left transition-all border-2 ${isSelected ? 'border-emerald-500/60 bg-emerald-500/10' : 'glass-card border-transparent hover:border-white/15'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                      <meta.icon size={26} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-white text-lg">{meta.overlay} {meta.label}</p>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 leading-snug">{meta.hint}</p>
                      <p className={`text-xs mt-1 font-bold ${meta.color}`}>
                        Threshold: {(thresholds[ch] * 100).toFixed(0)}% match required
                      </p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-600'}`}>
                      {isSelected && <CheckCircle2 size={12} className="text-white" />}
                    </div>
                  </div>
                </motion.button>
              );
            })}
            {selectedChannel && (
              <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={`btn-base ${selectedChannel === 'muzzle' ? 'btn-emerald' : selectedChannel === 'retina' ? 'btn-violet' : 'btn-saffron'}`}
                onClick={() => setStep('scan')}>
                Start {CHANNEL_META[selectedChannel].label} →
              </motion.button>
            )}
          </motion.div>
        )}

        {/* Scanner */}
        {step === 'scan' && selectedChannel && (
          <motion.div key="scan" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel={selectedChannel} onComplete={handleScanComplete} onError={msg => setErr(msg)} />
            {err && (
              <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-red-950/50 border border-red-500/30">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{err}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Result */}
        {step === 'result' && result && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
            {result.matched ? (
              <>
                {/* Match Card */}
                <div className="flex flex-col items-center gap-4 p-6 rounded-3xl success-pulse"
                  style={{ background: 'linear-gradient(135deg, #064e3b, #065f46)', boxShadow: '0 8px 32px rgba(16,185,129,0.4)' }}>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 180 }}>
                    <CheckCircle2 size={60} className="text-emerald-300" />
                  </motion.div>
                  <div className="text-center">
                    <h3 className="text-2xl font-black text-white">Match Confirmed!</h3>
                    <p className="text-xs text-emerald-300/70 mt-1">via {selectedChannel?.toUpperCase()} biometric</p>
                  </div>
                  <div className="text-center">
                    <p className="text-5xl font-black text-emerald-300">{(result.confidence * 100).toFixed(1)}%</p>
                    <p className="text-xs text-emerald-400/70 mt-1">Confidence Score</p>
                  </div>
                  <div className="w-full bg-black/30 rounded-full h-3">
                    <motion.div className="h-3 rounded-full confidence-bar"
                      style={{ background: 'linear-gradient(90deg, #059669, #34D399)' }}
                      initial={{ width: 0 }} animate={{ width: `${result.confidence * 100}%` }}
                      transition={{ duration: 1.2, ease: 'easeOut' }} />
                  </div>
                </div>

                {/* Cattle Info */}
                {result.cattle && (
                  <div className="glass-card p-4 space-y-2">
                    <div className="flex items-center gap-3 pb-3 border-b border-white/8">
                      <span className="text-4xl">🐄</span>
                      <div className="flex-1">
                        <p className="font-black text-white text-xl">{result.cattle.name}</p>
                        <p className="text-emerald-400 text-sm">{result.cattle.breed} · {result.cattle.age}yr · {result.cattle.weight}kg</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${statusClass(result.cattle.status)}`}>
                        {result.cattle.status}
                      </span>
                    </div>
                    {[
                      ['Cattle ID', result.cattle.id],
                      ['Tag No.', result.cattle.tagNumber],
                      ['Farmer', result.cattle.farmerName],
                      ['Farmer ID', result.cattle.farmerId],
                      ['Village', result.cattle.village],
                      ['District', result.cattle.district],
                      ['Registered', fmt(result.cattle.registeredAt)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between py-1.5 border-t border-white/5">
                        <span className="text-xs text-slate-400">{k}</span>
                        <span className="text-xs font-semibold text-white font-mono">{v}</span>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-2 border-t border-white/5">
                      {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => (
                        <div key={ch} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs border ${result.cattle!.biometricStatus[ch] ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'} ${ch === selectedChannel ? 'ring-2 ring-emerald-400/50' : ''}`}>
                          {ch === 'muzzle' ? '🐽' : ch === 'retina' ? '👁' : '🐄'}
                          {ch === selectedChannel && ' ✓'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Fail Card */
              <div className="flex flex-col items-center gap-4 p-8 rounded-3xl fail-pulse"
                style={{ background: 'linear-gradient(135deg, #3f0b0b, #7f1d1d)', border: '1px solid rgba(244,63,94,0.3)', boxShadow: '0 8px 32px rgba(244,63,94,0.25)' }}>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 180 }}>
                  <XCircle size={60} className="text-rose-400" />
                </motion.div>
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-black text-white">
                    {reasonMessages[result.reason]?.title ?? 'Verification Failed'}
                  </h3>
                  <p className="text-sm text-rose-200/80 leading-relaxed">
                    {reasonMessages[result.reason]?.detail}
                  </p>
                  <div className="mt-3 p-3 rounded-xl bg-black/30 text-left">
                    <p className="text-xs text-rose-300 font-semibold mb-1">💡 What to do:</p>
                    <p className="text-xs text-rose-200/70 leading-relaxed">
                      {reasonMessages[result.reason]?.advice}
                    </p>
                  </div>
                  {result.confidence > 0 && (
                    <p className="text-xs text-rose-400/70 mt-2">
                      Best score: {(result.confidence * 100).toFixed(1)}% (threshold: {(thresholds[selectedChannel!] * 100).toFixed(0)}%)
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={reset}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-300 font-semibold text-sm hover:bg-white/8 transition-colors">
                <RefreshCw size={15} /> Try Again
              </button>
              <button onClick={onBack}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-300 font-semibold text-sm hover:bg-white/8 transition-colors">
                ← Dashboard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── All Records View ─────────────────────────────────────────────────────────

function AllRecordsView({ cattle, onBack }: { cattle: Cattle[]; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = cattle.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase()) ||
    c.farmerId.toLowerCase().includes(search.toLowerCase()) ||
    c.farmerName.toLowerCase().includes(search.toLowerCase()) ||
    c.breed.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-black text-white text-lg">All Records</h2>
          <p className="text-xs text-slate-400">{cattle.length} cattle in database</p>
        </div>
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, ID, farmer, breed…" className="input-field pl-9" />
      </div>
      <div className="space-y-2">
        {filtered.map(c => (
          <div key={c.id} className="glass-card p-4 flex items-start gap-3 hover:border-white/15 transition-all">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1e3a2f, #065f46)' }}>🐄</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-white text-sm">{c.name}</p>
                <span className="text-xs text-slate-500">{c.breed}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${statusClass(c.status)}`}>{c.status}</span>
              </div>
              <p className="text-xs font-mono text-slate-500 truncate mt-0.5">{c.id}</p>
              <p className="text-xs text-slate-500">{c.farmerName} · {c.village}</p>
              <div className="flex gap-1 mt-1.5">
                {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => (
                  <span key={ch} className={`text-xs px-1.5 py-0.5 rounded font-medium border ${c.biometricStatus[ch] ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-600 border-slate-700'}`}>
                    {ch === 'muzzle' ? '🐽' : ch === 'retina' ? '👁' : '🐄'} {ch}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="glass-card p-8 text-center text-slate-500 text-sm">No records found</div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Ledger View ────────────────────────────────────────────────────────

function AuditLedgerView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLedgerEntries().then(e => { setEntries(e); setLoading(false); });
  }, []);

  const colors: Record<string, string> = {
    REGISTERED:       'bg-emerald-500/15 border-emerald-500/25 text-emerald-400',
    HEALTH_UPDATED:   'bg-violet-500/15 border-violet-500/25 text-violet-400',
    VERIFIED:         'bg-blue-500/15 border-blue-500/25 text-blue-400',
    INSURANCE_UPDATED:'bg-sky-500/15 border-sky-500/25 text-sky-400',
    LOAN_UPDATED:     'bg-amber-500/15 border-amber-500/25 text-amber-400',
  };
  const icons: Record<string, string> = {
    REGISTERED: '➕', HEALTH_UPDATED: '❤️', VERIFIED: '✅', INSURANCE_UPDATED: '🛡', LOAN_UPDATED: '🏦',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-black text-white text-lg">Audit Ledger</h2>
          <p className="text-xs text-slate-400">{entries.length} entries · Immutable log</p>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-emerald-400" /></div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg">{icons[e.action] ?? '📌'}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${colors[e.action] ?? 'bg-slate-500/15 border-slate-500/25 text-slate-400'}`}>
                  {e.action.replace(/_/g, ' ')}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${e.status === 'Completed' ? 'text-emerald-400' : e.status === 'Failed' ? 'text-red-400' : 'text-amber-400'}`}>
                  {e.status}
                </span>
              </div>
              {e.details && <p className="text-xs text-slate-400 leading-relaxed">{e.details}</p>}
              <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                <span className="font-mono truncate max-w-[120px]">{e.cattleId}</span>
                <span>·</span>
                <span>{e.performedBy}</span>
                <span>·</span>
                <span>{fmt(e.timestamp)}</span>
              </div>
            </motion.div>
          ))}
          {entries.length === 0 && (
            <div className="glass-card p-8 text-center text-slate-500 text-sm">No ledger entries yet</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Agent Config View ────────────────────────────────────────────────────────

function AgentConfigView({ onBack }: { onBack: () => void }) {
  const { settings, update } = useSettings();

  const SliderCard = ({ id, label, sub, val, onChange }: {
    id: string; label: string; sub: string; val: number; onChange: (v: number) => void
  }) => {
    const pct = ((val - 0.5) / 0.49) * 100;
    const risk = val < 0.65 ? 'Lenient · Higher FAR' : val < 0.80 ? 'Balanced' : 'Strict · Lower FAR';
    const riskColor = val < 0.65 ? 'text-red-400' : val < 0.80 ? 'text-amber-400' : 'text-emerald-400';
    return (
      <div className="glass-card p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold text-white text-sm">{label}</p>
            <p className="text-xs text-slate-500">{sub}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-emerald-400">{(val * 100).toFixed(0)}%</p>
            <p className={`text-xs font-bold ${riskColor}`}>{risk}</p>
          </div>
        </div>
        <input id={id} type="range" min={0.5} max={0.99} step={0.01} value={val}
          onChange={e => onChange(parseFloat(e.target.value))} className="w-full"
          style={{ background: `linear-gradient(to right, #059669 0%, #34D399 ${pct}%, #1e293b ${pct}%)` }} />
        <div className="flex justify-between text-xs text-slate-600">
          <span>50% Lenient</span><span>99% Strict</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="font-black text-white text-lg">Agent Config</h2>
          <p className="text-xs text-slate-400">Biometric sensitivity settings</p>
        </div>
      </div>

      <div className="flex items-start gap-3 p-3 rounded-2xl bg-amber-950/50 border border-amber-500/25">
        <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300 leading-relaxed">
          Lowering thresholds increases False Acceptance Rate (fraud risk). Raise for strict field conditions.
          Default is ~72% which works well with MobileNet embeddings.
        </p>
      </div>

      <SliderCard id="slider-muzzle" label="🐽 Muzzle Threshold" sub="Primary biometric channel"
        val={settings.muzzleThreshold} onChange={v => update({ muzzleThreshold: v })} />
      <SliderCard id="slider-retina" label="👁 Retina Threshold" sub="Secondary biometric channel"
        val={settings.retinaThreshold} onChange={v => update({ retinaThreshold: v })} />
      <SliderCard id="slider-face" label="🐄 Face ID Threshold" sub="Tertiary biometric channel"
        val={settings.faceThreshold} onChange={v => update({ faceThreshold: v })} />

      <div className="glass-card p-4 flex items-center justify-between">
        <div>
          <p className="font-bold text-white text-sm">Liveness Detection</p>
          <p className="text-xs text-slate-500">Anti-spoofing frame motion check</p>
        </div>
        <button id="toggle-liveness" onClick={() => update({ livenessEnabled: !settings.livenessEnabled })}
          className={`relative w-14 h-7 rounded-full transition-colors ${settings.livenessEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
          <motion.div className="absolute top-1 w-5 h-5 rounded-full bg-white shadow"
            animate={{ left: settings.livenessEnabled ? '2rem' : '0.25rem' }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
        </button>
      </div>

      <div className="glass-card p-4">
        <label className="text-xs text-slate-400 mb-1.5 block">Agent ID</label>
        <input value={settings.agentId} onChange={e => update({ agentId: e.target.value })}
          className="input-field font-mono" placeholder="AGENT-001" />
      </div>

      <button onClick={() => update(DEFAULT_SETTINGS)}
        className="w-full py-3 rounded-2xl border border-slate-700 text-slate-400 text-sm flex items-center justify-center gap-2 hover:border-red-500/40 hover:text-red-400 transition-colors">
        <RefreshCw size={14} /> Reset to Defaults
      </button>
    </div>
  );
}

// ─── Agent App ────────────────────────────────────────────────────────────────

function AgentApp({ agentId, onLogout }: { agentId: string; onLogout: () => void }) {
  const [view, setView]   = useState<AgentView>('dashboard');
  const [cattle, setCattle] = useState<Cattle[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const { toasts, add: addToast, remove } = useToast();

  const refresh = useCallback(async () => {
    const all = await getAllCattle();
    setCattle(all);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!isOnline()) { setSyncStatus('offline'); return; }
    setSyncStatus('syncing');
    Promise.all([pullAllFromCloud()])
      .then(() => { setSyncStatus('synced'); refresh(); })
      .catch(() => setSyncStatus('error'));

    // Subscribe to real-time updates
    const unsub = subscribeToCattleChanges((newCattle) => {
      setCattle(prev => {
        const exists = prev.find(c => c.id === newCattle.id);
        return exists ? prev.map(c => c.id === newCattle.id ? newCattle : c) : [...prev, newCattle];
      });
    });
    return () => unsub();
  }, [refresh]);

  const agentNav = [
    { v: 'dashboard' as AgentView, icon: Home,        label: 'Home' },
    { v: 'register'  as AgentView, icon: Plus,        label: 'Register' },
    { v: 'verify'    as AgentView, icon: ShieldCheck, label: 'Verify' },
    { v: 'records'   as AgentView, icon: Database,    label: 'Records' },
    { v: 'config'    as AgentView, icon: Settings,    label: 'Config' },
  ];

  return (
    <div className="min-h-dvh" style={{ background: 'linear-gradient(160deg, #020817 0%, #1a0a05 100%)' }}>
      <Toast toasts={toasts} remove={remove} />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/6"
        style={{ background: 'rgba(2,8,23,0.9)', backdropFilter: 'blur(20px)' }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <CowLogo3D size={32} animated />
            <div>
              <p className="text-sm font-black text-white leading-none">किसान-दृष्टि</p>
              <p className="text-xs text-orange-400">Agent Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncBadge status={syncStatus} />
            <button onClick={() => {
              setSyncStatus('syncing');
              pushAllLocalToCloud().then(() => { setSyncStatus('synced'); addToast('Synced to cloud ✓', 'success'); })
                .catch(() => { setSyncStatus('error'); addToast('Sync failed. Check connection.', 'error'); });
            }} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" title="Force sync">
              <RefreshCw size={14} className="text-slate-400" />
            </button>
            <button onClick={onLogout} className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded-lg bg-white/5">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-2xl px-4 py-5 safe-bottom">
        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {view === 'dashboard' && (
              <AgentDashboard cattle={cattle} agentId={agentId} onNavigate={setView} />
            )}
            {view === 'register' && (
              <RegisterCattleView
                onSuccess={newCattle => {
                  setCattle(p => [newCattle, ...p]);
                  addToast(`✓ ${newCattle.name} registered & synced to Firebase`, 'success');
                  setView('dashboard');
                }}
                onBack={() => setView('dashboard')}
              />
            )}
            {view === 'verify' && (
              <VerifyCattleView cattle={cattle} onBack={() => setView('dashboard')} />
            )}
            {view === 'records' && (
              <AllRecordsView cattle={cattle} onBack={() => setView('dashboard')} />
            )}
            {view === 'ledger' && (
              <AuditLedgerView onBack={() => setView('dashboard')} />
            )}
            {view === 'config' && (
              <AgentConfigView onBack={() => setView('dashboard')} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        <div className="mx-auto max-w-2xl flex items-stretch h-16">
          {agentNav.map(({ v, icon: Icon, label }) => {
            const active = view === v;
            return (
              <button key={v} onClick={() => setView(v)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all relative ${active ? 'text-orange-400' : 'text-slate-500 hover:text-slate-300'}`}>
                {active && <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-orange-400 rounded-full" />}
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[10px] font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [role, setRole]     = useState<AppRole>(null);
  const [farmerId, setFarmerId]   = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [modalError, setModalError] = useState<{ title: string; message: string } | null>(null);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    // Load settings from localStorage
    try {
      const saved = localStorage.getItem('kd-settings');
      if (saved) setSettings(JSON.parse(saved));
    } catch { /* ignore */ }

    // Initialize Firebase
    initFirebase().then(async () => {
      try {
        await seedDemoData();
      } catch { /* ignore */ }
      setInitialized(true);
    }).catch(err => {
      console.warn('Firebase init error:', err);
      setInitialized(true);
    });
  }, []);

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem('kd-settings', JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [settings]);

  const handleSelectRole = useCallback(async (r: AppRole, fid?: string) => {
    if (r === 'farmer' && fid) {
      try {
        const all = await getAllCattle();
        const farmerCattle = all.filter(c => c.farmerId === fid);
        if (farmerCattle.length > 0) {
          setFarmerName(farmerCattle[0].farmerName);
        } else {
          // Try pulling from cloud
          await pullAllFromCloud();
          const refreshed = await getAllCattle();
          const fc = refreshed.filter(c => c.farmerId === fid);
          if (fc.length > 0) {
            setFarmerName(fc[0].farmerName);
          } else {
            setFarmerName(`Farmer ${fid}`);
          }
        }
        setFarmerId(fid);
      } catch {
        setFarmerName(`Farmer ${fid}`);
        setFarmerId(fid);
      }
    }
    setRole(r);
  }, []);

  const handleLogout = useCallback(() => {
    setRole(null);
    setFarmerId('');
    setFarmerName('');
  }, []);

  if (!initialized) {
    return (
      <div className="min-h-dvh flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #020817, #0a1628, #0d0a1e)' }}>
        <div className="text-center space-y-4">
          <CowLogo3D size={80} animated />
          <Loader2 size={28} className="animate-spin text-emerald-400 mx-auto" />
          <p className="text-slate-400 text-sm">Initializing Kisan-Drishti…</p>
        </div>
      </div>
    );
  }

  return (
    <SettingsContext.Provider value={{ settings, update: updateSettings }}>
      <AnimatePresence mode="wait">
        {modalError && (
          <ErrorModal key="error-modal"
            title={modalError.title}
            message={modalError.message}
            onClose={() => setModalError(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!role && (
          <motion.div key="landing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <RoleLanding onSelectRole={handleSelectRole} />
          </motion.div>
        )}
        {role === 'agent' && (
          <motion.div key="agent"
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.3 }}>
            <AgentApp agentId={settings.agentId} onLogout={handleLogout} />
          </motion.div>
        )}
        {role === 'farmer' && (
          <motion.div key="farmer"
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.3 }}>
            <FarmerApp farmerId={farmerId} farmerName={farmerName} onLogout={handleLogout} />
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsContext.Provider>
  );
}
