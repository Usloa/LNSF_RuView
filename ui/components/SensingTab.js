/**
 * SensingTab — Live WiFi Sensing Visualization
 *
 * Connects to the sensing WebSocket service and renders:
 *   1. A 3D Gaussian-splat signal field (via gaussian-splats.js)
 *   2. An overlay HUD with real-time metrics (RSSI, variance, bands, classification)
 */

import { sensingService } from '../services/sensing.service.js';
import { GaussianSplatRenderer } from './gaussian-splats.js';

// The sensing socket carries two different message shapes on one connection:
// a ~40 Hz `sensing_update` (full frame) and a ~1 Hz per-node `edge_vitals`
// (a legacy packet with its own schema). Only the former is a full frame.
// Feeding the latter through the full-frame path blanked the entire panel once
// a second — RSSI fell back to -80, every bar went to zero, the classification
// read ABSENT, the node list read "No nodes detected" and the 3D body blob was
// hidden — then the next full frame restored it. That is the flicker.
const PAINT_INTERVAL_MS = 100;   // cap HUD repaint at 10 Hz
const SPARK_INTERVAL_MS = 250;   // one sparkline sample per 250 ms => 15 s window
const SPARK_MAX_SAMPLES = 60;

export class SensingTab {
  /** @param {HTMLElement} container - the #sensing section element */
  constructor(container) {
    this.container = container;
    this.splatRenderer = null;
    this._unsubData = null;
    this._unsubState = null;
    this._resizeObserver = null;
    this._threeLoaded = false;

    // Latest edge_vitals per node. Kept so the packet is not discarded by the
    // full-frame path; nothing renders it yet (that needs a UI decision).
    this._vitals = new Map();

    // Throttle state for the full-frame path.
    this._pendingSensing = null;
    this._paintTimer = null;
    this._lastPaintAt = 0;

    // Component-local sparkline buffer, sampled by time rather than per frame.
    this._sparkSamples = [];
    this._sparkLastAt = 0;

    // Reused node-status rows, keyed by node_id (never rebuilt per frame).
    this._nodeRows = new Map();
    this._nodeEmptyMsg = null;
  }

  async init() {
    this._buildDOM();
    await this._loadThree();
    this._initSplatRenderer();
    this._connectService();
    this._setupResize();
  }

  // ---- DOM construction --------------------------------------------------

  _buildDOM() {
    this.container.innerHTML = `
      <h2>Live WiFi Sensing</h2>

      <!-- Data-source status banner — updated by _onStateChange -->
      <div id="sensingSourceBanner" class="sensing-source-banner sensing-source-reconnecting"
           role="status" aria-live="polite">
        RECONNECTING...
      </div>

      <div class="sensing-layout">
        <!-- 3D viewport -->
        <div class="sensing-viewport" id="sensingViewport">
          <div class="sensing-loading">Loading 3D engine...</div>
        </div>

        <!-- Side panel -->
        <div class="sensing-panel">
          <!-- Connection -->
          <div class="sensing-card">
            <div class="sensing-card-title">Connection</div>
            <div class="sensing-connection">
              <span class="sensing-dot" id="sensingDot"></span>
              <span id="sensingState">Connecting...</span>
              <span class="sensing-source" id="sensingSource"></span>
            </div>
          </div>

          <!-- RSSI -->
          <div class="sensing-card">
            <div class="sensing-card-title">RSSI</div>
            <div class="sensing-big-value" id="sensingRssi">-- dBm</div>
            <canvas id="sensingSparkline" width="200" height="40"></canvas>
          </div>

          <!-- Signal Features -->
          <div class="sensing-card">
            <div class="sensing-card-title">Signal Features</div>
            <div class="sensing-meters">
              <div class="sensing-meter">
                <label>Variance</label>
                <div class="sensing-bar"><div class="sensing-bar-fill" id="barVariance"></div></div>
                <span class="sensing-meter-val" id="valVariance">0</span>
              </div>
              <div class="sensing-meter">
                <label>Motion Band</label>
                <div class="sensing-bar"><div class="sensing-bar-fill motion" id="barMotion"></div></div>
                <span class="sensing-meter-val" id="valMotion">0</span>
              </div>
              <div class="sensing-meter">
                <label>Breathing Band</label>
                <div class="sensing-bar"><div class="sensing-bar-fill breath" id="barBreath"></div></div>
                <span class="sensing-meter-val" id="valBreath">0</span>
              </div>
              <div class="sensing-meter">
                <label>Spectral Power</label>
                <div class="sensing-bar"><div class="sensing-bar-fill spectral" id="barSpectral"></div></div>
                <span class="sensing-meter-val" id="valSpectral">0</span>
              </div>
            </div>
          </div>

          <!-- Classification -->
          <div class="sensing-card">
            <div class="sensing-card-title">Classification</div>
            <div class="sensing-classification" id="sensingClassification">
              <div class="sensing-class-label" id="classLabel">ABSENT</div>
              <div class="sensing-confidence">
                <label>Confidence</label>
                <div class="sensing-bar"><div class="sensing-bar-fill confidence" id="barConfidence"></div></div>
                <span class="sensing-meter-val" id="valConfidence">0%</span>
              </div>
            </div>
          </div>

          <!-- Setup info -->
          <div class="sensing-card">
            <div class="sensing-card-title">About This Data</div>
            <p class="sensing-about-text">
              Metrics are computed from WiFi Channel State Information (CSI).
              With <strong><span id="sensingNodeCount">0</span> ESP32 node(s)</strong> you get presence detection, breathing
              estimation, and gross motion. Add <strong>3-4+ ESP32 nodes</strong>
              around the room for spatial resolution and limb-level tracking.
            </p>
          </div>

          <!-- Node Status -->
          <div class="sensing-card" id="sensingNodeCards">
            <div class="sensing-card-title">NODE STATUS</div>
            <div id="nodeStatusContainer"></div>
          </div>

          <!-- Extra info -->
          <div class="sensing-card">
            <div class="sensing-card-title">Details</div>
            <div class="sensing-details">
              <div class="sensing-detail-row">
                <span>Dominant Freq</span><span id="valDomFreq">0 Hz</span>
              </div>
              <div class="sensing-detail-row">
                <span>Change Points</span><span id="valChangePoints">0</span>
              </div>
              <div class="sensing-detail-row">
                <span>Sample Rate</span><span id="valSampleRate">--</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Three.js loading --------------------------------------------------

  async _loadThree() {
    if (window.THREE) {
      this._threeLoaded = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = () => {
        this._threeLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Three.js'));
      document.head.appendChild(script);
    });
  }

  // ---- Splat renderer ----------------------------------------------------

  _initSplatRenderer() {
    const viewport = this.container.querySelector('#sensingViewport');
    if (!viewport) return;

    // Remove loading message
    viewport.innerHTML = '';

    try {
      this.splatRenderer = new GaussianSplatRenderer(viewport, {
        width: viewport.clientWidth,
        height: viewport.clientHeight || 500,
      });
    } catch (e) {
      console.error('[SensingTab] Failed to init splat renderer:', e);
      viewport.innerHTML = '<div class="sensing-loading">3D rendering unavailable</div>';
    }
  }

  // ---- Service connection ------------------------------------------------

  _connectService() {
    sensingService.start();

    this._unsubData = sensingService.onData((data) => this._onSensingData(data));
    this._unsubState = sensingService.onStateChange((state) => this._onStateChange(state));
  }

  _onSensingData(data) {
    if (!data) return;

    // Dispatch by message type. Unknown/absent `type` still flows through as a
    // full frame so older servers keep working; only packets we positively know
    // to be a different shape are diverted.
    const type = data.type;
    if (type === 'edge_vitals') {
      const id = data.node_id != null ? data.node_id : 'unknown';
      this._vitals.set(id, data);
      return;
    }
    if (type && type !== 'sensing_update') return;

    // Coalesce to the newest frame at <=10 Hz. The trailing timer keeps the
    // last frame from being dropped, so the panel never settles on stale values.
    this._pendingSensing = data;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const since = now - this._lastPaintAt;
    if (since >= PAINT_INTERVAL_MS) {
      this._paintSensing();
    } else if (!this._paintTimer) {
      this._paintTimer = setTimeout(() => {
        this._paintTimer = null;
        this._paintSensing();
      }, PAINT_INTERVAL_MS - since);
    }
  }

  _paintSensing() {
    const data = this._pendingSensing;
    if (!data) return;
    this._pendingSensing = null;
    this._lastPaintAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Update 3D view
    if (this.splatRenderer) {
      this.splatRenderer.update(data);
    }

    // Update HUD
    this._updateHUD(data);

    // Update per-node panels
    this._updateNodePanels(data);
  }

  _onStateChange(state) {
    const dot    = this.container.querySelector('#sensingDot');
    const text   = this.container.querySelector('#sensingState');
    const banner = this.container.querySelector('#sensingSourceBanner');

    if (dot && text) {
      const stateLabels = {
        disconnected: 'Disconnected',
        connecting:   'Connecting...',
        connected:    'Connected',
        reconnecting: 'Reconnecting...',
        simulated:    'Simulated',
        'auth-required': 'API token required',
      };
      dot.className = 'sensing-dot ' + state;
      text.textContent = stateLabels[state] || state;
    }

    if (banner) {
      // Map the service's dataSource to banner text and CSS modifier class.
      const dataSource = sensingService.dataSource;
      const bannerConfig = {
        'live':              { text: 'LIVE \u2014 ESP32 HARDWARE',           cls: 'sensing-source-live' },
        'server-simulated':  { text: 'SIMULATED \u2014 NO HARDWARE',        cls: 'sensing-source-server-sim' },
        'reconnecting':      { text: 'RECONNECTING...',                    cls: 'sensing-source-reconnecting' },
        'unreachable':       { text: 'NO DATA \u2014 SERVER UNREACHABLE',   cls: 'sensing-source-simulated' },
        'simulated':         { text: 'INVENTED DATA \u2014 NOT MEASURED',   cls: 'sensing-source-simulated' },
        'auth-required':     { text: 'API TOKEN REQUIRED \u2014 SETTINGS \u2192 API ACCESS', cls: 'sensing-source-simulated' },
      };
      const cfg = bannerConfig[dataSource] || bannerConfig.reconnecting;
      banner.textContent = cfg.text;
      banner.className = 'sensing-source-banner ' + cfg.cls;
    }
  }

  // ---- HUD update --------------------------------------------------------

  // Every write below is conditional on the field actually being present. A
  // missing field must leave the last known value on screen, never render a
  // substitute (-80 dBm, 0 %, ABSENT) that reads as a fresh measurement.
  _updateHUD(data) {
    const f = data.features || null;
    const c = data.classification || null;

    // Node count
    if (Array.isArray(data.nodes)) {
      const countEl = this.container.querySelector('#sensingNodeCount');
      if (countEl) countEl.textContent = String(data.nodes.length);
    }

    if (f) {
      if (f.mean_rssi != null) this._setText('sensingRssi', `${f.mean_rssi.toFixed(1)} dBm`);

      // Bars (scale to 0-100%)
      this._setBar('barVariance', f.variance, 10, 'valVariance', f.variance);
      this._setBar('barMotion', f.motion_band_power, 0.5, 'valMotion', f.motion_band_power);
      this._setBar('barBreath', f.breathing_band_power, 0.3, 'valBreath', f.breathing_band_power);
      this._setBar('barSpectral', f.spectral_power, 2.0, 'valSpectral', f.spectral_power);

      if (f.dominant_freq_hz != null) {
        this._setText('valDomFreq', f.dominant_freq_hz.toFixed(3) + ' Hz');
      }
      if (f.change_points != null) {
        this._setText('valChangePoints', String(f.change_points));
      }

      // Sparkline sample (time-sampled, see _sampleSparkline)
      if (f.mean_rssi != null) this._sampleSparkline(f.mean_rssi);
    }

    if (data.source != null) this._setText('sensingSource', data.source);

    if (c) {
      const label = this.container.querySelector('#classLabel');
      if (label && c.motion_level) {
        label.textContent = c.motion_level.toUpperCase();
        label.className = 'sensing-class-label ' + c.motion_level;
      }
      if (c.confidence != null) {
        this._setBar('barConfidence', c.confidence, 1.0, 'valConfidence',
          (c.confidence * 100).toFixed(0) + '%');
      }
    }

    const srcLabel = (data.source === 'simulated' || data.source === 'simulate') ? 'sim' : data.source;
    if (srcLabel) this._setText('valSampleRate', srcLabel);

    this._drawSparkline();
  }

  _sampleSparkline(rssi) {
    const now = Date.now();
    if (now - this._sparkLastAt < SPARK_INTERVAL_MS) return;
    this._sparkLastAt = now;
    this._sparkSamples.push(rssi);
    if (this._sparkSamples.length > SPARK_MAX_SAMPLES) this._sparkSamples.shift();
  }

  _setText(id, text) {
    const el = this.container.querySelector('#' + id);
    if (el) el.textContent = text;
  }

  _setBar(barId, value, maxVal, valId, displayVal) {
    // A missing value must not collapse the bar to 0 % — that reads as a
    // measurement of zero rather than as "no data in this frame".
    if (value == null) return;
    const bar = this.container.querySelector('#' + barId);
    if (bar) {
      const pct = Math.min(100, Math.max(0, (value / maxVal) * 100));
      bar.style.width = pct + '%';
    }
    if (valId && displayVal != null) {
      const el = this.container.querySelector('#' + valId);
      if (el) el.textContent = typeof displayVal === 'number' ? displayVal.toFixed(3) : displayVal;
    }
  }

  _drawSparkline() {
    const canvas = this.container.querySelector('#sensingSparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const history = this._sparkSamples;
    if (history.length < 2) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...history) - 2;
    const max = Math.max(...history) + 2;
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = '#32b8c6';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < history.length; i++) {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((history[i] - min) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ---- Per-node panels ---------------------------------------------------

  // Rows are created once per node_id and then updated in place. Rebuilding
  // them per frame (as this used to) threw away and recreated every element
  // ~40 times a second, which made the whole card flicker on its own.
  _updateNodePanels(data) {
    const container = this.container.querySelector('#nodeStatusContainer');
    if (!container) return;
    // A frame that carries no per-node array says nothing about the nodes we
    // already know about, so leave the card alone instead of emptying it.
    if (!Array.isArray(data.node_features)) return;

    const nodeFeatures = data.node_features;
    if (nodeFeatures.length === 0) {
      if (this._nodeEmptyMsg && container.contains(this._nodeEmptyMsg)) return;
      this._nodeRows.clear();
      container.textContent = '';
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#888;font-size:12px;padding:8px;';
      msg.textContent = 'No nodes detected';
      container.appendChild(msg);
      this._nodeEmptyMsg = msg;
      return;
    }

    if (this._nodeEmptyMsg) {
      this._nodeEmptyMsg.remove();
      this._nodeEmptyMsg = null;
    }

    const active = new Set();
    for (const nf of nodeFeatures) {
      active.add(nf.node_id);
      let row = this._nodeRows.get(nf.node_id);
      if (!row) {
        row = this._createNodeRow(nf.node_id);
        this._nodeRows.set(nf.node_id, row);
        container.appendChild(row.el);
      }

      row.statusEl.textContent = nf.stale ? 'STALE' : 'ACTIVE';
      row.statusEl.style.color = nf.stale ? '#888' : '#0f0';

      // Only overwrite what the frame actually carries.
      if (nf.rssi_dbm != null) {
        const variance = nf.features?.variance;
        row.metricsEl.textContent = nf.rssi_dbm.toFixed(0) + ' dBm' +
          (variance != null ? ' · var ' + variance.toFixed(1) : '');
      }
      const level = nf.classification?.motion_level;
      const conf = nf.classification?.confidence;
      if (level || conf != null) {
        row.classEl.textContent = (level ? level.toUpperCase() : '') +
          (conf != null ? ' ' + (conf * 100).toFixed(0) + '%' : '');
      }
    }

    for (const [id, row] of this._nodeRows) {
      if (!active.has(id)) {
        row.el.remove();
        this._nodeRows.delete(id);
      }
    }
  }

  _createNodeRow(nodeId) {
    const NODE_COLORS = ['#00ccff', '#ff6600', '#00ff88', '#ff00cc', '#ffcc00', '#8800ff', '#00ffcc', '#ff0044'];
    const color = NODE_COLORS[nodeId % NODE_COLORS.length];

    const el = document.createElement('div');
    el.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:rgba(255,255,255,0.03);border-radius:6px;border-left:3px solid ${color};`;

    const idCol = document.createElement('div');
    idCol.style.minWidth = '50px';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size:11px;font-weight:600;color:${color};`;
    nameEl.textContent = 'Node ' + nodeId;
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-size:9px;color:#0f0;';
    statusEl.textContent = 'ACTIVE';
    idCol.appendChild(nameEl);
    idCol.appendChild(statusEl);

    const metricsEl = document.createElement('div');
    metricsEl.style.cssText = 'flex:1;font-size:10px;color:#aaa;';

    const classEl = document.createElement('div');
    classEl.style.cssText = 'font-size:10px;font-weight:600;color:#ccc;';

    el.appendChild(idCol);
    el.appendChild(metricsEl);
    el.appendChild(classEl);

    return { el, statusEl, metricsEl, classEl };
  }

  // ---- Resize ------------------------------------------------------------

  _setupResize() {
    const viewport = this.container.querySelector('#sensingViewport');
    if (!viewport || !window.ResizeObserver) return;

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (this.splatRenderer) {
          this.splatRenderer.resize(entry.contentRect.width, entry.contentRect.height);
        }
      }
    });
    this._resizeObserver.observe(viewport);
  }

  // ---- Cleanup -----------------------------------------------------------

  dispose() {
    if (this._unsubData) this._unsubData();
    if (this._unsubState) this._unsubState();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._paintTimer) {
      clearTimeout(this._paintTimer);
      this._paintTimer = null;
    }
    if (this.splatRenderer) this.splatRenderer.dispose();
    sensingService.stop();
  }
}
