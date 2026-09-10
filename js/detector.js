// Real-footage detector: TensorFlow.js COCO-SSD (bundled locally, works offline)
import { CFG, COCO_CARTON_CLASSES } from './config.js';

let model = null;

export async function loadModel() {
  if (model) return model;
  await tf.ready();
  model = await cocoSsd.load({
    base: 'lite_mobilenet_v2',
    modelUrl: 'vendor/model/model.json',
  });
  return model;
}

export function modelReady() { return !!model; }

function classify(cocoClass) {
  if (cocoClass === 'person') return { label: 'person', cls: 'person' };
  if (COCO_CARTON_CLASSES.includes(cocoClass)) return { label: 'carton', cls: 'carton' };
  return { label: 'object', cls: 'object' };
}

// returns normalized detections [{label, cls, x, y, w, h, score, coco}]
export async function detectFrame(videoEl) {
  if (!model) return [];
  const vw = videoEl.videoWidth || CFG.W, vh = videoEl.videoHeight || CFG.H;
  const res = await model.detect(videoEl, 12, 0.35);
  const dets = [];
  for (const r of res) {
    const isPerson = r.class === 'person';
    const thr = isPerson ? CFG.PERSON_SCORE : CFG.MIN_DET_SCORE;
    if (r.score < thr) continue;
    const { label, cls } = classify(r.class);
    const [bx, by, bw, bh] = r.bbox;
    dets.push({
      label, cls, coco: r.class, score: r.score,
      x: bx / vw, y: by / vh, w: bw / vw, h: bh / vh,
    });
  }
  return dets;
}
