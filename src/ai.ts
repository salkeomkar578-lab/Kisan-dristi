// TensorFlow.js and MobileNet are loaded via CDN script tags in index.html
// and exposed as globals: `window.tf` and `window.mobilenet`
// This module wraps them with clean TypeScript types.

// ─── Global type declarations ──────────────────────────────────────────────────

declare global {
  interface Window {
    tf: any;
    mobilenet: {
      load(config?: { version?: number; alpha?: number }): Promise<MobileNetModel>;
    };
  }
}

interface MobileNetModel {
  infer(img: unknown, embedding?: boolean): { data(): Promise<Float32Array>; dispose(): void };
  classify(img: unknown, topk?: number): Promise<Array<{ className: string; probability: number }>>;
}

type FrameSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

// ─── State ────────────────────────────────────────────────────────────────────

let model: MobileNetModel | null = null;
let loadPromise: Promise<MobileNetModel> | null = null;

// ─── Model Loading ────────────────────────────────────────────────────────────

export async function loadModel(): Promise<MobileNetModel> {
  if (model) return model;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let attempts = 0;
    while ((!window.tf || !window.mobilenet) && attempts < 50) {
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }
    if (!window.tf || !window.mobilenet) {
      throw new Error('TensorFlow.js failed to load from CDN. Check network connection.');
    }

    const m = await window.mobilenet.load({ version: 2, alpha: 1.0 });
    model = m;
    console.log('[AI] MobileNet v2 loaded ✓');
    return m;
  })();

  return loadPromise;
}

export function isModelLoaded(): boolean {
  return model !== null;
}

// ─── Embedding Extraction ─────────────────────────────────────────────────────

/**
 * Extract a biometric embedding from a single video/image frame.
 * Returns a 1D number[] array (1024 dimensions from MobileNet).
 */
export async function extractVector(
  frameSource: FrameSource
): Promise<number[]> {
  const tf = window.tf;
  const m = await loadModel();

  const tensor = tf.tidy(() => {
    const pixels = tf.browser.fromPixels(frameSource as any);
    const resized = tf.image.resizeBilinear(pixels as Parameters<typeof tf.image.resizeBilinear>[0], [224, 224]);
    return resized.expandDims(0);
  });

  const embedding = m.infer(tensor, true);
  const data = await embedding.data();
  embedding.dispose();
  (tensor as { dispose(): void }).dispose();

  return Array.from(data);
}

/**
 * Extract a stable multi-frame embedding by averaging 3 captures.
 * This produces a more reliable registration template.
 */
export async function extractMultiFrameEmbedding(
  frameSource: FrameSource,
  frames = 3,
  intervalMs = 300
): Promise<number[]> {
  const vectors: number[][] = [];

  for (let i = 0; i < frames; i++) {
    const vec = await extractVector(frameSource);
    vectors.push(vec);
    if (i < frames - 1) await new Promise(r => setTimeout(r, intervalMs));
  }

  // Average the vectors
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let j = 0; j < dim; j++) avg[j] += vec[j] / frames;
  }
  return avg;
}

// ─── Cosine Similarity ────────────────────────────────────────────────────────

/**
 * Numerically stable cosine similarity between two equal-length vectors. Returns 0–1.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  // Clamp to [0,1] to handle floating point errors
  return Math.max(0, Math.min(1, dot / denom));
}

// ─── Verification with Unregistered Rejection ─────────────────────────────────

export interface VerifyResult {
  matched: boolean;
  cattle: import('./db').Cattle | null;
  confidence: number;
  reason: 'MATCH' | 'BELOW_THRESHOLD' | 'UNREGISTERED' | 'NO_CATTLE_IN_DB';
}

/**
 * Find best matching cattle from all registered animals.
 * Returns UNREGISTERED if best score is below threshold.
 * Returns MATCH only if score exceeds threshold AND is a clear winner (margin check).
 */
export function findBestMatch(
  vec: number[],
  allCattle: import('./db').Cattle[],
  channel: 'muzzle' | 'retina' | 'face',
  threshold: number
): VerifyResult {
  if (!allCattle.length) {
    return { matched: false, cattle: null, confidence: 0, reason: 'NO_CATTLE_IN_DB' };
  }

  let bestCattle: import('./db').Cattle | null = null;
  let bestScore = 0;
  let secondBestScore = 0;

  for (const c of allCattle) {
    const emb = channel === 'muzzle' ? c.muzzleEmbedding
               : channel === 'retina' ? c.retinaEmbedding
               : c.faceEmbedding;
    if (!emb?.length) continue;

    const score = cosineSimilarity(vec, emb);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestCattle = c;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestCattle || bestScore < threshold) {
    return {
      matched: false,
      cattle: bestCattle,
      confidence: bestScore,
      reason: 'BELOW_THRESHOLD',
    };
  }

  // Margin check: best score must be meaningfully higher than second-best
  // (prevents ambiguous matches where two animals look similar)
  const margin = bestScore - secondBestScore;
  if (margin < 0.02 && secondBestScore > 0) {
    // Ambiguous — don't match
    return {
      matched: false,
      cattle: null,
      confidence: bestScore,
      reason: 'UNREGISTERED',
    };
  }

  return {
    matched: true,
    cattle: bestCattle,
    confidence: bestScore,
    reason: 'MATCH',
  };
}

// ─── Liveness Detection ───────────────────────────────────────────────────────

/**
 * Anti-spoofing: captures two frames 200ms apart, computes MSE.
 * Low MSE → static image (spoof). Returns true if subject appears live.
 */
export async function checkLiveness(
  frameSource: FrameSource
): Promise<boolean> {
  const tf = window.tf;
  const LIVENESS_THRESHOLD = 0.001;

  if (!(frameSource instanceof HTMLVideoElement)) {
    return true; // Static image fallback accepted
  }

  const captureFrame = () =>
    tf.tidy(() => {
      const pixels = tf.browser.fromPixels(frameSource as any);
      return tf.image
        .resizeBilinear(pixels as Parameters<typeof tf.image.resizeBilinear>[0], [64, 64])
        .toFloat()
        .div(tf.scalar(255.0));
    });

  const frame1 = captureFrame();
  await new Promise((r) => setTimeout(r, 200));
  const frame2 = captureFrame();

  const mse = tf.tidy(() => {
    const diff = (frame1 as { sub(t: unknown): unknown }).sub(frame2);
    return (diff as { square(): { mean(): unknown } }).square().mean();
  });

  const mseData = await (mse as { data(): Promise<Float32Array> }).data();
  const mseValue = mseData[0];

  ;(frame1 as { dispose(): void }).dispose();
  ;(frame2 as { dispose(): void }).dispose();
  ;(mse as { dispose(): void }).dispose();

  return mseValue > LIVENESS_THRESHOLD;
}

// ─── Frame Quality ────────────────────────────────────────────────────────────

/**
 * Quick frame quality score 0–1 based on brightness variance.
 */
export async function getFrameQuality(
  videoElement: HTMLVideoElement
): Promise<number> {
  const tf = window.tf;

  const scoreT = tf.tidy(() => {
    const pixels = tf.browser.fromPixels(videoElement);
    const gray = (pixels as { mean(axis: number): unknown }).mean(2);
    const floatGray = (gray as { toFloat(): { div(s: unknown): unknown } }).toFloat().div(tf.scalar(255.0));
    const mean = (floatGray as { mean(): unknown }).mean();
    const variance = (floatGray as { sub(t: unknown): { square(): { mean(): unknown } } })
      .sub(mean).square().mean();
    return variance;
  });

  const val = (await (scoreT as { data(): Promise<Float32Array> }).data())[0];
  ;(scoreT as { dispose(): void }).dispose();

  return Math.min(1.0, val / 0.05);
}
