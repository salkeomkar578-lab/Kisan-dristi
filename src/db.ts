import { openDB, IDBPDatabase } from 'idb';

// ─── Biometric Types ──────────────────────────────────────────────────────────

export type BiometricChannel = 'muzzle' | 'retina' | 'face';

export interface BiometricStatus {
  muzzle: boolean;
  retina: boolean;
  face: boolean;
}

// ─── Core Types ───────────────────────────────────────────────────────────────

export type CattleStatus = 'Synced' | 'Offline' | 'Verified' | 'Pending';
export type HealthStatus = 'Excellent' | 'Good' | 'Needs Attention' | 'Critical';
export type InsurancePolicyStatus = 'Active' | 'Expired' | 'Claimed' | 'Pending';
export type LoanStatus = 'Active' | 'Closed' | 'Overdue' | 'Pending';

export interface DairyHealthRecord {
  dairyId: string;
  date: string;
  fatContent: number;
  snf: number;
  scc: number;
  milkYield: number; // litres/day
  temperature: number; // °C body temp
  weight: number; // kg
  healthStatus: HealthStatus;
  vetNotes?: string;
}

export interface InsuranceRecord {
  policyNumber: string;
  provider: string;
  scheme: string;
  premium: number;
  sumAssured: number;
  startDate: string;
  endDate: string;
  status: InsurancePolicyStatus;
  claimHistory?: { date: string; amount: number; reason: string; status: string }[];
}

export interface LoanRecord {
  loanId: string;
  bank: string;
  scheme: string;
  principal: number;
  outstanding: number;
  emi: number;
  nextDueDate: string;
  interestRate: number;
  status: LoanStatus;
}

export interface Cattle {
  id: string;
  tagNumber: string;
  name: string;
  breed: string;
  age: number;
  weight: number;
  color: string;
  // Farmer info
  farmerId: string;
  farmerName: string;
  farmerPhone: string;
  village: string;
  district: string;
  state: string;
  // Biometrics (3 independent channels)
  muzzleEmbedding: number[];
  retinaEmbedding: number[];
  faceEmbedding: number[];
  biometricStatus: BiometricStatus;
  // Meta
  registeredAt: number;
  registeredBy: string;
  lastModified: number;
  status: CattleStatus;
  // Records
  healthMetrics: DairyHealthRecord[];
  insurance?: InsuranceRecord;
  loan?: LoanRecord;
}

export interface LedgerEntry {
  id: string;
  cattleId: string;
  action: string;
  details?: string;
  performedBy: string;
  role: 'farmer' | 'agent';
  timestamp: number;
  lastModified: number;
  status: 'Completed' | 'Pending' | 'Failed';
}

// ─── DB Schema ────────────────────────────────────────────────────────────────

type KisanDB = {
  cattle: { key: string; value: Cattle; indexes: { 'by-farmer': string } };
  ledger: { key: string; value: LedgerEntry; indexes: { 'by-cattle': string } };
};

let dbPromise: Promise<IDBPDatabase<KisanDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<KisanDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KisanDB>('kisan-drishti-db-v3', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('cattle')) {
          const s = db.createObjectStore('cattle', { keyPath: 'id' });
          s.createIndex('by-farmer', 'farmerId');
        }
        if (!db.objectStoreNames.contains('ledger')) {
          const l = db.createObjectStore('ledger', { keyPath: 'id' });
          l.createIndex('by-cattle', 'cattleId');
        }
      },
    });
  }
  return dbPromise;
}

// ─── ID Generator ─────────────────────────────────────────────────────────────

function uid(prefix = 'KD'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// ─── Ledger (internal) ────────────────────────────────────────────────────────

async function ledger(entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'lastModified'> & Partial<Pick<LedgerEntry, 'lastModified'>>): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  await db.put('ledger', { ...entry, id: uid('LG'), timestamp: now, lastModified: now });
}

// ─── Cattle CRUD ──────────────────────────────────────────────────────────────

export async function addCattle(
  data: Omit<Cattle, 'id' | 'registeredAt' | 'healthMetrics' | 'lastModified'> & Partial<Pick<Cattle, 'lastModified'>>
): Promise<Cattle> {
  const db = await getDB();
  const now = Date.now();
  const cattle: Cattle = { ...data, id: uid('KD'), registeredAt: now, lastModified: now, healthMetrics: [] };
  await db.put('cattle', cattle);
  await ledger({
    cattleId: cattle.id, action: 'REGISTERED',
    details: `${cattle.name} (${cattle.breed}) registered. Triple biometric enrolled.`,
    performedBy: cattle.registeredBy, role: 'agent', status: 'Completed', lastModified: now,
  });
  return cattle;
}

export async function getAllCattle(): Promise<Cattle[]> {
  const db = await getDB();
  return db.getAll('cattle');
}

export async function getCattleByFarmer(farmerId: string): Promise<Cattle[]> {
  const db = await getDB();
  return db.getAllFromIndex('cattle', 'by-farmer', farmerId);
}

export async function getCattleById(id: string): Promise<Cattle | undefined> {
  const db = await getDB();
  return db.get('cattle', id);
}

export async function updateCattleHealth(
  cattleId: string,
  record: Omit<DairyHealthRecord, 'dairyId'>,
  performedBy = 'Agent'
): Promise<void> {
  const db = await getDB();
  const c = await db.get('cattle', cattleId);
  if (!c) throw new Error('Cattle not found');
  c.healthMetrics.push({ ...record, dairyId: uid('DH') });
  c.lastModified = Date.now();
  await db.put('cattle', c);
  await ledger({
    cattleId, action: 'HEALTH_UPDATED',
    details: `Status: ${record.healthStatus} | Fat: ${record.fatContent.toFixed(1)}% | Milk: ${record.milkYield}L/day`,
    performedBy, role: 'agent', status: 'Completed', lastModified: c.lastModified,
  });
}

export async function updateInsurance(cattleId: string, insurance: InsuranceRecord): Promise<void> {
  const db = await getDB();
  const c = await db.get('cattle', cattleId);
  if (!c) throw new Error('Cattle not found');
  c.insurance = insurance;
  c.lastModified = Date.now();
  await db.put('cattle', c);
  await ledger({
    cattleId, action: 'INSURANCE_UPDATED',
    details: `Policy: ${insurance.policyNumber} | Status: ${insurance.status}`,
    performedBy: 'System', role: 'agent', status: 'Completed', lastModified: c.lastModified,
  });
}

export async function updateLoan(cattleId: string, loan: LoanRecord): Promise<void> {
  const db = await getDB();
  const c = await db.get('cattle', cattleId);
  if (!c) throw new Error('Cattle not found');
  c.loan = loan;
  c.lastModified = Date.now();
  await db.put('cattle', c);
  await ledger({
    cattleId, action: 'LOAN_UPDATED',
    details: `Loan ID: ${loan.loanId} | Outstanding: ₹${loan.outstanding.toLocaleString('en-IN')}`,
    performedBy: 'System', role: 'agent', status: 'Completed', lastModified: c.lastModified,
  });
}

export async function addVerificationLedger(
  cattleId: string,
  channel: string,
  confidence: number,
  agentId: string,
  matched: boolean
): Promise<void> {
  await ledger({
    cattleId, action: 'VERIFIED',
    details: `Channel: ${channel.toUpperCase()} | Confidence: ${(confidence * 100).toFixed(1)}% | Result: ${matched ? 'MATCHED' : 'NO MATCH'}`,
    performedBy: agentId, role: 'agent', status: matched ? 'Completed' : 'Failed', lastModified: Date.now(),
  });
}

export async function getLedgerEntries(cattleId?: string): Promise<LedgerEntry[]> {
  const db = await getDB();
  const all = cattleId
    ? await db.getAllFromIndex('ledger', 'by-cattle', cattleId)
    : await db.getAll('ledger');
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Seed Demo Data ───────────────────────────────────────────────────────────

const BREEDS = ['Gir', 'Sahiwal', 'Murrah Buffalo', 'Tharparkar', 'Red Sindhi', 'Jersey Cross'];
const NAMES = ['Lakshmi', 'Ganga', 'Kamdhenu', 'Nandini', 'Radha', 'Tulsi', 'Savitri', 'Durga'];
const COLORS = ['Black & White', 'Brown', 'Grey', 'Tawny', 'White', 'Black'];
const STATES = ['Maharashtra', 'Gujarat', 'Rajasthan', 'Punjab', 'Haryana'];
const DISTRICTS = ['Pune', 'Anand', 'Jaipur', 'Ludhiana', 'Karnal'];
const VILLAGES = ['Wadgaon', 'Karamsad', 'Sanganer', 'Raikot', 'Taraori'];

const FARMERS = [
  { id: 'F001', name: 'Rajesh Kumar', phone: '9876543210', village: VILLAGES[0], district: DISTRICTS[0], state: STATES[0] },
  { id: 'F002', name: 'Sunita Devi', phone: '9812345678', village: VILLAGES[1], district: DISTRICTS[1], state: STATES[1] },
  { id: 'F003', name: 'Hardev Singh', phone: '9988776655', village: VILLAGES[3], district: DISTRICTS[3], state: STATES[3] },
];

export async function seedDemoData(): Promise<void> {
  const db = await getDB();
  if ((await db.count('cattle')) > 0) return;

  const healthStatuses: HealthStatus[] = ['Excellent', 'Good', 'Needs Attention', 'Critical'];

  for (let i = 0; i < 9; i++) {
    const farmer = FARMERS[i % FARMERS.length];
    const breed = BREEDS[i % BREEDS.length];
    const isInsured = i < 6;
    const hasLoan = i < 5;

    const cattle = await addCattle({
      tagNumber: `TAG-${String(i + 1).padStart(3, '0')}`,
      name: NAMES[i % NAMES.length],
      breed,
      age: 2 + (i % 5),
      weight: 300 + i * 40,
      color: COLORS[i % COLORS.length],
      farmerId: farmer.id,
      farmerName: farmer.name,
      farmerPhone: farmer.phone,
      village: farmer.village,
      district: farmer.district,
      state: farmer.state,
      muzzleEmbedding: Array.from({ length: 1024 }, () => Math.random() * 2 - 1),
      retinaEmbedding: Array.from({ length: 1024 }, () => Math.random() * 2 - 1),
      faceEmbedding: Array.from({ length: 1024 }, () => Math.random() * 2 - 1),
      biometricStatus: { muzzle: true, retina: true, face: true },
      registeredBy: 'AGENT-001',
      status: i % 3 === 0 ? 'Synced' : i % 3 === 1 ? 'Verified' : 'Offline',
      insurance: isInsured ? {
        policyNumber: `PMFBY-${2024}-${String(i + 1).padStart(4, '0')}`,
        provider: 'Agriculture Insurance Company of India',
        scheme: 'Pradhan Mantri Fasal Bima Yojana',
        premium: 500 + i * 50,
        sumAssured: 50000 + i * 5000,
        startDate: '2024-04-01',
        endDate: '2025-03-31',
        status: i === 2 ? 'Expired' : i === 4 ? 'Claimed' : 'Active',
        claimHistory: i === 4 ? [{ date: '2024-10-15', amount: 15000, reason: 'Illness', status: 'Settled' }] : [],
      } : undefined,
      loan: hasLoan ? {
        loanId: `KCC-${String(i + 1).padStart(5, '0')}`,
        bank: i % 2 === 0 ? 'State Bank of India' : 'Punjab National Bank',
        scheme: 'Kisan Credit Card (KCC)',
        principal: 100000 + i * 20000,
        outstanding: 60000 + i * 10000,
        emi: 5000 + i * 500,
        nextDueDate: '2025-08-01',
        interestRate: 7 + (i % 3) * 0.5,
        status: i === 3 ? 'Overdue' : 'Active',
      } : undefined,
    });

    for (let j = 0; j < 4; j++) {
      const d = new Date();
      d.setDate(d.getDate() - j * 30);
      await updateCattleHealth(cattle.id, {
        date: d.toISOString().split('T')[0],
        fatContent: 4 + Math.random() * 2,
        snf: 8.2 + Math.random() * 1.3,
        scc: 80 + Math.floor(Math.random() * 350),
        milkYield: 8 + Math.floor(Math.random() * 12),
        temperature: 38 + Math.random() * 0.8,
        weight: 300 + i * 40 + Math.floor(Math.random() * 20),
        healthStatus: healthStatuses[Math.floor(Math.random() * 2)],
        vetNotes: j === 0 ? 'Routine checkup completed' : undefined,
      }, 'AGENT-001');
    }
  }
}
