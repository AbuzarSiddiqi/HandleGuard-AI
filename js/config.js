// HandleGuard AI - global configuration, behaviour taxonomy, risk model
export const CFG = {
  W: 960, H: 540,
  SCENE_HEIGHT_M: 2.2,          // vertical meters represented by full frame height
  FLOOR_BOTTOM: 0.90,           // normalized y where resting objects sit (bottom edge)
  MIN_DET_SCORE: 0.45,
  PERSON_SCORE: 0.50,
  ANALYSIS_MS: 110,             // analysis cadence for real video
  COAST_S: 1.2,                 // seconds a track survives without detections (smoothed)
  MAX_EVENTS: 300,
};

export const ZONES = {
  stage: { name: 'Staging Area', x0: 0.04, y0: 0.60, x1: 0.36, y1: 0.895, color: '#4c9ffe' },
  dock:  { name: 'Dock / Vehicle', x0: 0.64, y0: 0.52, x1: 0.97, y1: 0.895, color: '#f5a524' },
};

export const SEVERITY = {
  good:     { label: 'Good Practice', color: '#2fbf71', rank: 0 },
  low:      { label: 'Low Risk',      color: '#4c9ffe', rank: 1 },
  medium:   { label: 'Medium Risk',   color: '#f5a524', rank: 2 },
  high:     { label: 'High Risk',     color: '#f76b15', rank: 3 },
  critical: { label: 'Critical Risk', color: '#ff3b30', rank: 4 },
};

export function severityFor(score) {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// Behaviour taxonomy: calibrated base risk points, corrective action, training topic
export const BEHAVIOURS = {
  BOX_DROP: {
    label: 'Product dropped from height', base: 50,
    corrective: 'Lift and place products gently. Never throw or drop a package while loading or unloading. Inspect product before dispatch.',
    training: 'Safe lifting & placement practice',
  },
  THROW: {
    label: 'Product thrown', base: 56,
    corrective: 'Lift and place products gently - never throw a package. Move product using a trolley or carry with both hands.',
    training: 'Handling discipline at transfer points',
  },
  DRAG: {
    label: 'Carton dragged on floor', base: 38,
    corrective: 'Use a trolley, pallet truck or suitable handling equipment instead of dragging products on the floor.',
    training: 'Equipment-first movement policy',
  },
  ROUGH_IMPACT: {
    label: 'Rough handling / hard impact', base: 42,
    corrective: 'Handle every product in a controlled manner, particularly at transfer points. Avoid hard contact with floor or racks.',
    training: 'Careful transfer-point handling',
  },
  IMPROPER_STACK: {
    label: 'Improper stacking (large/heavy placed on smaller packet)', base: 44,
    corrective: 'Stack larger and heavier packets at the bottom and smaller/lighter packets on top. Ensure the complete packet is supported.',
    training: 'Stacking sequence rules',
  },
  UNSTABLE_STACK: {
    label: 'Unstable / overhanging stack', base: 46,
    corrective: 'Align the stack within the lower packet edges so the complete packet is supported; rebuild the unstable stack.',
    training: 'Stack alignment & support',
  },
  COLLAPSE_RISK: {
    label: 'Stack collapse risk', base: 66,
    corrective: 'Stop loading in this area. Rebuild the stack with full bottom support and even weight distribution.',
    training: 'Stack height & overhang limits',
  },
  OUT_OF_ZONE: {
    label: 'Product outside designated area', base: 25,
    corrective: 'Stage products systematically according to size, weight, sequence and the vehicle loading plan.',
    training: 'Staging discipline',
  },
  NO_EQUIPMENT: {
    label: 'Heavy product carried manually without equipment', base: 34,
    corrective: 'Use team lifting or suitable mechanical handling equipment (trolley / pallet truck) for heavy products.',
    training: 'Manual handling limits',
  },
  STEP_ON: {
    label: 'Stepping / standing on carton', base: 50,
    corrective: 'Never step, stand or walk on packages. Keep a clear working path around the material.',
    training: 'Floor discipline',
  },
  ROLLING: {
    label: 'Carton / product rolled on floor', base: 34,
    corrective: 'Carry or move products using appropriate material-handling equipment; do not roll products unless designed for it.',
    training: 'Movement method standards',
  },
  OVERREACH: {
    label: 'Loading above safe reach height', base: 36,
    corrective: 'Use a suitable platform, ladder or equipment for placement above shoulder height. Do not stretch-load overhead.',
    training: 'Safe reach & placement',
  },
  PALLET_OVERHANG: {
    label: 'Product larger than pallet support', base: 42,
    corrective: 'Use the correct-size pallet or trolley so that the entire product is properly supported without unsafe overhang.',
    training: 'Pallet selection rules',
  },
  PALLET_MISPLACE: {
    label: 'Pallet positioned incorrectly', base: 30,
    corrective: 'Position pallets inside the designated staging / dock footprint, clear of walkways.',
    training: 'Staging discipline',
  },
  GOOD_PLACE: {
    label: 'Correct gentle placement', base: 0, good: true,
    corrective: '', training: '',
  },
};

export const PRODUCT_CLASSES = {
  person:   { label: 'Person', color: '#4c9ffe' },
  carton:   { label: 'Carton', color: '#d29a5b', fragile: false },
  mattress: { label: 'Mattress', color: '#8fd3ff', fragile: true },
  pallet:   { label: 'Pallet', color: '#a97c50' },
  trolley:  { label: 'Trolley', color: '#9aa7b4' },
  object:   { label: 'Object', color: '#b48fe0' },
};

// COCO classes that we treat as carton-like objects in real-footage mode
export const COCO_CARTON_CLASSES = ['suitcase', 'backpack', 'handbag', 'book', 'box'];

export const BAYS = ['Bay 1', 'Bay 2', 'Bay 3'];
