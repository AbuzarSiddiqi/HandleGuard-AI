# HandleGuard AI 🛡️
### Edge-Intelligent CCTV Vision System for Warehouse Rough Handling & In-Transit Damage Prevention

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Node.js](https://img.shields.io/badge/Runtime-Node.js-green.svg)](https://nodejs.org/)
[![Inference: Edge%20Native](https://img.shields.io/badge/Inference-Edge%20Native%20(Sub--60ms)-brightgreen.svg)]()
[![Privacy: ISO%20%26%20GDPR](https://img.shields.io/badge/Privacy-Biometric%20Obfuscation-blueviolet.svg)]()

---

## 📌 Executive Summary
**HandleGuard AI** is an on-premise, zero-cloud-latency computer vision intelligence platform engineered for logistics distribution centers and warehouse loading docks. By analyzing CCTV and IP camera streams in real time, HandleGuard AI automatically identifies rough package handling, enforces handling Standard Operating Procedures (SOPs), and prevents in-transit damage before merchandise is dispatched.

---

## 🚀 Key Features

* **Sub-60ms Edge Inference**: 100% on-premise client/edge execution with WebAssembly and WebGL acceleration. No recurring cloud GPU bills or external streaming latency.
* **12-Rule Kinematic & Ballistic Taxonomy**:
  * **Product Throws (`THROW`)**: Parabolic separation velocity tracking ($|v_x| \ge 0.55\text{ m/s}$) that detects horizontal and upward throws onto elevated vehicle stacks.
  * **Drops & Heavy Impacts (`BOX_DROP`)**: Deceleration spike tracking from dock heights $>0.8\text{m}$.
  * **Friction Dragging (`DRAG`)**: Sustained floor contact during horizontal transit.
  * **Carton Rolling (`ROLLING`)**: End-over-end tumbling on dock surfaces.
  * **Stepping on Goods (`STEP_ON`)**: Foot boundary contact overlap on package surfaces.
  * **Improper Stacking (`IMPROPER_STACK`)**: Inverted stacking (heavy items over fragile items) and leaning stacks.
  * **Ergonomics & Safety (`OVERREACH`, `HEAVY_SOLO`, `NO_EQUIPMENT`)**: Posture evaluation and solo heavy appliance lift warnings.
  * **Dock Moisture Risks (`WET_FLOOR_DRAG`)**: Merchandise dragged across saturated pavements.
* **1-Click Instant Snippet Replay**: Clicking any logged event card in the Live Stream sidebar or Events Table immediately seeks the video back $3.5\text{s}$ before the violation and replays through $4.0\text{s}$ after with an on-screen HUD badge.
* **Biometric Privacy Obfuscation**: Automated facial and operator blurring filter preserving full privacy compliance with ISO 27001 and GDPR.
* **AI Supervisor Copilot**: Grounded conversational assistant answering root-cause inquiries and issuing instant SOP corrective protocols.
* **Executive Pitch Deck Built-In**: Interactive 5-slide presentation deck accessible directly at `http://localhost:8093/slides.html` (or [SLIDES.md](SLIDES.md)).

---

## 🎬 Verified Sample Scenarios

All 7 warehouse sample clips are included in the repository under `samples/`:

| Video File | Scenario | Detection Result |
| :--- | :--- | :--- |
| `throwing-mattresses.mp4` | Throwing mattresses into truck bed | **CRITICAL THROW** (Ballistic separation arc) |
| `throwing-strap.mp4` | Throwing seating cartons & strap lifts | **CRITICAL THROW** |
| `rolling-dropping-carton.mp4` | Rolling and dropping carton off dock | **HIGH BOX_DROP + ROLLING** |
| `stepping-stacking.mp4` | Stepping on cartons / heavy box on top | **CRITICAL STEP_ON** |
| `kd-dragged-stacking.mp4` | KD furniture packets dragged on floor | **HIGH DRAG + IMPROPER_STACK** |
| `dock-dragging.mp4` | Dragging cupboard without pallet truck | **HIGH DRAG + NO_EQUIPMENT** |
| `wet-floor.mp4` | Dragging cartons on wet pavement | **HIGH WET_FLOOR_DRAG** |

---

## 🛠️ Quick Start Guide

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v16+ recommended)
* A modern Chromium-based browser (Chrome, Edge, Brave) or Safari

### 2. Run Locally
```bash
# Clone the repository
git clone <YOUR_REPO_URL>
cd HandleGuard-AI

# Start the zero-dependency local static server
node server.js
```

### 3. Open in Browser
* **Main Operations Console**: [`http://localhost:8093`](http://localhost:8093)
* **Executive Slide Deck**: [`http://localhost:8093/slides.html`](http://localhost:8093/slides.html)

---

## 📁 Repository Structure

```
HandleGuard-AI/
├── index.html           # Main Operations Console UI & CCTV Telemetry HUD
├── slides.html          # Interactive 5-Slide Executive Pitch Deck Web App
├── SLIDES.md            # Comprehensive Presentation Script & Architecture Spec
├── server.js            # Lightweight Node.js server with HTTP Range stream seeking
├── package.json         # Project metadata
├── README.md            # Project documentation
├── css/
│   └── style.css        # Obsidian Void Glassmorphic Enterprise Design System
├── js/
│   ├── app.js           # Core pipeline, telemetry loop & snippet replay controller
│   ├── tracker.js       # Spatio-temporal object tracker & ballistic throw engine
│   ├── behaviours.js    # 12-rule physics engine & transparent risk scoring model
│   ├── motion.js        # Dense optical flow & adjacent blob clustering
│   ├── store.js         # Event store, localStorage persistence & subscriptions
│   ├── copilot.js       # Grounded RAG SOP assistant & root-cause reasoning
│   ├── dashboard.js     # Operations KPIs, SVG charts & shift telemetry
│   ├── scenarios.js     # Synthetic benchmark scenarios
│   └── config.js        # System calibration, thresholds & camera zone layouts
├── samples/             # 7 Sample CCTV pilot videos (MP4)
└── vendor/              # Offline TensorFlow.js & COCO-SSD models
```

---

## 🔒 Confidentiality & Intellectual Property
*HandleGuard AI — Enterprise Autonomous Warehouse Handling & In-Transit Damage Prevention System.*  
*All rights reserved.*
