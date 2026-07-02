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
  ChevronDown, Bell, CreditCard, Cloud, CloudOff, CloudCog,
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
import { loadModel, isModelLoaded, extractVector, cosineSimilarity, checkLiveness, getFrameQuality } from './ai';
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
  muzzleThreshold: 0.82,
  retinaThreshold: 0.80,
  faceThreshold: 0.78,
  livenessEnabled: true,
  agentId: 'AGENT-001',
};

// ─── Cloud Sync Status Badge ──────────────────────────────────────────────────

function SyncBadge({ status }: { status: SyncStatus }) {
  const cfg: Record<SyncStatus, { icon: React.ElementType; label: string; cls: string }> = {
    idle:    { icon: Cloud,    label: 'Cloud',    cls: 'text-slate-500 border-slate-700' },
    syncing: { icon: CloudCog, label: 'Syncing…', cls: 'text-amber-400 border-amber-500/40 animate-pulse' },
    synced:  { icon: Cloud,    label: 'Synced',   cls: 'text-emerald-400 border-emerald-500/40' },
    offline: { icon: CloudOff, label: 'Offline',  cls: 'text-slate-500 border-slate-700' },
    error:   { icon: CloudOff, label: 'Sync err', cls: 'text-red-400 border-red-500/40' },
  };
  const { icon: Icon, label, cls } = cfg[status];
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      <Icon size={11} />{label}
    </div>
  );
}

const SettingsContext = createContext<{ settings: AppSettings; update: (p: Partial<AppSettings>) => void }>({
  settings: DEFAULT_SETTINGS, update: () => {},
});
const useSettings = () => useContext(SettingsContext);

// ─── App Types ────────────────────────────────────────────────────────────────

type AppRole = 'farmer' | 'agent' | null;
type FarmerView = 'dashboard' | 'cattle' | 'detail' | 'services' | 'insurance' | 'loan' | 'vet' | 'schemes' | 'profile';
type AgentView  = 'dashboard' | 'register' | 'verify' | 'records' | 'ledger' | 'config';

// ─── Utilities ────────────────────────────────────────────────────────────────

const fmt = (ts: number) => new Date(ts).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

function healthClass(s: HealthStatus) {
  if (s === 'Excellent') return 'health-excellent';
  if (s === 'Good') return 'health-good';
  if (s === 'Needs Attention') return 'health-attention';
  return 'health-critical';
}

// ─── CSV/PDF Export ───────────────────────────────────────────────────────────

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
  doc.setFillColor(10, 15, 30); doc.rect(0, 0, W, 40, 'F');
  doc.setTextColor(52, 211, 153); doc.setFontSize(20); doc.text('Kisan-Drishti', 14, 16);
  doc.setTextColor(200, 200, 200); doc.setFontSize(10); doc.text('किसान-दृष्टि · Livestock Health Report', 14, 24);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 14, 32);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12); doc.text('Cattle Information', 14, 52);
  doc.setFontSize(9);
  [[`ID: ${c.id}`, `Tag: ${c.tagNumber}`],[`Name: ${c.name}`,`Breed: ${c.breed}`],
   [`Age: ${c.age}yr`,`Weight: ${c.weight}kg`],[`Farmer: ${c.farmerName}`,`Phone: ${c.farmerPhone}`],
   [`Village: ${c.village}, ${c.district}`,`State: ${c.state}`],
  ].forEach(([a,b], i) => { doc.text(a, 14, 62 + i * 7); doc.text(b, W/2, 62 + i * 7); });
  let y = 102;
  doc.setFillColor(10, 15, 30); doc.rect(14, y-5, W-28, 8, 'F');
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

// ─── Cattle Logo SVG ──────────────────────────────────────────────────────────

function CattleLogo({ size = 64, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {animated && (
        <motion.circle cx="60" cy="60" r="55" stroke="url(#scanGrad)" strokeWidth="2" strokeDasharray="12 6"
          strokeLinecap="round" animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '60px 60px' }} />
      )}
      {/* Head */}
      <ellipse cx="60" cy="62" rx="32" ry="28" fill="url(#headGrad)" />
      {/* Ears */}
      <ellipse cx="30" cy="46" rx="10" ry="14" fill="url(#earGrad)" transform="rotate(-15 30 46)" />
      <ellipse cx="90" cy="46" rx="10" ry="14" fill="url(#earGrad)" transform="rotate(15 90 46)" />
      <ellipse cx="30" cy="46" rx="6" ry="9" fill="#F9A8D4" transform="rotate(-15 30 46)" />
      <ellipse cx="90" cy="46" rx="6" ry="9" fill="#F9A8D4" transform="rotate(15 90 46)" />
      {/* Horns */}
      <path d="M38 36 Q28 18 22 14" stroke="#D97706" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M82 36 Q92 18 98 14" stroke="#D97706" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Eyes */}
      <circle cx="46" cy="56" r="8" fill="#1E293B" />
      <circle cx="74" cy="56" r="8" fill="#1E293B" />
      <circle cx="46" cy="56" r="5" fill="url(#eyeGrad)" />
      <circle cx="74" cy="56" r="5" fill="url(#eyeGrad)" />
      <circle cx="48" cy="54" r="2" fill="white" opacity="0.8" />
      <circle cx="76" cy="54" r="2" fill="white" opacity="0.8" />
      {/* Muzzle */}
      <ellipse cx="60" cy="76" rx="18" ry="12" fill="#F3D5B5" />
      <circle cx="54" cy="76" r="4" fill="#C8A882" />
      <circle cx="66" cy="76" r="4" fill="#C8A882" />
      {/* Scan dots on muzzle */}
      <circle cx="54" cy="76" r="1.5" fill="#10B981" opacity="0.8" />
      <circle cx="66" cy="76" r="1.5" fill="#10B981" opacity="0.8" />
      {/* Scan ring on eye */}
      <circle cx="74" cy="56" r="10" stroke="#34D399" strokeWidth="1.5" strokeDasharray="3 3" fill="none" opacity="0.6" />
      <defs>
        <linearGradient id="headGrad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#8B5A2B" /><stop offset="1" stopColor="#6B3F15" />
        </linearGradient>
        <linearGradient id="earGrad" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#9B6B3A" /><stop offset="1" stopColor="#7A4F22" />
        </linearGradient>
        <radialGradient id="eyeGrad" cx="50%" cy="50%" r="50%">
          <stop stopColor="#7C3AED" /><stop offset="1" stopColor="#4C1D95" />
        </radialGradient>
        <linearGradient id="scanGrad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#10B981" /><stop offset="0.5" stopColor="#7C3AED" /><stop offset="1" stopColor="#F97316" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GuestBadge() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
      <Shield size={12} /> Guest mode
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

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastMsg { id: string; message: string; type: 'success' | 'error' | 'info' }
function Toast({ toasts, remove }: { toasts: ToastMsg[]; remove: (id: string) => void }) {
  return (
    <div className="fixed top-4 left-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} initial={{ opacity: 0, y: -20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }} className={`pointer-events-auto flex items-center gap-3 p-3 rounded-2xl backdrop-blur-xl border shadow-2xl ${
              t.type === 'success' ? 'bg-emerald-900/80 border-emerald-500/40 text-emerald-200' :
              t.type === 'error'   ? 'bg-red-900/80 border-red-500/40 text-red-200' :
              'bg-slate-900/80 border-slate-500/40 text-slate-200'
            }`}>
            {t.type === 'success' ? <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" /> :
             t.type === 'error'   ? <XCircle size={16} className="text-red-400 flex-shrink-0" /> :
             <Info size={16} className="text-slate-400 flex-shrink-0" />}
            <p className="text-sm font-medium flex-1">{t.message}</p>
            <button onClick={() => remove(t.id)} className="ml-1 opacity-60 hover:opacity-100"><X size={14} /></button>
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
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);
  const remove = useCallback((id: string) => setToasts(p => p.filter(t => t.id !== id)), []);
  return { toasts, add, remove };
}

// ─── Scanner Component ────────────────────────────────────────────────────────

const CHANNEL_META: Record<BiometricChannel, { label: string; hint: string; icon: React.ElementType; color: string; gradient: string; overlay: string }> = {
  muzzle: { label: 'Muzzle Scan', hint: 'Position the nose/muzzle close to camera. The unique ridge pattern is the fingerprint.', icon: Scan, color: 'text-emerald-400', gradient: 'from-emerald-600 to-teal-500', overlay: '🐽' },
  retina: { label: 'Retina Scan', hint: 'Hold camera level with the animal\'s eye. Keep steady for 2 seconds.', icon: Eye, color: 'text-violet-400', gradient: 'from-violet-600 to-purple-500', overlay: '👁' },
  face:   { label: 'Face ID', hint: 'Hold camera 1–2 feet from face. Capture full facial geometry.', icon: UserCircle, color: 'text-saffron-400', gradient: 'from-orange-600 to-amber-500', overlay: '🐄' },
};

type ScanStage = 'starting' | 'positioning' | 'liveness' | 'extracting' | 'done' | 'error';

interface ScannerProps {
  channel: BiometricChannel;
  onComplete: (vec: number[], ch: BiometricChannel) => void;
  onError: (msg: string) => void;
}

function Scanner({ channel, onComplete, onError }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stage, setStage] = useState<ScanStage>('starting');
  const [quality, setQuality] = useState(0);
  const [hist, setHist] = useState<number[]>(Array(24).fill(0));
  const [errMsg, setErrMsg] = useState('');
  const [photoMode, setPhotoMode] = useState(false);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const meta = CHANNEL_META[channel];

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const frameReady = () => photoMode ? imageRef.current : videoRef.current;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!photoMode && !window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
          throw new Error('Camera requires HTTPS or localhost. Open the app on https:// or use localhost/127.0.0.1.');
        }

        if (photoMode) {
          setStage('positioning');
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API is not available in this browser. Try a modern mobile or desktop browser.');
        }

        const attempts: MediaStreamConstraints[] = [
          { video: { width: 640, height: 480, facingMode: { ideal: 'environment' } } },
          { video: { width: 640, height: 480, facingMode: { ideal: 'user' } } },
          { video: true },
        ];

        let stream: MediaStream | null = null;
        let lastErr: unknown = null;
        for (const constraints of attempts) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (err) {
            lastErr = err;
          }
        }

        if (!stream) {
          throw lastErr instanceof Error ? lastErr : new Error('Unable to access camera. Check browser permissions and device camera availability.');
        }

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
          if (videoRef.current) {
            const q = await getFrameQuality(videoRef.current);
            if (alive) { setQuality(q); setHist(p => [...p.slice(1), q]); }
          }
        }, 150);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Camera denied. Enable camera permission.';
        if (alive) { setErrMsg(message); setStage('error'); onError(message); }
      }
    })();
    return () => {
      alive = false;
      stopCamera();
    };
  }, [onError, photoMode, stopCamera]);

  const capture = async () => {
    const frame = frameReady();
    if (!frame || stage !== 'positioning') return;
    if (photoMode && imageRef.current && !imageRef.current.complete) {
      onError('Please wait for the photo to finish loading.');
      return;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    try {
      setStage('liveness');
      const live = await checkLiveness(frame as HTMLVideoElement | HTMLImageElement | HTMLCanvasElement);
      if (!live) { setStage('positioning'); onError('Liveness check failed — please move slightly.'); return; }
      setStage('extracting');
      const vec = await extractVector(frame as HTMLVideoElement | HTMLImageElement | HTMLCanvasElement);
      stopCamera();
      if (photoSrc) URL.revokeObjectURL(photoSrc);
      setStage('done');
      onComplete(vec, channel);
    } catch (e) {
      setErrMsg((e as Error).message);
      setStage('error');
      onError((e as Error).message);
    }
  };

  const stageLabel: Record<ScanStage, string> = {
    starting: 'Starting camera…',
    positioning: 'Ready · Tap to Capture',
    liveness: 'Liveness check…',
    extracting: 'Extracting biometric…',
    done: 'Complete ✓',
    error: errMsg,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Channel header */}
      <div className={`flex items-center gap-2 p-3 rounded-2xl glass-card`}>
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center`}>
          <meta.icon size={18} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-white text-sm">{meta.label}</p>
          <p className="text-xs text-slate-400 leading-snug">{meta.hint}</p>
        </div>
      </div>

      {/* Viewfinder */}
      <div className="relative rounded-2xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {photoMode ? (
          <img
            ref={imageRef}
            src={photoSrc ?? ''}
            alt="Selected scan preview"
            className="absolute inset-[2px] z-10 rounded-xl w-[calc(100%-4px)] h-[calc(100%-4px)] object-cover bg-black"
            onLoad={() => {
              setQuality(1);
              setHist(p => [...p.slice(1), 1]);
            }}
          />
        ) : (
          <video ref={videoRef} className="absolute inset-[2px] z-10 rounded-xl w-[calc(100%-4px)] h-[calc(100%-4px)] object-cover bg-black" playsInline muted autoPlay />
        )}

        {/* Animated gradient border ring */}
        <div className="absolute inset-0 rounded-2xl" style={{
          background: 'conic-gradient(from 0deg, #10B981, #7C3AED, #F97316, #10B981)',
          padding: '2px', animation: 'scannerBorder 3s linear infinite',
        }}>
          <div className="w-full h-full rounded-xl bg-black" />
        </div>

        {/* Biometric overlay hint */}
        <div className="absolute top-3 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <div className="text-3xl">{meta.overlay}</div>
        </div>

        {/* Corner brackets */}
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="relative w-44 h-44">
            {[['top-0 left-0 border-r-0 border-b-0 rounded-tl-xl','tl'],
              ['top-0 right-0 border-l-0 border-b-0 rounded-tr-xl','tr'],
              ['bottom-0 left-0 border-r-0 border-t-0 rounded-bl-xl','bl'],
              ['bottom-0 right-0 border-l-0 border-t-0 rounded-br-xl','br']].map(([cls]) => (
              <div key={cls} className={`absolute w-7 h-7 border-2 border-emerald-400 ${cls}`} />
            ))}
            {/* Channel-specific targeting overlay */}
            {channel === 'muzzle' && (
              <div className="absolute inset-0 flex items-center justify-end pr-4">
                <div className="w-20 h-12 border-2 border-emerald-400/50 rounded-full opacity-60" />
              </div>
            )}
            {channel === 'retina' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-10 border-2 border-violet-400/60 rounded-full" />
                <div className="absolute w-6 h-6 border border-violet-400/40 rounded-full" />
              </div>
            )}
            {channel === 'face' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-28 h-32 border-2 border-orange-400/50 rounded-3xl" />
              </div>
            )}
            {/* Laser */}
            {(stage === 'positioning' || stage === 'extracting' || stage === 'liveness') && (
              <div className="laser-line" />
            )}
          </div>
        </div>

        {/* Stage badge */}
        <div className="absolute bottom-3 left-0 right-0 z-20 flex justify-center">
          <div className="bg-black/70 backdrop-blur-sm rounded-full px-4 py-1.5 flex items-center gap-2">
            {(stage === 'starting' || stage === 'liveness' || stage === 'extracting') &&
              <Loader2 size={12} className="animate-spin text-emerald-400" />}
            <span className="text-xs text-white font-medium">{stageLabel[stage]}</span>
          </div>
        </div>
      </div>

      {/* Real-time confidence histogram */}
      <div className="glass-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1"><BarChart3 size={12} /> Signal Quality</span>
          <span className="text-xs font-bold text-emerald-400">{Math.round(quality * 100)}%</span>
        </div>
        <div className="flex items-end gap-0.5 h-10 mb-2">
          {hist.map((v, i) => (
            <motion.div key={i} className="flex-1 rounded-sm min-h-[3px]"
              style={{ background: `linear-gradient(to top, #059669, #34D399)`, opacity: 0.25 + (i / hist.length) * 0.75 }}
              animate={{ height: `${Math.max(5, v * 100)}%` }} transition={{ duration: 0.1 }} />
          ))}
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
            animate={{ width: `${quality * 100}%` }} transition={{ duration: 0.2 }} />
        </div>
      </div>

      {stage === 'positioning' && (
        <div className="space-y-3">
          <motion.button id={`btn-capture-${channel}`} onClick={capture} whileTap={{ scale: 0.97 }}
            className={`btn-${channel === 'muzzle' ? 'emerald' : channel === 'retina' ? 'violet' : 'saffron'} flex items-center justify-center gap-2 text-base`}>
            <Camera size={20} /> {photoMode ? `Use ${meta.label} Photo` : `Capture ${meta.label}`}
          </motion.button>
          {!photoMode && (
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const url = URL.createObjectURL(file);
                  setPhotoSrc(prev => {
                    if (prev) URL.revokeObjectURL(prev);
                    return url;
                  });
                  setPhotoMode(true);
                  setStage('positioning');
                }}
              />
              <Camera size={16} /> Upload or capture photo instead
            </label>
          )}
        </div>
      )}

      {stage === 'error' && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-3">
          <p className="font-semibold">Live camera is unavailable here.</p>
          <p className="text-xs leading-5 text-amber-50/80">Use the photo fallback below, or open the app on HTTPS / localhost with camera permission enabled.</p>
          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                setPhotoSrc(prev => {
                  if (prev) URL.revokeObjectURL(prev);
                  return url;
                });
                setPhotoMode(true);
                setErrMsg('');
                setStage('positioning');
              }}
            />
            <Camera size={16} /> Use photo fallback
          </label>
        </div>
      )}
    </div>
  );
}

// ─── Role Landing Screen ──────────────────────────────────────────────────────

interface RoleLandingProps {
  onSelectRole: (role: AppRole, farmerId?: string) => void;
}

function RoleLanding({ onSelectRole }: RoleLandingProps) {
  const [showFarmerLogin, setShowFarmerLogin] = useState(false);
  const [farmerId, setFarmerId] = useState('');
  const [err, setErr] = useState('');
  const [modelLoaded, setModelLoaded] = useState(isModelLoaded());

  useEffect(() => {
    loadModel().then(() => setModelLoaded(true)).catch(console.error);
  }, []);

  const handleFarmerLogin = async () => {
    if (!farmerId.trim()) { setErr('Enter your Farmer ID'); return; }
    onSelectRole('farmer', farmerId.trim().toUpperCase());
  };

  return (
    <div className="min-h-dvh relative overflow-hidden px-4 py-6 sm:px-6 lg:px-10"
      style={{ background: 'linear-gradient(135deg, #0A0F1E 0%, #0D1B2A 50%, #1A0A2E 100%)' }}>
      <FloatingOrbs />

      <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-7xl flex-col gap-6 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="space-y-6 rounded-[32px] border border-white/8 bg-white/5 p-6 backdrop-blur-2xl sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/50 px-3 py-1 text-xs text-slate-300 backdrop-blur-xl">
              <div className={`h-2 w-2 rounded-full ${modelLoaded ? 'bg-emerald-400' : 'bg-amber-400'} pulse-glow`} />
              {modelLoaded ? 'AI ready' : 'Loading AI…'}
            </div>
            <GuestBadge />
          </div>

          <div className="grid gap-6 lg:grid-cols-[auto,1fr] lg:items-center">
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} className="mx-auto lg:mx-0">
              <CattleLogo size={112} animated />
            </motion.div>
            <div className="space-y-4 text-center lg:text-left">
              <div>
                <h1 className="text-4xl font-black font-devanagari gradient-text-emerald leading-tight sm:text-5xl">किसान-दृष्टि</h1>
                <p className="mt-2 text-xl font-bold text-white/90 tracking-tight">Kisan-Drishti</p>
                <p className="mt-2 max-w-xl text-sm text-slate-300 sm:text-base">Livestock biometric identity platform with a cleaner shell, clearer hierarchy, and a test-friendly guest entry.</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                {[{ icon: Shield, label: 'Tamper-Proof' }, { icon: Cpu, label: 'Edge AI' }, { icon: WifiOff, label: 'Offline-First' }].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300">
                    <Icon size={10} className="text-emerald-400" /> {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-slate-950/75 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-7">
          <AnimatePresence mode="wait">
            {!showFarmerLogin ? (
              <motion.div key="roles" className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.button id="btn-role-farmer" onClick={() => setShowFarmerLogin(true)} whileTap={{ scale: 0.97 }}
                  className="w-full rounded-[28px] border border-emerald-500/20 bg-emerald-500/10 p-5 text-left transition-all hover:border-emerald-400/50">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-900 to-emerald-600">
                      <Leaf size={26} className="text-emerald-200" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-black text-white">किसान</p>
                        <p className="text-lg font-bold text-emerald-300">Farmer</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Cattle health, insurance, loans & services</p>
                    </div>
                    <ChevronRight size={20} className="text-emerald-300" />
                  </div>
                </motion.button>

                <motion.button id="btn-role-agent" onClick={() => onSelectRole('agent')} whileTap={{ scale: 0.97 }}
                  className="w-full rounded-[28px] border border-orange-500/20 bg-orange-500/10 p-5 text-left transition-all hover:border-orange-400/50">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-900 to-orange-600">
                      <ShieldCheck size={26} className="text-orange-200" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-black text-white">अभिकर्ता</p>
                        <p className="text-lg font-bold text-orange-300">Agent</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">Register cattle · biometric verification</p>
                    </div>
                    <ChevronRight size={20} className="text-orange-300" />
                  </div>
                </motion.button>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <p className="text-sm font-bold text-white">Designed to breathe</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">Cards, headers, and navigation now have room to sit apart instead of colliding.</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <p className="text-sm font-bold text-white">Demo-ready</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">Use guest mode for testing, or sign in with a real account.</p>
                  </div>
                </div>

                <p className="pt-1 text-center text-xs text-slate-500">Triple biometric · Muzzle · Retina · Face ID</p>
              </motion.div>
            ) : (
              <motion.div key="farmer-login" className="space-y-4" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                <button onClick={() => setShowFarmerLogin(false)} className="flex items-center gap-1 text-sm text-slate-400">
                  <ArrowLeft size={14} /> Back
                </button>
                <div className="space-y-4 rounded-[28px] border border-white/8 bg-white/5 p-5">
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">Farmer Login</p>
                    <p className="mt-1 text-xs text-slate-400">Enter your Farmer ID to view your cattle</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Farmer ID</label>
                    <input id="inp-farmer-id" value={farmerId} onChange={e => setFarmerId(e.target.value)}
                      placeholder="e.g. F001" className="input-field text-center font-mono text-lg tracking-widest"
                      onKeyDown={e => e.key === 'Enter' && handleFarmerLogin()} />
                  </div>
                  {err && <p className="text-center text-xs text-red-400">{err}</p>}
                  <button className="btn-emerald" onClick={handleFarmerLogin}>Login →</button>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {['F001', 'F002', 'F003'].map(id => (
                      <button key={id} onClick={() => { setFarmerId(id); setErr(''); }}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all ${farmerId === id ? 'border-emerald-500/60 bg-emerald-600/20 text-emerald-300' : 'border-slate-700 text-slate-500 hover:border-slate-500'}`}>
                        {id} Demo
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// FARMER PORTAL VIEWS
// ════════════════════════════════════════════════════════════════════════════════

function FarmerDashboard({ cattle, farmerName, farmerId, onNavigate, onSelectCattle }:
  { cattle: Cattle[]; farmerName: string; farmerId: string; onNavigate: (v: FarmerView) => void; onSelectCattle: (c: Cattle) => void }) {
  const latestHealth = (c: Cattle) => c.healthMetrics[c.healthMetrics.length - 1];
  const alerts = cattle.filter(c => {
    const latest = latestHealth(c);
    return latest && (latest.healthStatus === 'Needs Attention' || latest.healthStatus === 'Critical');
  });
  const insExpiring = cattle.filter(c => c.insurance && (c.insurance.status === 'Expired' || c.insurance.status === 'Pending'));
  const loanOverdue = cattle.filter(c => c.loan && c.loan.status === 'Overdue');

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden p-5" style={{
        background: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)',
        boxShadow: '0 8px 32px rgba(16,185,129,0.3)',
      }}>
        <FloatingOrbs />
        <div className="relative z-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-emerald-300/80 text-xs font-medium">नमस्ते 🙏</p>
              <h2 className="text-2xl font-black text-white mt-0.5">{farmerName}</h2>
              <p className="text-emerald-400/70 text-xs font-mono mt-1">ID: {farmerId}</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
              <CattleLogo size={36} />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            {[{ val: cattle.length, label: 'Cattle', icon: '🐄' },
              { val: cattle.filter(c => c.insurance?.status === 'Active').length, label: 'Insured', icon: '🛡' },
              { val: cattle.filter(c => c.loan?.status === 'Active').length, label: 'Loans', icon: '🏦' },
            ].map(({ val, label, icon }) => (
              <div key={label} className="flex-1 bg-white/10 rounded-2xl p-3 text-center">
                <p className="text-xl">{icon}</p>
                <p className="text-xl font-black text-white">{val}</p>
                <p className="text-xs text-emerald-200/70">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(alerts.length > 0 || insExpiring.length > 0 || loanOverdue.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">⚠ Alerts</h3>
          {alerts.map(c => (
            <motion.button key={c.id} onClick={() => onSelectCattle(c)} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-red-900/20 border border-red-500/25 text-left">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300 flex-1">
                <strong>{c.name}</strong> needs health attention – {latestHealth(c)?.healthStatus}
              </p>
              <ChevronRight size={14} className="text-red-500" />
            </motion.button>
          ))}
          {insExpiring.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl bg-amber-900/20 border border-amber-500/25">
              <Shield size={16} className="text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-300 flex-1"><strong>{c.name}</strong> insurance {c.insurance?.status?.toLowerCase()}</p>
            </div>
          ))}
          {loanOverdue.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl bg-orange-900/20 border border-orange-500/25">
              <CreditCard size={16} className="text-orange-400 flex-shrink-0" />
              <p className="text-sm text-orange-300 flex-1"><strong>{c.name}</strong> loan EMI overdue</p>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Quick Access</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'My Cattle', sub: `${cattle.length} registered`, icon: '🐄', view: 'cattle' as FarmerView, grad: 'from-emerald-700 to-teal-600' },
            { label: 'Services', sub: 'Insurance · Loans · Vet', icon: '⚙️', view: 'services' as FarmerView, grad: 'from-violet-700 to-purple-600' },
            { label: 'Insurance', sub: `${cattle.filter(c => c.insurance?.status === 'Active').length} active policies`, icon: '🛡', view: 'insurance' as FarmerView, grad: 'from-blue-700 to-sky-600' },
            { label: 'Loan Status', sub: 'KCC & cattle loans', icon: '🏦', view: 'loan' as FarmerView, grad: 'from-amber-700 to-orange-600' },
          ].map(a => (
            <motion.button key={a.label} id={`btn-farmer-${a.label.toLowerCase().replace(/\s/g, '-')}`}
              onClick={() => onNavigate(a.view)} whileTap={{ scale: 0.96 }}
              className="p-4 rounded-2xl text-left glass-card border border-white/8">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${a.grad} flex items-center justify-center text-lg mb-2`}>{a.icon}</div>
              <p className="font-bold text-white text-sm">{a.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{a.sub}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Recent Cattle */}
      {cattle.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Recent Cattle</h3>
            <button onClick={() => onNavigate('cattle')} className="text-xs text-emerald-400">View All →</button>
          </div>
          {cattle.slice(0, 3).map(c => {
            const latest = latestHealth(c);
            return (
              <motion.button key={c.id} onClick={() => onSelectCattle(c)} whileTap={{ scale: 0.98 }}
                className="w-full flex items-center gap-3 p-3 mb-2 glass-card text-left hover:border-emerald-500/30 transition-all">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
                  🐄
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">{c.name} <span className="text-slate-500 font-normal">· {c.breed}</span></p>
                  <p className="text-xs text-slate-500 font-mono truncate">{c.id}</p>
                </div>
                {latest && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${healthClass(latest.healthStatus)}`}>
                    {latest.healthStatus}
                  </span>
                )}
                <ChevronRight size={14} className="text-slate-600" />
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MyCattleView({ cattle, onSelectCattle, onBack }:
  { cattle: Cattle[]; onSelectCattle: (c: Cattle) => void; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = cattle.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()) || c.breed.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">My Cattle</h2><p className="text-xs text-slate-400">{cattle.length} registered animals</p></div>
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, ID or breed…" className="input-field pl-9" />
      </div>
      <div className="space-y-2">
        {filtered.map(c => {
          const latest = c.healthMetrics[c.healthMetrics.length - 1];
          return (
            <motion.button key={c.id} onClick={() => onSelectCattle(c)} whileTap={{ scale: 0.98 }}
              className="w-full glass-card p-4 text-left flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>🐄</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-black text-white">{c.name}</p>
                  <span className="text-xs text-slate-500">{c.breed}</span>
                  {c.tagNumber && <span className="text-xs font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{c.tagNumber}</span>}
                </div>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{c.id}</p>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-xs text-slate-400">🎂 {c.age}yr</span>
                  <span className="text-xs text-slate-400">⚖️ {c.weight}kg</span>
                  <span className="text-xs text-slate-400">🎨 {c.color}</span>
                  {/* Biometric chips */}
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
                {c.loan?.status === 'Active' && <span className="text-xs text-amber-400">🏦 Loan</span>}
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
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h2 className="font-black text-white text-lg">{cattle.name}</h2>
          <p className="text-xs text-slate-400 font-mono">{cattle.id}</p>
        </div>
        {latest && <span className={`text-xs px-3 py-1 rounded-full border font-bold ${healthClass(latest.healthStatus)}`}>{latest.healthStatus}</span>}
      </div>

      {/* Hero card */}
      <div className="relative rounded-3xl overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #0c1a2e, #0d2b1e)' }}>
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
            {/* Latest metrics */}
            {latest && (
              <div className="grid grid-cols-3 gap-2">
                {[{ label: 'Fat %', val: latest.fatContent.toFixed(1), icon: Droplets, color: 'text-blue-400' },
                  { label: 'SNF %', val: latest.snf.toFixed(1), icon: Activity, color: 'text-violet-400' },
                  { label: 'Milk L', val: latest.milkYield.toString(), icon: Zap, color: 'text-emerald-400' },
                  { label: 'SCC (k)', val: latest.scc.toString(), icon: BarChart3, color: 'text-rose-400' },
                  { label: 'Temp °C', val: latest.temperature.toFixed(1), icon: Thermometer, color: 'text-amber-400' },
                  { label: 'Weight', val: `${latest.weight}kg`, icon: TrendingUp, color: 'text-teal-400' },
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
              {[['Farmer ID', cattle.farmerId], ['Name', cattle.farmerName], ['Phone', cattle.farmerPhone],
                ['Village', cattle.village], ['District', cattle.district], ['State', cattle.state],
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
            {/* Insurance */}
            {cattle.insurance ? (
              <div className="glass-card-violet p-4 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} className="text-violet-400" />
                  <p className="font-bold text-white text-sm">Insurance Policy</p>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-bold ${
                    cattle.insurance.status === 'Active' ? 'bg-emerald-500/20 text-emerald-400' :
                    cattle.insurance.status === 'Expired' ? 'bg-red-500/20 text-red-400' :
                    cattle.insurance.status === 'Claimed' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>{cattle.insurance.status}</span>
                </div>
                {[['Policy No.', cattle.insurance.policyNumber], ['Provider', cattle.insurance.provider],
                  ['Scheme', cattle.insurance.scheme], ['Sum Assured', inr(cattle.insurance.sumAssured)],
                  ['Premium', inr(cattle.insurance.premium) + '/year'], ['Valid Till', cattle.insurance.endDate],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-t border-white/5">
                    <span className="text-xs text-slate-400">{k}</span>
                    <span className="text-xs font-semibold text-white">{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-card p-4 text-center space-y-2">
                <Shield size={24} className="text-slate-600 mx-auto" />
                <p className="text-slate-400 text-sm">No insurance policy linked</p>
                <p className="text-xs text-slate-500">Contact your agent to enroll in PMFBY</p>
              </div>
            )}
            {/* Loan */}
            {cattle.loan ? (
              <div className="glass-card-saffron p-4 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Banknote size={16} className="text-orange-400" />
                  <p className="font-bold text-white text-sm">Loan Account</p>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-bold ${
                    cattle.loan.status === 'Active' ? 'bg-emerald-500/20 text-emerald-400' :
                    cattle.loan.status === 'Overdue' ? 'bg-red-500/20 text-red-400' :
                    cattle.loan.status === 'Closed' ? 'bg-slate-500/20 text-slate-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>{cattle.loan.status}</span>
                </div>
                {[['Loan ID', cattle.loan.loanId], ['Bank', cattle.loan.bank], ['Scheme', cattle.loan.scheme],
                  ['Principal', inr(cattle.loan.principal)], ['Outstanding', inr(cattle.loan.outstanding)],
                  ['EMI', inr(cattle.loan.emi) + '/month'], ['Interest', cattle.loan.interestRate + '% p.a.'],
                  ['Next Due', cattle.loan.nextDueDate],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-t border-white/5">
                    <span className="text-xs text-slate-400">{k}</span>
                    <span className={`text-xs font-semibold ${k === 'Outstanding' ? 'text-orange-400' : 'text-white'}`}>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-card p-4 text-center space-y-2">
                <Banknote size={24} className="text-slate-600 mx-auto" />
                <p className="text-slate-400 text-sm">No loan linked to this cattle</p>
                <p className="text-xs text-slate-500">Apply for Kisan Credit Card (KCC)</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ServicesHubView({ onNavigate, onBack }: { onNavigate: (v: FarmerView) => void; onBack: () => void }) {
  const services = [
    { id: 'insurance', icon: '🛡', label: 'Insurance', sub: 'PMFBY · Livestock Policy', color: 'from-violet-700 to-purple-600', view: 'insurance' as FarmerView },
    { id: 'loan', icon: '🏦', label: 'Loans & Credit', sub: 'KCC · Cattle Mortgage', color: 'from-amber-700 to-orange-600', view: 'loan' as FarmerView },
    { id: 'vet', icon: '🩺', label: 'Vet Booking', sub: 'Book doctor · Emergency', color: 'from-rose-700 to-pink-600', view: 'vet' as FarmerView },
    { id: 'schemes', icon: '📋', label: 'Govt. Schemes', sub: 'PM-Kisan · NABARD · Rashtriya Gokul', color: 'from-sky-700 to-cyan-600', view: 'schemes' as FarmerView },
    { id: 'market', icon: '📊', label: 'Milk Market Rate', sub: 'Today\'s dairy prices', color: 'from-teal-700 to-emerald-600', view: 'dashboard' as FarmerView },
    { id: 'profile', icon: '👤', label: 'My Profile', sub: 'Aadhaar · Land records', color: 'from-slate-700 to-slate-600', view: 'profile' as FarmerView },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">Services Hub</h2><p className="text-xs text-slate-400">All cattle-related services</p></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {services.map(s => (
          <motion.button key={s.id} id={`btn-service-${s.id}`} onClick={() => onNavigate(s.view)} whileTap={{ scale: 0.95 }}
            className="p-4 rounded-2xl glass-card text-left border border-white/8 hover:border-white/16 transition-all">
            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.color} flex items-center justify-center text-2xl mb-3 shadow-lg`}>{s.icon}</div>
            <p className="font-bold text-white text-sm">{s.label}</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-snug">{s.sub}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function InsuranceView({ cattle, onBack }: { cattle: Cattle[]; onBack: () => void }) {
  const insured = cattle.filter(c => c.insurance);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">🛡 Insurance</h2><p className="text-xs text-slate-400">{insured.length} policies</p></div>
      </div>
      <div className="glass-card-violet p-4 rounded-3xl">
        <p className="font-bold text-violet-300 mb-1">Pradhan Mantri Fasal Bima Yojana</p>
        <p className="text-xs text-slate-400">Livestock insurance under PMFBY covers up to ₹50,000 per cattle. Annual premium starting ₹500.</p>
        <button className="mt-3 text-xs font-bold text-violet-400 flex items-center gap-1">Learn More <ChevronRight size={12} /></button>
      </div>
      {insured.length === 0 && <p className="text-center text-slate-500 py-8">No insured cattle yet</p>}
      {insured.map(c => c.insurance && (
        <div key={c.id} className="glass-card p-4 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🐄</span>
            <div className="flex-1">
              <p className="font-bold text-white">{c.name} <span className="text-slate-400 font-normal text-sm">· {c.breed}</span></p>
              <p className="text-xs font-mono text-slate-500">{c.insurance!.policyNumber}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${
              c.insurance!.status === 'Active' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
              c.insurance!.status === 'Expired' ? 'bg-red-500/20 border-red-500/30 text-red-400' :
              c.insurance!.status === 'Claimed' ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' :
              'bg-amber-500/20 border-amber-500/30 text-amber-400'
            }`}>{c.insurance!.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
            <div><p className="text-xs text-slate-500">Sum Assured</p><p className="font-bold text-white text-sm">{inr(c.insurance!.sumAssured)}</p></div>
            <div><p className="text-xs text-slate-500">Premium</p><p className="font-bold text-emerald-400 text-sm">{inr(c.insurance!.premium)}/yr</p></div>
            <div><p className="text-xs text-slate-500">Valid Till</p><p className="font-semibold text-white text-sm">{c.insurance!.endDate}</p></div>
            <div><p className="text-xs text-slate-500">Provider</p><p className="font-semibold text-white text-xs leading-snug">{c.insurance!.provider.split(' ').slice(0, 3).join(' ')}</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LoanView({ cattle, onBack }: { cattle: Cattle[]; onBack: () => void }) {
  const withLoan = cattle.filter(c => c.loan);
  const total = withLoan.reduce((s, c) => s + (c.loan?.outstanding ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">🏦 Loans & Credit</h2><p className="text-xs text-slate-400">{withLoan.length} active loans</p></div>
      </div>
      {withLoan.length > 0 && (
        <div className="glass-card-saffron p-4 rounded-3xl">
          <p className="text-xs text-slate-400 mb-1">Total Outstanding</p>
          <p className="text-3xl font-black text-orange-400">{inr(total)}</p>
          <p className="text-xs text-slate-500 mt-1">Across {withLoan.length} cattle · KCC Scheme</p>
        </div>
      )}
      {withLoan.length === 0 && <p className="text-center text-slate-500 py-8">No active loans</p>}
      {withLoan.map(c => c.loan && (
        <div key={c.id} className={`glass-card p-4 space-y-2 ${c.loan!.status === 'Overdue' ? 'border-red-500/30' : ''}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🐄</span>
            <div className="flex-1">
              <p className="font-bold text-white">{c.name}</p>
              <p className="text-xs text-slate-500">{c.loan!.bank} · {c.loan!.scheme}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${
              c.loan!.status === 'Active' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
              c.loan!.status === 'Overdue' ? 'bg-red-500/20 border-red-500/30 text-red-400' :
              'bg-slate-500/20 border-slate-500/30 text-slate-400'
            }`}>{c.loan!.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
            <div><p className="text-xs text-slate-500">Principal</p><p className="font-bold text-white">{inr(c.loan!.principal)}</p></div>
            <div><p className="text-xs text-slate-500">Outstanding</p><p className={`font-bold ${c.loan!.status === 'Overdue' ? 'text-red-400' : 'text-orange-400'}`}>{inr(c.loan!.outstanding)}</p></div>
            <div><p className="text-xs text-slate-500">Monthly EMI</p><p className="font-bold text-white">{inr(c.loan!.emi)}</p></div>
            <div><p className="text-xs text-slate-500">Next Due</p><p className={`font-bold ${c.loan!.status === 'Overdue' ? 'text-red-400' : 'text-white'}`}>{c.loan!.nextDueDate}</p></div>
          </div>
          {c.loan!.status === 'Overdue' && (
            <div className="flex items-center gap-2 p-2 bg-red-900/30 rounded-xl mt-1">
              <AlertTriangle size={13} className="text-red-400" />
              <p className="text-xs text-red-300">EMI overdue! Contact your bank immediately to avoid penalty.</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function VetBookingView({ onBack }: { onBack: () => void }) {
  const vets = [
    { name: 'Dr. Ramesh Patel', spec: 'Bovine Specialist', rating: 4.8, dist: '2.3 km', phone: '9876501234', avail: 'Available Today' },
    { name: 'Dr. Priya Sharma', spec: 'Dairy Cattle Expert', rating: 4.6, dist: '5.1 km', phone: '9812309876', avail: 'Tomorrow 10am' },
    { name: 'Govt. Veterinary Hospital', spec: 'All species · Free OPD', rating: 4.2, dist: '7.8 km', phone: '180012345', avail: 'Mon-Sat 9am-5pm' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">🩺 Vet Booking</h2><p className="text-xs text-slate-400">Certified veterinarians near you</p></div>
      </div>
      <div className="flex gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-2xl items-center">
        <PhoneCall size={16} className="text-red-400 flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-red-300">Emergency Helpline</p>
          <p className="text-xs text-slate-400">Livestock Emergency: <strong className="text-white">1962</strong> (Toll-Free)</p>
        </div>
      </div>
      {vets.map(v => (
        <div key={v.name} className="glass-card p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-700 to-pink-600 flex items-center justify-center text-2xl flex-shrink-0">🩺</div>
            <div className="flex-1">
              <p className="font-bold text-white">{v.name}</p>
              <p className="text-xs text-slate-400">{v.spec}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-amber-400 flex items-center gap-0.5"><Star size={10} fill="currentColor" /> {v.rating}</span>
                <span className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={10} /> {v.dist}</span>
                <span className="text-xs text-emerald-400">{v.avail}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <a href={`tel:${v.phone}`} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
              <PhoneCall size={13} /> Call
            </a>
            <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-bold">
              <Clock size={13} /> Book Slot
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function GovtSchemesView({ onBack }: { onBack: () => void }) {
  const schemes = [
    { icon: '🌱', name: 'PM-KISAN', desc: 'Direct income support of ₹6,000/year for small & marginal farmers.', tag: 'Income Support', color: 'from-emerald-700 to-teal-600' },
    { icon: '🐄', name: 'Rashtriya Gokul Mission', desc: 'Conservation and development of indigenous bovine breeds.', tag: 'Breed Development', color: 'from-amber-700 to-orange-600' },
    { icon: '🛡', name: 'PMFBY Livestock', desc: 'Livestock insurance with premium subsidy from government.', tag: 'Insurance', color: 'from-violet-700 to-purple-600' },
    { icon: '🏦', name: 'Kisan Credit Card', desc: 'Short-term credit for crop & livestock at 7% interest.', tag: 'Credit', color: 'from-blue-700 to-sky-600' },
    { icon: '🏥', name: 'National Livestock Mission', desc: 'Promotes entrepreneurship and breed improvement.', tag: 'Development', color: 'from-rose-700 to-pink-600' },
    { icon: '📦', name: 'NABARD Livestock', desc: 'Refinancing for dairy, poultry, and meat animals.', tag: 'Finance', color: 'from-teal-700 to-cyan-600' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">📋 Govt. Schemes</h2><p className="text-xs text-slate-400">Available welfare programs</p></div>
      </div>
      {schemes.map(s => (
        <motion.div key={s.name} whileTap={{ scale: 0.98 }} className="glass-card p-4 flex items-start gap-4">
          <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.color} flex items-center justify-center text-2xl flex-shrink-0`}>{s.icon}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-white">{s.name}</p>
              <span className="text-xs bg-white/8 text-slate-300 px-2 py-0.5 rounded-full">{s.tag}</span>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-snug">{s.desc}</p>
            <button className="text-xs text-emerald-400 font-semibold mt-2 flex items-center gap-1">Apply Online <ChevronRight size={11} /></button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AGENT PORTAL VIEWS
// ════════════════════════════════════════════════════════════════════════════════

function AgentDashboard({ cattle, agentId, onNavigate }:
  { cattle: Cattle[]; agentId: string; onNavigate: (v: AgentView) => void }) {
  const today = new Date().toISOString().split('T')[0];
  const todayCount = cattle.filter(c => new Date(c.registeredAt).toISOString().split('T')[0] === today).length;
  const verified = cattle.filter(c => c.status === 'Verified').length;

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden p-5" style={{
        background: 'linear-gradient(135deg, #7c2d12 0%, #9a3412 50%, #c2410c 100%)',
        boxShadow: '0 8px 32px rgba(249,115,22,0.3)',
      }}>
        <FloatingOrbs />
        <div className="relative z-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-orange-300/80 text-xs font-medium">Agent Portal 🛡</p>
              <h2 className="text-2xl font-black text-white mt-0.5">Welcome Back</h2>
              <p className="text-orange-400/70 text-xs font-mono mt-1">{agentId}</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
              <CattleLogo size={36} />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            {[{ val: cattle.length, label: 'Total Cattle', icon: '🐄' },
              { val: todayCount, label: 'Today Registered', icon: '➕' },
              { val: verified, label: 'Verified', icon: '✅' },
            ].map(({ val, label, icon }) => (
              <div key={label} className="flex-1 bg-white/10 rounded-2xl p-3 text-center">
                <p className="text-xl">{icon}</p>
                <p className="text-xl font-black text-white">{val}</p>
                <p className="text-xs text-orange-200/70 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Agent Actions</h3>
        <div className="space-y-2">
          {[
            { icon: '➕', label: 'Register New Cattle', sub: 'Triple biometric enrollment (Muzzle + Retina + Face)', view: 'register' as AgentView, grad: 'from-emerald-700 to-teal-600', shadow: 'rgba(16,185,129,0.3)' },
            { icon: '🔍', label: 'Verify Existing Cattle', sub: 'Choose any one biometric channel to match', view: 'verify' as AgentView, grad: 'from-orange-700 to-amber-600', shadow: 'rgba(249,115,22,0.3)' },
            { icon: '📂', label: 'All Records', sub: 'Browse and search the full cattle database', view: 'records' as AgentView, grad: 'from-blue-700 to-sky-600', shadow: 'rgba(14,165,233,0.3)' },
            { icon: '📖', label: 'Audit Ledger', sub: 'Immutable log of all transactions', view: 'ledger' as AgentView, grad: 'from-violet-700 to-purple-600', shadow: 'rgba(124,58,237,0.3)' },
          ].map(a => (
            <motion.button key={a.label} id={`btn-agent-${a.label.replace(/\s+/g, '-').toLowerCase()}`}
              onClick={() => onNavigate(a.view)} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center gap-4 p-4 glass-card text-left hover:border-white/16 transition-all group">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${a.grad} flex items-center justify-center text-2xl flex-shrink-0`}
                style={{ boxShadow: `0 4px 20px ${a.shadow}` }}>{a.icon}</div>
              <div className="flex-1">
                <p className="font-bold text-white">{a.label}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-snug">{a.sub}</p>
              </div>
              <ChevronRight size={18} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Recent */}
      {cattle.slice(0, 3).map(c => (
        <div key={c.id} className="flex items-center gap-3 p-3 glass-card">
          <span className="text-xl flex-shrink-0">🐄</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm truncate">{c.name} · {c.breed}</p>
            <p className="text-xs text-slate-500 font-mono truncate">{c.id}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
            c.status === 'Synced' ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' :
            c.status === 'Verified' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
            'bg-amber-500/15 border-amber-500/30 text-amber-300'
          }`}>{c.status}</span>
        </div>
      ))}
    </div>
  );
}

// Registration Flow (3 biometrics required)
function RegisterCattleView({ onSuccess, onBack }: { onSuccess: (cattle: Cattle) => void; onBack: () => void }) {
  type RegStep = 'details' | 'muzzle' | 'retina' | 'face' | 'review' | 'saving' | 'done';
  const { settings } = useSettings();
  const [step, setStep] = useState<RegStep>('details');
  const [form, setForm] = useState({
    name: '', breed: '', tagNumber: '', age: '', weight: '', color: '',
    farmerName: '', farmerId: '', farmerPhone: '', village: '', district: '', state: '',
  });
  const [muzzleVec, setMuzzleVec] = useState<number[] | null>(null);
  const [retinaVec, setRetinaVec] = useState<number[] | null>(null);
  const [faceVec, setFaceVec] = useState<number[] | null>(null);
  const [savedId, setSavedId] = useState('');
  const [err, setErr] = useState('');
  const breeds = ['Gir', 'Sahiwal', 'Murrah Buffalo', 'Tharparkar', 'Red Sindhi', 'Jersey Cross', 'HF Cross', 'Ongole'];

  const STEPS: RegStep[] = ['details', 'muzzle', 'retina', 'face', 'review'];
  const stepIdx = STEPS.indexOf(step);

  const validateDetails = () => {
    const { name, breed, farmerId, farmerName, farmerPhone } = form;
    if (!name.trim() || !breed || !farmerId.trim() || !farmerName.trim() || !farmerPhone.trim()) {
      setErr('Please fill all required fields (*)'); return false;
    }
    setErr(''); return true;
  };

  const handleSave = async () => {
    setStep('saving');
    try {
      const cattle = await addCattle({
        tagNumber: form.tagNumber || `TAG-${Date.now()}`,
        name: form.name.trim(),
        breed: form.breed,
        age: parseInt(form.age) || 3,
        weight: parseInt(form.weight) || 350,
        color: form.color || 'Brown',
        farmerId: form.farmerId.trim().toUpperCase(),
        farmerName: form.farmerName.trim(),
        farmerPhone: form.farmerPhone.trim(),
        village: form.village.trim() || 'Unknown',
        district: form.district.trim() || 'Unknown',
        state: form.state.trim() || 'Unknown',
        muzzleEmbedding: muzzleVec!,
        retinaEmbedding: retinaVec!,
        faceEmbedding: faceVec!,
        biometricStatus: { muzzle: true, retina: true, face: true },
        registeredBy: settings.agentId,
        lastModified: Date.now(),
        status: 'Offline',
      });
      setSavedId(cattle.id);
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
        <button onClick={step === 'details' ? onBack : () => setStep('details')} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">Register Cattle</h2><p className="text-xs text-slate-400">Triple biometric enrollment</p></div>
      </div>

      {/* Step indicator */}
      {step !== 'saving' && step !== 'done' && (
        <div className="flex items-center gap-1">
          {['Details','Muzzle','Retina','Face','Review'].map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1 text-xs font-semibold transition-colors ${i <= stepIdx ? 'text-emerald-400' : 'text-slate-600'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border transition-all ${
                  i < stepIdx ? 'bg-emerald-500 border-emerald-500 text-white' :
                  i === stepIdx ? 'border-emerald-500 text-emerald-400' : 'border-slate-700 text-slate-600'
                }`}>{i < stepIdx ? '✓' : i + 1}</div>
                <span className="hidden sm:block">{s}</span>
              </div>
              {i < 4 && <div className={`flex-1 h-0.5 rounded-full transition-all ${i < stepIdx ? 'bg-emerald-500' : 'bg-slate-800'}`} />}
            </React.Fragment>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* ── Details ── */}
        {step === 'details' && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">🐄 Cattle Information</p>
            <div className="grid grid-cols-2 gap-2">
              {[{ k: 'name' as const, label: 'Name *', ph: 'Lakshmi', span: 2 },
                { k: 'breed' as const, label: 'Breed *', ph: '', isSelect: true, span: 2 },
                { k: 'tagNumber' as const, label: 'Ear Tag', ph: 'TAG-001', span: 1 },
                { k: 'color' as const, label: 'Color', ph: 'Brown', span: 1 },
                { k: 'age' as const, label: 'Age (yrs)', ph: '3', span: 1, type: 'number' },
                { k: 'weight' as const, label: 'Weight (kg)', ph: '350', span: 1, type: 'number' },
              ].map(f => (
                <div key={f.k} className={f.span === 2 ? 'col-span-2' : ''}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  {f.isSelect ? (
                    <select id={`sel-${f.k}`} value={form[f.k]} onChange={set(f.k)} className="input-field">
                      <option value="">Select breed…</option>
                      {breeds.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input id={`inp-${f.k}`} value={form[f.k]} onChange={set(f.k)} placeholder={f.ph} type={f.type || 'text'} className="input-field" />
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest pt-1">👤 Farmer Information</p>
            <div className="grid grid-cols-2 gap-2">
              {[{ k: 'farmerName' as const, label: 'Farmer Name *', ph: 'Rajesh Kumar', span: 2 },
                { k: 'farmerId' as const, label: 'Farmer ID *', ph: 'F001', span: 1 },
                { k: 'farmerPhone' as const, label: 'Phone *', ph: '9876543210', span: 1 },
                { k: 'village' as const, label: 'Village', ph: 'Wadgaon', span: 1 },
                { k: 'district' as const, label: 'District', ph: 'Pune', span: 1 },
                { k: 'state' as const, label: 'State', ph: 'Maharashtra', span: 2 },
              ].map(f => (
                <div key={f.k} className={f.span === 2 ? 'col-span-2' : ''}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  <input id={`inp-${f.k}`} value={form[f.k]} onChange={set(f.k)} placeholder={f.ph} className="input-field" />
                </div>
              ))}
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <button className="btn-emerald" onClick={() => validateDetails() && setStep('muzzle')}>
              Next: Muzzle Scan 🐽 →
            </button>
          </motion.div>
        )}

        {/* ── Muzzle Scan ── */}
        {step === 'muzzle' && (
          <motion.div key="muzzle" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel="muzzle"
              onComplete={(v) => { setMuzzleVec(v); setStep('retina'); }}
              onError={setErr} />
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          </motion.div>
        )}

        {/* ── Retina Scan ── */}
        {step === 'retina' && (
          <motion.div key="retina" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel="retina"
              onComplete={(v) => { setRetinaVec(v); setStep('face'); }}
              onError={setErr} />
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          </motion.div>
        )}

        {/* ── Face Scan ── */}
        {step === 'face' && (
          <motion.div key="face" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel="face"
              onComplete={(v) => { setFaceVec(v); setStep('review'); }}
              onError={setErr} />
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          </motion.div>
        )}

        {/* ── Review ── */}
        {step === 'review' && (
          <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="glass-card p-4 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Registration Summary</p>
              {[['Name', form.name], ['Breed', form.breed], ['Farmer', form.farmerName], ['Farmer ID', form.farmerId.toUpperCase()], ['Village', form.village]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1 border-t border-white/5">
                  <span className="text-xs text-slate-400">{k}</span>
                  <span className="text-xs font-semibold text-white">{v || '—'}</span>
                </div>
              ))}
            </div>
            {/* Biometric status */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { ch: 'muzzle', icon: '🐽', label: 'Muzzle', ok: !!muzzleVec },
                { ch: 'retina', icon: '👁', label: 'Retina', ok: !!retinaVec },
                { ch: 'face', icon: '🐄', label: 'Face ID', ok: !!faceVec },
              ].map(b => (
                <div key={b.ch} className={`flex flex-col items-center gap-1 p-3 rounded-2xl border font-medium text-xs ${b.ok ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'}`}>
                  <span className="text-2xl">{b.icon}</span>
                  <span>{b.label}</span>
                  {b.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                </div>
              ))}
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <button className="btn-emerald" onClick={handleSave}>
              💾 Save Cattle Registration
            </button>
          </motion.div>
        )}

        {/* ── Saving ── */}
        {step === 'saving' && (
          <motion.div key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-16">
            <Loader2 size={44} className="animate-spin text-emerald-400" />
            <p className="text-slate-300 font-medium">Saving to secure database…</p>
          </motion.div>
        )}

        {/* ── Done ── */}
        {step === 'done' && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-5 py-8">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
              className="w-24 h-24 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #064e3b, #059669)', boxShadow: '0 0 40px rgba(16,185,129,0.5)' }}>
              <CheckCircle2 size={48} className="text-emerald-200" />
            </motion.div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black text-white">Cattle Aadhaar Issued! 🎉</h3>
              <p className="text-slate-400 text-sm">Triple biometric identity registered</p>
              <div className="mt-4 p-4 glass-card-emerald rounded-2xl">
                <p className="text-xs text-slate-400 mb-1">Cattle ID (Biometric ID)</p>
                <p className="font-mono font-black text-emerald-400 text-lg tracking-wider">{savedId}</p>
              </div>
              <div className="flex gap-2 mt-2 justify-center text-sm">
                {['🐽 Muzzle', '👁 Retina', '🐄 Face'].map(b => (
                  <span key={b} className="text-xs bg-emerald-500/15 text-emerald-300 px-2 py-1 rounded-full border border-emerald-500/25">{b} ✓</span>
                ))}
              </div>
            </div>
            <button className="btn-emerald" onClick={onBack}>← Back to Dashboard</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Verification Flow (any 1 of 3 channels)
function VerifyCattleView({ cattle, onBack }: { cattle: Cattle[]; onBack: () => void }) {
  const { settings } = useSettings();
  const [selectedChannel, setSelectedChannel] = useState<BiometricChannel | null>(null);
  const [step, setStep] = useState<'select' | 'scan' | 'result'>('select');
  const [match, setMatch] = useState<Cattle | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [noMatch, setNoMatch] = useState(false);
  const [err, setErr] = useState('');

  const thresholds: Record<BiometricChannel, number> = {
    muzzle: settings.muzzleThreshold,
    retina: settings.retinaThreshold,
    face: settings.faceThreshold,
  };

  const handleScanComplete = async (vec: number[], ch: BiometricChannel) => {
    const threshold = thresholds[ch];
    let bestCattle: Cattle | null = null;
    let bestScore = 0;
    for (const c of cattle) {
      const emb = ch === 'muzzle' ? c.muzzleEmbedding : ch === 'retina' ? c.retinaEmbedding : c.faceEmbedding;
      if (!emb?.length) continue;
      const score = cosineSimilarity(vec, emb);
      if (score > bestScore) { bestScore = score; bestCattle = c; }
    }
    if (bestCattle && bestScore >= threshold) {
      setMatch(bestCattle); setConfidence(bestScore); setNoMatch(false);
      await addVerificationLedger(bestCattle.id, ch, bestScore, settings.agentId, true);
    } else {
      setNoMatch(true); setMatch(null);
      if (bestCattle) await addVerificationLedger(bestCattle.id, ch, bestScore, settings.agentId, false);
    }
    setStep('result');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={step !== 'select' ? () => { setStep('select'); setSelectedChannel(null); setNoMatch(false); setMatch(null); } : onBack}
          className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">Verify Cattle</h2>
          <p className="text-xs text-slate-400">Match against {cattle.length} registered animals</p></div>
      </div>

      <AnimatePresence mode="wait">
        {/* Channel Selection */}
        {step === 'select' && (
          <motion.div key="select" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
            <div className="glass-card p-4 rounded-3xl space-y-2">
              <p className="font-bold text-white">Select Biometric Channel</p>
              <p className="text-xs text-slate-400">Choose ONE channel to verify. Any single channel is sufficient for identification.</p>
            </div>
            {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => {
              const meta = CHANNEL_META[ch];
              const isSelected = selectedChannel === ch;
              return (
                <motion.button key={ch} id={`btn-channel-${ch}`} onClick={() => setSelectedChannel(ch)} whileTap={{ scale: 0.97 }}
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
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-600'}`}>
                      {isSelected && <CheckCircle2 size={12} className="text-white" />}
                    </div>
                  </div>
                </motion.button>
              );
            })}
            {selectedChannel && (
              <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={`btn-${selectedChannel === 'muzzle' ? 'emerald' : selectedChannel === 'retina' ? 'violet' : 'saffron'}`}
                onClick={() => setStep('scan')}>
                Start {CHANNEL_META[selectedChannel].label} →
              </motion.button>
            )}
          </motion.div>
        )}

        {/* Scanner */}
        {step === 'scan' && selectedChannel && (
          <motion.div key="scan" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <Scanner channel={selectedChannel} onComplete={handleScanComplete} onError={msg => { setErr(msg); }} />
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          </motion.div>
        )}

        {/* Result */}
        {step === 'result' && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
            {match && !noMatch ? (
              <>
                <div className="flex flex-col items-center gap-3 p-6 rounded-3xl" style={{
                  background: 'linear-gradient(135deg, #064e3b, #065f46)',
                  boxShadow: '0 8px 32px rgba(16,185,129,0.4)',
                }}>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 180 }}>
                    <CheckCircle2 size={56} className="text-emerald-300" />
                  </motion.div>
                  <h3 className="text-2xl font-black text-white">✅ Match Found!</h3>
                  <div className="text-center">
                    <p className="text-5xl font-black text-emerald-400">{(confidence * 100).toFixed(1)}%</p>
                    <p className="text-xs text-emerald-300/70 mt-1">via {selectedChannel?.toUpperCase()} biometric</p>
                  </div>
                  <div className="w-full bg-black/30 rounded-full h-2.5">
                    <motion.div className="h-2.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-300"
                      initial={{ width: 0 }} animate={{ width: `${confidence * 100}%` }} transition={{ duration: 1, ease: 'easeOut' }} />
                  </div>
                </div>
                <div className="glass-card p-4 space-y-2">
                  <div className="flex items-center gap-3 pb-2 border-b border-white/8">
                    <span className="text-3xl">🐄</span>
                    <div>
                      <p className="font-black text-white text-lg">{match.name}</p>
                      <p className="text-emerald-400 text-sm">{match.breed} · {match.age}yr · {match.weight}kg</p>
                    </div>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-bold border ${
                      match.status === 'Verified' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-blue-500/20 border-blue-500/30 text-blue-300'
                    }`}>{match.status}</span>
                  </div>
                  {[['Cattle ID', match.id], ['Tag No.', match.tagNumber], ['Farmer', match.farmerName],
                    ['Farmer ID', match.farmerId], ['Village', match.village], ['District', match.district],
                    ['Registered', fmt(match.registeredAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 border-t border-white/5">
                      <span className="text-xs text-slate-400">{k}</span>
                      <span className="text-xs font-semibold text-white font-mono">{v}</span>
                    </div>
                  ))}
                  {/* Biometric status */}
                  <div className="flex gap-2 pt-2 border-t border-white/5">
                    {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => (
                      <div key={ch} className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-xl text-xs border ${match.biometricStatus[ch] ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'} ${ch === selectedChannel ? 'ring-2 ring-emerald-400/50' : ''}`}>
                        {ch === 'muzzle' ? '🐽' : ch === 'retina' ? '👁' : '🐄'}
                        {ch === selectedChannel && ' ✓'}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 p-8 rounded-3xl bg-red-900/20 border border-red-500/30">
                <XCircle size={56} className="text-red-400" />
                <h3 className="text-2xl font-black text-white">No Match Found</h3>
                <p className="text-sm text-slate-400 text-center">This animal's {selectedChannel} biometric did not match any registered cattle above the {((thresholds[selectedChannel!]) * 100).toFixed(0)}% threshold.</p>
                <p className="text-xs text-slate-500">Try a different biometric channel or check with your supervisor.</p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setStep('select'); setSelectedChannel(null); setNoMatch(false); setMatch(null); setErr(''); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-300 font-semibold text-sm">
                <RefreshCw size={15} /> Try Again
              </button>
              <button onClick={onBack} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-300 font-semibold text-sm">
                ← Dashboard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AllRecordsView({ cattle, onBack }: { cattle: Cattle[]; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = cattle.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase()) ||
    c.farmerId.toLowerCase().includes(search.toLowerCase()) ||
    c.farmerName.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">All Records</h2><p className="text-xs text-slate-400">{cattle.length} cattle in database</p></div>
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID, farmer…" className="input-field pl-9" />
      </div>
      <div className="space-y-2">
        {filtered.map(c => (
          <div key={c.id} className="glass-card p-3 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #1e3a2f, #065f46)' }}>🐄</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-white text-sm">{c.name}</p>
                <span className="text-xs text-slate-500">{c.breed}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${c.status === 'Synced' ? 'bg-blue-500/15 border-blue-500/25 text-blue-300' : c.status === 'Verified' ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300' : 'bg-amber-500/15 border-amber-500/25 text-amber-300'}`}>{c.status}</span>
              </div>
              <p className="text-xs font-mono text-slate-500 truncate">{c.id}</p>
              <p className="text-xs text-slate-500">{c.farmerName} · {c.village}</p>
              <div className="flex gap-1 mt-1">
                {(['muzzle', 'retina', 'face'] as BiometricChannel[]).map(ch => (
                  <span key={ch} className={`text-xs px-1 rounded font-medium ${c.biometricStatus[ch] ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {ch === 'muzzle' ? '🐽' : ch === 'retina' ? '👁' : '🐄'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-slate-500 py-8 text-sm">No records found</p>}
      </div>
    </div>
  );
}

function AuditLedgerView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLedgerEntries().then(e => { setEntries(e); setLoading(false); });
  }, []);

  const colors: Record<string, string> = {
    REGISTERED: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400',
    HEALTH_UPDATED: 'bg-violet-500/15 border-violet-500/25 text-violet-400',
    VERIFIED: 'bg-blue-500/15 border-blue-500/25 text-blue-400',
    INSURANCE_UPDATED: 'bg-sky-500/15 border-sky-500/25 text-sky-400',
    LOAN_UPDATED: 'bg-amber-500/15 border-amber-500/25 text-amber-400',
  };
  const icons: Record<string, string> = {
    REGISTERED: '➕', HEALTH_UPDATED: '❤️', VERIFIED: '✅', INSURANCE_UPDATED: '🛡', LOAN_UPDATED: '🏦',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">Audit Ledger</h2><p className="text-xs text-slate-400">{entries.length} entries · Immutable</p></div>
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
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${e.status === 'Completed' ? 'text-emerald-400' : e.status === 'Failed' ? 'text-red-400' : 'text-amber-400'}`}>
                  {e.status}
                </span>
              </div>
              {e.details && <p className="text-xs text-slate-400 leading-relaxed">{e.details}</p>}
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <span className="font-mono truncate">{e.cattleId}</span>
                <span>·</span>
                <span>{e.performedBy}</span>
                <span>·</span>
                <span>{fmt(e.timestamp)}</span>
              </div>
            </motion.div>
          ))}
          {entries.length === 0 && <p className="text-center text-slate-500 py-8">No ledger entries</p>}
        </div>
      )}
    </div>
  );
}

function AgentConfigView({ onBack }: { onBack: () => void }) {
  const { settings, update } = useSettings();

  const Slider = ({ id, label, sub, val, onChange }: { id: string; label: string; sub: string; val: number; onChange: (v: number) => void }) => {
    const pct = ((val - 0.5) / 0.49) * 100;
    const risk = val < 0.7 ? 'High FAR · Lenient' : val < 0.85 ? 'Balanced' : 'Strict · Low FAR';
    const riskColor = val < 0.7 ? 'text-red-400' : val < 0.85 ? 'text-amber-400' : 'text-emerald-400';
    return (
      <div className="glass-card p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div><p className="font-bold text-white text-sm">{label}</p><p className="text-xs text-slate-500">{sub}</p></div>
          <div className="text-right"><p className="text-2xl font-black text-emerald-400">{(val * 100).toFixed(0)}%</p><p className={`text-xs font-bold ${riskColor}`}>{risk}</p></div>
        </div>
        <input id={id} type="range" min={0.5} max={0.99} step={0.01} value={val} onChange={e => onChange(parseFloat(e.target.value))}
          className="w-full" style={{ background: `linear-gradient(to right, #059669 0%, #34D399 ${pct}%, #1e293b ${pct}%)` }} />
        <div className="flex justify-between text-xs text-slate-600"><span>50% Lenient</span><span>99% Strict</span></div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div><h2 className="font-black text-white text-lg">⚙️ Agent Config</h2><p className="text-xs text-slate-400">Biometric sensitivity settings</p></div>
      </div>
      <div className="p-3 rounded-2xl bg-amber-900/20 border border-amber-500/25 flex gap-2">
        <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300">Lowering thresholds increases False Acceptance Rate (fraud risk). Raise for strict field conditions.</p>
      </div>
      <Slider id="slider-muzzle" label="🐽 Muzzle Threshold" sub="Primary biometric channel" val={settings.muzzleThreshold} onChange={v => update({ muzzleThreshold: v })} />
      <Slider id="slider-retina" label="👁 Retina Threshold" sub="Secondary biometric channel" val={settings.retinaThreshold} onChange={v => update({ retinaThreshold: v })} />
      <Slider id="slider-face" label="🐄 Face ID Threshold" sub="Tertiary biometric channel" val={settings.faceThreshold} onChange={v => update({ faceThreshold: v })} />
      <div className="glass-card p-4 flex items-center justify-between">
        <div><p className="font-bold text-white text-sm">Liveness Detection</p><p className="text-xs text-slate-500">Anti-spoofing frame check</p></div>
        <button id="toggle-liveness" onClick={() => update({ livenessEnabled: !settings.livenessEnabled })}
          className={`relative w-14 h-7 rounded-full transition-colors ${settings.livenessEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
          <motion.div className="absolute top-1 w-5 h-5 rounded-full bg-white shadow"
            animate={{ left: settings.livenessEnabled ? '2rem' : '0.25rem' }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
        </button>
      </div>
      <div className="glass-card p-4">
        <label className="text-xs text-slate-400 mb-1 block">Agent ID</label>
        <input value={settings.agentId} onChange={e => update({ agentId: e.target.value })} className="input-field font-mono" placeholder="AGENT-001" />
      </div>
      <button onClick={() => update(DEFAULT_SETTINGS)} className="w-full py-3 rounded-2xl border border-slate-700 text-slate-400 text-sm flex items-center justify-center gap-2 hover:border-red-500/40 hover:text-red-400 transition-colors">
        <RefreshCw size={14} /> Reset to Defaults
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// FARMER APP (bottom nav + routing)
// ════════════════════════════════════════════════════════════════════════════════

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

  // Cloud sync on mount
  useEffect(() => {
    if (!isOnline()) { setSyncStatus('offline'); return; }
    setSyncStatus('syncing');
    pullAllFromCloud().then(() => { setSyncStatus('synced'); refresh(); }).catch(() => setSyncStatus('error'));
    track('farmer_portal_opened', { farmerId });
  }, [farmerId, refresh]);

  const navigate = (v: FarmerView) => { setSelectedCattle(null); setView(v); };

  const farmerNav = [
    { v: 'dashboard' as FarmerView, icon: '🏠', label: 'Home' },
    { v: 'cattle' as FarmerView, icon: '🐄', label: 'Cattle' },
    { v: 'services' as FarmerView, icon: '⚙️', label: 'Services' },
    { v: 'profile' as FarmerView, icon: '👤', label: 'Profile' },
  ];

  return (
    <div className="min-h-dvh" style={{ background: 'linear-gradient(160deg, #07111f 0%, #0d1f14 100%)' }}>
      <Toast toasts={toasts} remove={remove} />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/6" style={{ background: 'rgba(10,15,30,0.85)', backdropFilter: 'blur(20px)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-2">
              <CattleLogo size={28} />
            </div>
            <div>
              <p className="text-sm font-black leading-none text-white">किसान-दृष्टि</p>
              <p className="text-xs text-emerald-400">Farmer Portal</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <SyncBadge status={syncStatus} />
            <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-right">
              <p className="text-xs font-bold text-white">{farmerName}</p>
              <p className="text-xs font-mono text-slate-500">{farmerId}</p>
            </div>
            <button onClick={onLogout} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10">Logout</button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-5 safe-bottom sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          <motion.div key={view + (selectedCattle?.id ?? '')} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {view === 'dashboard' && !selectedCattle && <FarmerDashboard cattle={cattle} farmerName={farmerName} farmerId={farmerId} onNavigate={navigate} onSelectCattle={c => { setSelectedCattle(c); setView('detail'); }} />}
            {view === 'cattle' && !selectedCattle && <MyCattleView cattle={cattle} onSelectCattle={c => { setSelectedCattle(c); setView('detail'); }} onBack={() => navigate('dashboard')} />}
            {view === 'detail' && selectedCattle && <CattleDetailView cattle={selectedCattle} onBack={() => { setSelectedCattle(null); setView('cattle'); }} />}
            {view === 'services' && <ServicesHubView onNavigate={navigate} onBack={() => navigate('dashboard')} />}
            {view === 'insurance' && <InsuranceView cattle={cattle} onBack={() => navigate('services')} />}
            {view === 'loan' && <LoanView cattle={cattle} onBack={() => navigate('services')} />}
            {view === 'vet' && <VetBookingView onBack={() => navigate('services')} />}
            {view === 'schemes' && <GovtSchemesView onBack={() => navigate('services')} />}
            {view === 'profile' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div><h2 className="font-black text-white text-lg">My Profile</h2><p className="text-xs text-slate-400">Farmer account details</p></div>
                </div>
                <div className="flex flex-col items-center gap-3 p-6 glass-card rounded-3xl">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl" style={{ background: 'linear-gradient(135deg, #064e3b, #059669)' }}>👨‍🌾</div>
                  <div className="text-center">
                    <p className="text-2xl font-black text-white">{farmerName}</p>
                    <p className="text-emerald-400 font-mono text-sm mt-1">{farmerId}</p>
                    <p className="text-xs text-slate-400 mt-1">Registered Farmer · Kisan-Drishti</p>
                  </div>
                </div>
                {[['🐄 Total Cattle', cattle.length.toString()],
                  ['🛡 Insured Cattle', cattle.filter(c => c.insurance?.status === 'Active').length.toString()],
                  ['🏦 Active Loans', cattle.filter(c => c.loan?.status === 'Active').length.toString()],
                  ['📊 Health Records', cattle.reduce((s, c) => s + c.healthMetrics.length, 0).toString()],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-3 px-4 glass-card">
                    <span className="text-sm text-slate-300">{k}</span>
                    <span className="font-bold text-white">{v}</span>
                  </div>
                ))}
                <button onClick={onLogout} className="w-full py-3 rounded-2xl border border-red-500/30 text-red-400 text-sm font-semibold">Logout</button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        <div className="mx-auto flex max-w-7xl flex-wrap sm:flex-nowrap">
          {farmerNav.map(n => {
            const active = view === n.v || (n.v === 'cattle' && view === 'detail');
            return (
              <button key={n.v} id={`fnav-${n.v}`} onClick={() => navigate(n.v)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-all relative ${active ? 'text-emerald-400' : 'text-slate-600 hover:text-slate-400'}`}>
                {active && (
                  <motion.div layoutId="farmer-nav-pill" className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-emerald-400" />
                )}
                <span className="text-xl leading-none">{n.icon}</span>
                <span className="text-xs font-medium">{n.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AGENT APP (bottom nav + routing)
// ════════════════════════════════════════════════════════════════════════════════

function AgentApp({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<AgentView>('dashboard');
  const [cattle, setCattle] = useState<Cattle[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const { settings } = useSettings();
  const { toasts, add: addToast, remove } = useToast();

  const refresh = useCallback(async () => { setCattle(await getAllCattle()); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Cloud sync: pull on mount, real-time listener, push any unsynced local data
  useEffect(() => {
    if (!isOnline()) { setSyncStatus('offline'); return; }
    setSyncStatus('syncing');
    pullAllFromCloud()
      .then(() => { setSyncStatus('synced'); refresh(); })
      .catch(() => setSyncStatus('error'));

    // Push anything local that hasn't reached Firestore yet
    pushAllLocalToCloud().catch(() => {});

    // Real-time listener — auto-merge new cloud cattle into local DB
    const unsub = subscribeToCattleChanges((_c) => {
      refresh();
      addToast('New cattle synced from cloud ☁️', 'info');
    });

    // Online/offline listeners
    const onOnline  = () => { setSyncStatus('syncing'); pullAllFromCloud().then(() => { setSyncStatus('synced'); refresh(); }); };
    const onOffline = () => setSyncStatus('offline');
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);

    track('agent_portal_opened', { agentId: settings.agentId });

    return () => {
      unsub();
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh, settings.agentId, addToast]);

  const agentNav = [
    { v: 'dashboard' as AgentView, icon: '🏠', label: 'Home' },
    { v: 'register' as AgentView, icon: '➕', label: 'Register' },
    { v: 'verify' as AgentView, icon: '🔍', label: 'Verify' },
    { v: 'records' as AgentView, icon: '📂', label: 'Records' },
    { v: 'ledger' as AgentView, icon: '📖', label: 'Ledger' },
  ];

  return (
    <div className="min-h-dvh" style={{ background: 'linear-gradient(160deg, #07111f 0%, #1a0d09 100%)' }}>
      <Toast toasts={toasts} remove={remove} />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/6" style={{ background: 'rgba(10,15,30,0.85)', backdropFilter: 'blur(20px)' }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-2">
              <CattleLogo size={28} />
            </div>
            <div>
              <p className="text-sm font-black leading-none text-white">किसान-दृष्टि</p>
              <p className="text-xs text-orange-400">Agent Portal</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <SyncBadge status={syncStatus} />
            {isGuestSession() && <GuestBadge />}
            <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-right">
              <p className="text-xs font-bold text-white">{settings.agentId}</p>
              <p className="text-xs text-slate-500">Field Agent</p>
            </div>
            <button onClick={() => setView('config')} className="rounded-2xl border border-white/8 bg-white/5 p-2 transition-colors hover:bg-white/10">
              <Settings size={16} className="text-slate-400" />
            </button>
            <button onClick={onLogout} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10">Logout</button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-5 safe-bottom sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {view === 'dashboard' && <AgentDashboard cattle={cattle} agentId={settings.agentId} onNavigate={v => setView(v)} />}
            {view === 'register' && <RegisterCattleView onSuccess={async (c) => {
              // Push new registration to Firestore immediately
              setSyncStatus('syncing');
              await pushCattleToCloud(c).catch(() => {});
              setSyncStatus('synced');
              track('cattle_registered', { cattleId: c.id, breed: c.breed, farmerId: c.farmerId });
              refresh(); setView('dashboard'); addToast('Cattle registered & synced to cloud ☁️', 'success');
            }} onBack={() => setView('dashboard')} />}
            {view === 'verify' && <VerifyCattleView cattle={cattle} onBack={() => setView('dashboard')} />}
            {view === 'records' && <AllRecordsView cattle={cattle} onBack={() => setView('dashboard')} />}
            {view === 'ledger' && <AuditLedgerView onBack={() => setView('dashboard')} />}
            {view === 'config' && <AgentConfigView onBack={() => setView('dashboard')} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        <div className="mx-auto flex max-w-7xl flex-wrap sm:flex-nowrap">
          {agentNav.map(n => {
            const active = view === n.v;
            return (
              <button key={n.v} id={`anav-${n.v}`} onClick={() => setView(n.v)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-all relative ${active ? 'text-orange-400' : 'text-slate-600 hover:text-slate-400'}`}>
                {active && (
                  <motion.div layoutId="agent-nav-pill" className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-orange-400" />
                )}
                <span className="text-xl leading-none">{n.icon}</span>
                <span className="text-xs font-medium">{n.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ════════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [role, setRole] = useState<AppRole>(null);
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const updateSettings = useCallback((p: Partial<AppSettings>) => setSettings(prev => ({ ...prev, ...p })), []);

  useEffect(() => {
    // Seed demo data locally
    seedDemoData().catch(console.error);
    // Initialize Firebase (non-blocking)
    initFirebase().catch(console.warn);
    track('app_launched');
  }, []);

  const handleSelectRole = async (r: AppRole, fId?: string) => {
    if (r === 'farmer' && fId) {
      // Look up farmer name from DB
      const all = await getAllCattle();
      const farmerCattle = all.find(c => c.farmerId === fId);
      if (!farmerCattle) {
        alert(`No cattle found for Farmer ID "${fId}". Try F001, F002, or F003.`);
        return;
      }
      setFarmerId(fId);
      setFarmerName(farmerCattle.farmerName);
    }
    setRole(r);
  };

  return (
    <SettingsContext.Provider value={{ settings, update: updateSettings }}>
      <AnimatePresence mode="wait">
        {role === null && !isGuestSession() && (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <RoleLanding onSelectRole={handleSelectRole} />
          </motion.div>
        )}
        {role === null && isGuestSession() && (
          <motion.div key="guest-demo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AgentApp onLogout={async () => { await signOutUser(); setRole(null); }} />
          </motion.div>
        )}
        {role === 'farmer' && (
          <motion.div key="farmer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <FarmerApp farmerId={farmerId} farmerName={farmerName} onLogout={async () => { await signOutUser(); setRole(null); }} />
          </motion.div>
        )}
        {role === 'agent' && (
          <motion.div key="agent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AgentApp onLogout={async () => { await signOutUser(); setRole(null); }} />
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsContext.Provider>
  );
}
