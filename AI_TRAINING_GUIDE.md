# 🐄 Cattle Biometric AI — Training Guide
## How to Train a Custom Model for Kisan-Drishti

---

## Step 1: Prepare Your Dataset

### Required Folder Structure
```
dataset/
├── muzzle/          ← Nose/muzzle photos
│   ├── COW_001/     ← One folder per cattle
│   │   ├── img1.jpg
│   │   ├── img2.jpg
│   │   └── ...      (minimum 5, ideal 20+ photos)
│   ├── COW_002/
│   └── ...
├── retina/          ← Eye photos
│   ├── COW_001/
│   └── ...
└── face/            ← Full face photos
    ├── COW_001/
    └── ...
```

### Photo Guidelines
| Channel | Distance | Lighting | Angle |
|---------|---------|---------|-------|
| Muzzle  | 10-20cm  | Natural/flash | Straight-on |
| Retina  | 15-30cm  | Natural | Level with eye |
| Face    | 50-100cm | Natural | Straight-on |

### Minimum Requirements
- Minimum **50 different cattle**
- At least **5 photos per cattle per channel**
- JPG or PNG format, any resolution (will be resized to 224×224)
- Images MUST be labeled by folder (folder name = cattle ID)

---

## Step 2: Run Training on Google Colab (Free GPU)

Go to: https://colab.research.google.com

Create a new notebook and paste this code:

```python
# ============================================================
# Kisan-Drishti Cattle Biometric Model Training
# Run on Google Colab (free T4 GPU)
# ============================================================

# Install dependencies
!pip install tensorflow tensorflow-hub scikit-learn numpy pillow

import os, numpy as np, tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
from sklearn.model_selection import train_test_split
import tensorflow_hub as hub
from PIL import Image

# ── Config ──────────────────────────────────────────────────
CHANNEL = "muzzle"    # Change to "retina" or "face"
DATASET_PATH = "/content/drive/MyDrive/cattle_dataset"
IMG_SIZE = 224
BATCH_SIZE = 32
EPOCHS = 30
EMBEDDING_DIM = 512

# ── Mount Google Drive ───────────────────────────────────────
from google.colab import drive
drive.mount('/content/drive')

# ── Load Dataset ─────────────────────────────────────────────
def load_dataset(path, channel):
    images, labels, cattle_ids = [], [], []
    label_map = {}
    label_idx = 0
    channel_path = os.path.join(path, channel)
    
    for cattle_id in sorted(os.listdir(channel_path)):
        cattle_dir = os.path.join(channel_path, cattle_id)
        if not os.path.isdir(cattle_dir):
            continue
        if cattle_id not in label_map:
            label_map[cattle_id] = label_idx
            label_idx += 1
        
        for fname in os.listdir(cattle_dir):
            if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                img_path = os.path.join(cattle_dir, fname)
                img = Image.open(img_path).convert('RGB').resize((IMG_SIZE, IMG_SIZE))
                images.append(np.array(img) / 255.0)
                labels.append(label_map[cattle_id])
                cattle_ids.append(cattle_id)
    
    print(f"Loaded {len(images)} images across {label_idx} cattle")
    return np.array(images, dtype=np.float32), np.array(labels), label_map

X, y, label_map = load_dataset(DATASET_PATH, CHANNEL)
NUM_CLASSES = len(label_map)

X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, stratify=y)

# ── Build Model (MobileNetV2 fine-tuned) ─────────────────────
base_model = keras.applications.MobileNetV2(
    input_shape=(IMG_SIZE, IMG_SIZE, 3),
    include_top=False,
    weights='imagenet'
)
base_model.trainable = False  # Freeze for initial training

inputs = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3))
x = base_model(inputs, training=False)
x = layers.GlobalAveragePooling2D()(x)
x = layers.Dense(EMBEDDING_DIM, activation='relu', name='embedding')(x)
x = layers.L2Normalization()(x)  # Normalize for cosine similarity
outputs = layers.Dense(NUM_CLASSES, activation='softmax')(x)

model = keras.Model(inputs, outputs)
model.compile(
    optimizer=keras.optimizers.Adam(1e-3),
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

# ── Train Phase 1 (Frozen base) ──────────────────────────────
history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=15,
    batch_size=BATCH_SIZE,
    callbacks=[keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True)]
)

# ── Train Phase 2 (Fine-tune top layers) ─────────────────────
base_model.trainable = True
for layer in base_model.layers[:-30]:  # Freeze all but last 30 layers
    layer.trainable = False

model.compile(
    optimizer=keras.optimizers.Adam(1e-5),
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

history2 = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=EPOCHS,
    batch_size=BATCH_SIZE // 2,
    callbacks=[keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True)]
)

print(f"Final validation accuracy: {max(history2.history['val_accuracy']):.1%}")

# ── Convert to TensorFlow.js ─────────────────────────────────
!pip install tensorflowjs

import tensorflowjs as tfjs
output_dir = f"/content/kisan_drishti_{CHANNEL}_model"
tfjs.converters.save_keras_model(model, output_dir)
print(f"Model saved to {output_dir}")
print("Download the folder and place it in your app's /public directory")

# ── Download ─────────────────────────────────────────────────
import shutil
shutil.make_archive(f"/content/kisan_{CHANNEL}_model", 'zip', output_dir)
from google.colab import files
files.download(f"/content/kisan_{CHANNEL}_model.zip")
```

---

## Step 3: Integrate Custom Model into the App

After downloading the model zip:

1. Extract to `public/models/muzzle/` (or `retina/`, `face/`)
2. Update `src/ai.ts` to load from local path:

```typescript
// In ai.ts, replace CDN MobileNet with your custom model:
const MODEL_URLS = {
  muzzle: '/models/muzzle/model.json',
  retina: '/models/retina/model.json',
  face: '/models/face/model.json',
};

// Load channel-specific model
async function loadChannelModel(channel: string) {
  return await window.tf.loadLayersModel(MODEL_URLS[channel]);
}
```

---

## Step 4: Firebase Integration (When Ready)

### What you'll need:
1. Go to https://console.firebase.google.com
2. Create project: `kisan-drishti`
3. Enable:
   - **Authentication** → Phone (OTP login)
   - **Firestore** → Database (cattle records sync)
   - **Storage** → For cattle photos
4. Copy your `firebaseConfig` and share it with the developer

### Config format:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "kisan-drishti.firebaseapp.com",
  projectId: "kisan-drishti",
  storageBucket: "kisan-drishti.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:XXXXXXXXXXXXXXXX"
};
```

---

## What to Provide Next

| Priority | What to provide | For what |
|----------|----------------|---------|
| 🔴 High | Cattle photos (labeled folders) | Custom AI training |
| 🔴 High | Number of cattle in dataset | Training estimation |
| 🟡 Medium | Firebase config | Cloud sync |
| 🟡 Medium | Firebase project name | Backend setup |
| 🟢 Low | Domain name | Deployment |
| 🟢 Low | Google Cloud billing access | AutoML Vision (advanced) |
