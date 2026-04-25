/* ============================================================
   DIGITAL BLOOM GARDEN — script.js
   Procedural flower animation using HTML Canvas 2D.

   Architecture:
     Particle    — floating pollen/dust motes
     Flower      — holds state for one bloom (petals, stem, sway)
     Garden      — scene manager, render loop, event wiring
   ============================================================ */

'use strict';

// ============================================================
// § UTILITIES
// ============================================================

/** Clamp v between min and max */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Linear interpolation */
const lerp  = (a, b, t) => a + (b - a) * t;

/** Random float in [min, max] */
const rand  = (min, max) => min + Math.random() * (max - min);

/** Random integer in [min, max] inclusive */
const randInt = (min, max) => Math.floor(rand(min, max + 1));

/** Pick a random element from an array */
const randFrom = arr => arr[Math.floor(Math.random() * arr.length)];

/** Convert a hex color string to {r,g,b} */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

/** Lighten a hex color by `amt` (0-255) */
function lighten(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgb(${clamp(c.r+amt,0,255)},${clamp(c.g+amt,0,255)},${clamp(c.b+amt,0,255)})`;
}

/** Darken a hex color by `amt` (0-255) */
function darken(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgb(${clamp(c.r-amt,0,255)},${clamp(c.g-amt,0,255)},${clamp(c.b-amt,0,255)})`;
}


// ============================================================
// § EASING FUNCTIONS
//   All take t in [0,1] and return a value (mostly) in [0,1].
// ============================================================

/**
 * easeOutBack — overshoots slightly then settles.
 * Gives petals a satisfying "spring open" feeling.
 * The constant c1 controls the magnitude of overshoot.
 */
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * easeOutCubic — smooth deceleration.
 * Used for the "unfurling" Y-scale so it doesn't overshoot.
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * easeInOutCubic — smooth S-curve.
 * Used for transitions that need symmetrical acceleration.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


// ============================================================
// § FLOWER TYPE DEFINITIONS
//   Each type specifies petal geometry and a palette of
//   color sets to choose from when a flower is created.
// ============================================================

const FLOWER_TYPES = [

  // ── POPPY (4–5 large rounded petals, bold color) ──────────
  {
    id: 'poppy',
    petalCount: 5,
    petalLength: 44,
    petalWidth:  34,
    centerRadius: 10,
    colorSets: [
      { base:'#e02828', mid:'#ff5050', tip:'#ff9090', edge:'#b81818', center:'#1a0800' },
      { base:'#ff6010', mid:'#ff9040', tip:'#ffbc78', edge:'#c84000', center:'#1a0800' },
      { base:'#e01860', mid:'#ff4888', tip:'#ffaacc', edge:'#b01050', center:'#1a0800' },
    ],
  },

  // ── DAISY (many thin petals, cheerful) ───────────────────
  {
    id: 'daisy',
    petalCount: 14,
    petalLength: 50,
    petalWidth:  11,
    centerRadius: 13,
    colorSets: [
      { base:'#f8f8f0', mid:'#ffffff', tip:'#f0f0e4', edge:'#c8c8b8', center:'#f0c018' },
      { base:'#fff0c0', mid:'#fff8d8', tip:'#ffe890', edge:'#e0c070', center:'#f0a018' },
      { base:'#ffb0cc', mid:'#ffd4e2', tip:'#ffe8f0', edge:'#d49090', center:'#f0dc40' },
    ],
  },

  // ── COSMOS (8 broad petals, romantic/delicate) ───────────
  {
    id: 'cosmos',
    petalCount: 8,
    petalLength: 48,
    petalWidth:  24,
    centerRadius: 9,
    colorSets: [
      { base:'#ff4480', mid:'#ff7aaa', tip:'#ffb0cc', edge:'#cc2860', center:'#ffcc30' },
      { base:'#c050f0', mid:'#da80ff', tip:'#eeaaff', edge:'#9030c0', center:'#ffcc30' },
      { base:'#ff8840', mid:'#ffaa70', tip:'#ffcc98', edge:'#cc5820', center:'#ffe030' },
    ],
  },

  // ── WILDFLOWER (6 petals, simple & bright) ───────────────
  {
    id: 'wildflower',
    petalCount: 6,
    petalLength: 38,
    petalWidth:  20,
    centerRadius: 7,
    colorSets: [
      { base:'#4055e8', mid:'#6878ff', tip:'#a0acff', edge:'#2838cc', center:'#ffee40' },
      { base:'#38a858', mid:'#60cc78', tip:'#90f0a8', edge:'#208838', center:'#ffee40' },
      { base:'#c838a0', mid:'#e860c0', tip:'#ff96d8', edge:'#a81880', center:'#ffee40' },
    ],
  },

  // ── SUNFLOWER (16 narrow petals, bold center) ────────────
  {
    id: 'sunflower',
    petalCount: 16,
    petalLength: 55,
    petalWidth:  15,
    centerRadius: 23,
    colorSets: [
      { base:'#ffc800', mid:'#ffe030', tip:'#fff080', edge:'#cc9000', center:'#3a1808' },
      { base:'#ffa800', mid:'#ffca28', tip:'#ffe868', edge:'#cc7000', center:'#2a1005' },
    ],
  },

];


// ============================================================
// § PARTICLE CLASS
//   Floating pollen motes / light dust drifting upward.
// ============================================================

class Particle {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this._reset();
    // On first spawn, scatter across full canvas height
    this.y = rand(0, H);
  }

  _reset() {
    this.x    = rand(0, this.W);
    this.y    = this.H + 8;               // start just below canvas
    this.vx   = rand(-0.22, 0.22);        // gentle horizontal drift
    this.vy   = rand(-0.45, -0.18);       // float upward
    this.size = rand(0.8, 2.6);
    this.baseAlpha   = rand(0.18, 0.55);
    this.twinklePhase = rand(0, Math.PI * 2);
    this.twinkleSpeed = rand(0.8, 2.5);

    // Warm, natural palette for pollen/light
    const palettes = [
      [255, 252, 210],   // soft white-gold
      [255, 220, 100],   // warm gold
      [255, 180, 110],   // amber
      [215, 255, 210],   // pale green
      [210, 230, 255],   // cool sky-blue
    ];
    const [r, g, b] = randFrom(palettes);
    this.color = `rgb(${r},${g},${b})`;
    this.glowColor = `rgba(${r},${g},${b},`;
  }

  /** Move particle and pulse its opacity */
  update(time) {
    // Gentle sinusoidal drift adds organic wobble
    this.x += this.vx + Math.sin(time * 0.6 + this.twinklePhase) * 0.12;
    this.y += this.vy;
    // Pulse alpha: breathing effect
    this.alpha = this.baseAlpha * (0.55 + 0.45 * Math.sin(time * this.twinkleSpeed + this.twinklePhase));
  }

  draw(ctx) {
    if (this.alpha <= 0) return;

    // Core dot
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();

    // Soft glow halo
    const gr = this.size * 4;
    const glow = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, gr);
    glow.addColorStop(0, this.glowColor + (this.alpha * 0.35) + ')');
    glow.addColorStop(1, this.glowColor + '0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, gr, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  isDead() { return this.y < -10; }
}


// ============================================================
// § FLOWER CLASS
//   Holds all state for one flower: position, type, color,
//   stem geometry, leaf data, petal array, and bloom progress.
// ============================================================

class Flower {
  constructor(x, groundY) {
    this.x       = x;
    this.groundY = groundY;

    // Pick a random type and color palette
    this.type   = randFrom(FLOWER_TYPES);
    this.colors = randFrom(this.type.colorSets);

    // ── Bloom state ─────────────────────────────────────────
    // bloomProgress drives the entire animation (0 = bud, 1 = fully open)
    this.bloomProgress = 0;
    this.targetBloom   = 0;        // the value we're animating toward

    // ── Stem & leaves ───────────────────────────────────────
    this.stemHeight = rand(85, 155);
    this.stemLean   = rand(-18, 18); // natural slight lean, pixels at top

    // Two alternating leaves along the stem.
    // `t` is position along stem (0 = base, 1 = top).
    this.leaves = [
      { t: rand(0.38, 0.52), side:  1, sizeM: rand(0.8, 1.25), angle: rand(0.2, 0.42) },
      { t: rand(0.58, 0.72), side: -1, sizeM: rand(0.8, 1.25), angle: rand(0.2, 0.42) },
    ];

    // ── Wind sway ────────────────────────────────────────────
    // Each flower has its own phase/speed so they don't move in lockstep.
    this.swayPhase    = rand(0, Math.PI * 2);
    this.swaySpeed    = rand(0.34, 0.62);
    this.swayAmplitude = rand(3, 7.5);    // pixels of peak deflection

    // ── Petals ───────────────────────────────────────────────
    // Generate an array of petal descriptors, one per petal.
    // Each petal remembers its own angle, size variation, and bloom delay.
    // The slight individual variation is what makes the flower look organic.
    this.petals = Array.from({ length: this.type.petalCount }, (_, i) => ({
      spreadAngle:      (i / this.type.petalCount) * Math.PI * 2,  // final spread
      lengthMult:       rand(0.88, 1.13),   // petal length variation ±13%
      widthMult:        rand(0.88, 1.13),   // petal width variation ±13%
      rotationVariance: rand(-0.14, 0.14),  // slight random angular tilt (radians)
      // Stagger: petal 0 starts blooming first, last petal starts 30% later.
      // This gives the "petals unfurl one by one" appearance.
      bloomDelay: i / this.type.petalCount, // 0.0 → 1.0
    }));

    // ── Hover/glow state ─────────────────────────────────────
    this.glowIntensity = 0;
    this.isHovered     = false;
  }

  // ─────────────────────────────────────────────────────────
  // Return current sway offset (pixels) based on a time value.
  // ─────────────────────────────────────────────────────────
  _sway(time) {
    return Math.sin(time * this.swaySpeed + this.swayPhase) * this.swayAmplitude;
  }

  // ─────────────────────────────────────────────────────────
  // Return the canvas-space position of the flower head
  // (top of stem) including wind sway.
  // ─────────────────────────────────────────────────────────
  getHeadPos(time) {
    const sway = this._sway(time);
    return {
      x:    this.x + sway + this.stemLean * 0.35,
      y:    this.groundY - this.stemHeight,
      sway: sway,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Quadratic Bézier point along the stem at parameter t (0→1).
  // Used to position leaves at the correct spot on the curved stem.
  // ─────────────────────────────────────────────────────────
  getStemPoint(t, time) {
    const head = this.getHeadPos(time);
    const bx = this.x, by = this.groundY;
    const ex = head.x, ey = head.y;
    // Control point bends the stem with the sway
    const cx = this.x + head.sway * 0.4 + this.stemLean * 0.2;
    const cy = (by + ey) / 2 + 14;
    return {
      x: (1-t)*(1-t)*bx + 2*(1-t)*t*cx + t*t*ex,
      y: (1-t)*(1-t)*by + 2*(1-t)*t*cy + t*t*ey,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Advance bloom animation and hover glow each frame.
  // dt = seconds elapsed since last frame.
  // bloomSpeed = user-controlled multiplier (0.2 – 2).
  // ─────────────────────────────────────────────────────────
  update(dt, bloomSpeed) {
    const step = bloomSpeed * 0.55 * dt;

    if (this.bloomProgress < this.targetBloom) {
      this.bloomProgress = Math.min(this.targetBloom, this.bloomProgress + step);
    } else if (this.bloomProgress > this.targetBloom) {
      // Reset (closing) happens faster for a snappy feel
      this.bloomProgress = Math.max(this.targetBloom, this.bloomProgress - step * 2);
    }

    // Smoothly interpolate glow toward target (1 if hovered, 0 if not)
    const glowTarget = this.isHovered ? 1 : 0;
    this.glowIntensity += (glowTarget - this.glowIntensity) * Math.min(1, dt * 4.5);
  }

  // ─────────────────────────────────────────────────────────
  // Hit test: is canvas point (px, py) over this flower?
  // ─────────────────────────────────────────────────────────
  containsPoint(px, py, time) {
    const head = this.getHeadPos(time);
    const r    = this.type.petalLength * 1.6;  // approximate hit radius
    return Math.hypot(px - head.x, py - head.y) < r;
  }
}


// ============================================================
// § GARDEN CLASS
//   The central scene manager.  Owns the canvas, all flowers,
//   and the particle system.  Drives the animation loop.
// ============================================================

class Garden {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.flowers   = [];
    this.particles = [];
    this.time      = 0;
    this.lastTime  = null;   // for delta-time computation
    this.bloomSpeed = 5;     // maps to 1–10 from slider
    this._rafId    = null;

    this.resize();
    this.spawnFlowers();
    this.spawnParticles(90);

    window.addEventListener('resize', () => {
      this.resize();
      this.spawnFlowers(this.flowers.length);  // rebuild at new size
    });
  }

  // ── Canvas Resize ────────────────────────────────────────
  resize() {
    // Match canvas buffer to its CSS display size.
    // We work in CSS-pixel coordinates throughout for simplicity.
    this.W = this.canvas.offsetWidth  || window.innerWidth;
    this.H = this.canvas.offsetHeight || window.innerHeight;
    this.canvas.width  = this.W;
    this.canvas.height = this.H;
    // Ground line sits at 82% down the canvas
    this.groundY = Math.round(this.H * 0.82);
  }

  // ── Flower Spawning ──────────────────────────────────────
  /**
   * Distribute `count` flowers across the garden width.
   * A small random horizontal jitter stops them looking mechanical.
   */
  spawnFlowers(count = 12) {
    this.flowers = [];
    const margin  = 55;
    const spacing = (this.W - margin * 2) / Math.max(1, count - 1);

    for (let i = 0; i < count; i++) {
      const x = margin + i * spacing + rand(-spacing * 0.28, spacing * 0.28);
      const y = this.groundY + rand(-6, 12);  // slight ground variation
      this.flowers.push(new Flower(x, y));
    }

    // Sort back-to-front by groundY so overlapping looks natural
    this.flowers.sort((a, b) => a.groundY - b.groundY);
  }

  // ── Particle Spawning ────────────────────────────────────
  spawnParticles(count) {
    this.particles = Array.from({ length: count }, () => new Particle(this.W, this.H));
  }

  // ── Public Controls ──────────────────────────────────────
  bloomAll()   { this.flowers.forEach(f => f.targetBloom = 1); }
  resetGarden(){ this.flowers.forEach(f => f.targetBloom = 0); }
  randomize()  { this.spawnFlowers(randInt(8, 16)); }

  // ── Animation Loop ───────────────────────────────────────
  start() {
    const tick = (ts) => {
      this._rafId = requestAnimationFrame(tick);

      // Compute delta time in seconds, cap at 50ms to survive tab focus loss
      if (this.lastTime === null) this.lastTime = ts;
      const dt = Math.min((ts - this.lastTime) / 1000, 0.05);
      this.lastTime = ts;
      this.time += dt;

      this._update(dt);
      this._draw();
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  // ── Update ───────────────────────────────────────────────
  _update(dt) {
    // Normalize bloom speed: slider 1–10, center (5) = 1× real-time
    const speed = this.bloomSpeed / 5;

    this.flowers.forEach(f => f.update(dt, speed));

    // Update particles; remove dead ones and top back up
    this.particles.forEach(p => {
      p.W = this.W;
      p.H = this.H;
      p.update(this.time);
    });
    this.particles = this.particles.filter(p => !p.isDead());
    while (this.particles.length < 90) {
      this.particles.push(new Particle(this.W, this.H));
    }
  }


  // ============================================================
  // § DRAWING METHODS
  // ============================================================

  _draw() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    this._drawBackground();

    // Particles render behind flowers
    this.particles.forEach(p => p.draw(ctx));

    // Flowers drawn back-to-front (already sorted by groundY)
    this.flowers.forEach(f => this._drawFlower(f));

    this._drawForeground();
  }

  // ── Background: Sky + Sun + Ground ───────────────────────
  _drawBackground() {
    const { ctx, W, H, groundY } = this;

    // ─ Sky gradient ─
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0.00, '#5ea8d8');   // deep cerulean at top
    sky.addColorStop(0.45, '#a8d4f0');   // pale blue mid-sky
    sky.addColorStop(0.78, '#f0dfc0');   // warm peach near horizon
    sky.addColorStop(1.00, '#f8c880');   // golden horizon
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, groundY);

    // ─ Sun — wide ambient glow ─
    const sunX = W * 0.72, sunY = H * 0.11;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.42);
    sunGlow.addColorStop(0.00, 'rgba(255,248,180,0.72)');
    sunGlow.addColorStop(0.18, 'rgba(255,224,120,0.32)');
    sunGlow.addColorStop(0.50, 'rgba(255,200,100,0.10)');
    sunGlow.addColorStop(1.00, 'rgba(255,200, 80, 0.00)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, W, groundY);

    // ─ Sun disc ─
    ctx.fillStyle = 'rgba(255,252,210,0.92)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
    ctx.fill();

    // ─ Sun corona rays (animated pulsing) ─
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const r1  = 30;
      const r2  = 44 + Math.sin(this.time * 0.9 + i * 1.1) * 5;
      ctx.beginPath();
      ctx.moveTo(sunX + Math.cos(ang) * r1, sunY + Math.sin(ang) * r1);
      ctx.lineTo(sunX + Math.cos(ang) * r2, sunY + Math.sin(ang) * r2);
      ctx.strokeStyle = `rgba(255,240,150,${0.28 + 0.12 * Math.sin(this.time + i)})`;
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    // ─ Ground body ─
    const ground = ctx.createLinearGradient(0, groundY, 0, H);
    ground.addColorStop(0.00, '#5a8c3a');
    ground.addColorStop(0.18, '#426828');
    ground.addColorStop(0.55, '#2e5018');
    ground.addColorStop(1.00, '#1a3010');
    ctx.fillStyle = ground;
    ctx.fillRect(0, groundY, W, H - groundY);

    // ─ Ground surface — gentle undulating hill ─
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let x = 0; x <= W; x += 8) {
      const y = groundY
        + Math.sin(x * 0.014 + 1.2) * 5
        + Math.sin(x * 0.007 + 0.5) * 7;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const groundTop = ctx.createLinearGradient(0, groundY, 0, groundY + 30);
    groundTop.addColorStop(0, '#70b045');
    groundTop.addColorStop(1, '#4a8030');
    ctx.fillStyle = groundTop;
    ctx.fill();
  }

  // ── Foreground: depth vignette ────────────────────────────
  _drawForeground() {
    const { ctx, W, H } = this;
    // Slight atmospheric haze at the very bottom edge
    const haze = ctx.createLinearGradient(0, H * 0.90, 0, H);
    haze.addColorStop(0, 'rgba(130,200,90,0)');
    haze.addColorStop(1, 'rgba( 60,110,30,0.22)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.90, W, H * 0.10);
  }

  // ── Draw one complete flower (stem + leaves + petals) ─────
  _drawFlower(flower) {
    const { ctx } = this;
    const head = flower.getHeadPos(this.time);

    // 1. Stem
    this._drawStem(flower, head);

    // 2. Leaves along the stem
    flower.leaves.forEach(leaf => this._drawLeaf(flower, leaf));

    // 3. Hover glow halo (drawn before petals so it glows behind)
    if (flower.glowIntensity > 0.01) {
      this._drawHoverGlow(flower, head);
    }

    // 4. The flower head: petals + center
    ctx.save();
    ctx.translate(head.x, head.y);

    this._drawPetals(flower);
    this._drawBudCap(flower);    // visible when mostly closed
    this._drawCenter(flower);

    ctx.restore();
  }

  // ── Stem ─────────────────────────────────────────────────
  _drawStem(flower, head) {
    const { ctx } = this;
    const bx = flower.x,   by = flower.groundY;
    const ex = head.x,     ey = head.y;
    const cx = flower.x + head.sway * 0.4 + flower.stemLean * 0.2;
    const cy = (by + ey) / 2 + 15;

    const grad = ctx.createLinearGradient(bx, by, ex, ey);
    grad.addColorStop(0, '#2a4818');
    grad.addColorStop(0.5,'#3c6822');
    grad.addColorStop(1, '#508030');

    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2.8;
    ctx.lineCap     = 'round';
    ctx.stroke();
  }

  // ── Leaf ─────────────────────────────────────────────────
  _drawLeaf(flower, leafDef) {
    const { ctx } = this;
    const pt   = flower.getStemPoint(leafDef.t, this.time);
    const sway = Math.sin(this.time * flower.swaySpeed + flower.swayPhase);

    const len = 22 * leafDef.sizeM;
    const wid =  8 * leafDef.sizeM;
    // Angle: outward from stem + slight wind influence
    const angle = leafDef.side * (Math.PI * 0.30 + leafDef.angle * 0.5)
                  + sway * 0.10 * leafDef.side
                  - Math.PI / 2;  // rotate so leaf points out-and-up

    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-wid, -len * 0.35, -wid * 0.6, -len * 0.90, 0, -len);
    ctx.bezierCurveTo( wid * 0.6, -len * 0.90,  wid, -len * 0.35, 0, 0);
    ctx.closePath();

    const lg = ctx.createLinearGradient(0, 0, 0, -len);
    lg.addColorStop(0, '#385e24');
    lg.addColorStop(0.5,'#4a7a2e');
    lg.addColorStop(1, '#5e9840');
    ctx.fillStyle = lg;
    ctx.fill();

    // Midrib vein
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len * 0.88);
    ctx.strokeStyle = 'rgba(80,145,50,0.32)';
    ctx.lineWidth   = 0.7;
    ctx.stroke();

    ctx.restore();
  }

  // ── Hover Glow ───────────────────────────────────────────
  _drawHoverGlow(flower, head) {
    const { ctx } = this;
    const r   = flower.type.petalLength * 2.0;
    const gi  = flower.glowIntensity;

    const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r);
    glow.addColorStop(0.00, `rgba(255,240,160,${0.18 * gi})`);
    glow.addColorStop(0.35, `rgba(255,220, 80,${0.10 * gi})`);
    glow.addColorStop(1.00, 'rgba(255,200,60,0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── All Petals ───────────────────────────────────────────
  _drawPetals(flower) {
    flower.petals.forEach(petal => this._drawOnePetal(flower, petal));
  }

  // ──────────────────────────────────────────────────────────
  // CORE PETAL ANIMATION
  //
  // This is where the bloom magic happens.  Each petal has a
  // `bloomDelay` (0–1) that staggers when it starts opening.
  //
  // The effective `petalProg` for petal i works like this:
  //   - bloomProgress covers [0, 1] for the whole flower.
  //   - Petals stagger across a 30% window:
  //     petal 0 starts at 0.00, last petal starts at 0.30.
  //   - Once a petal's window begins it animates 0→1.
  //
  // The easing applied is easeOutBack (springy overshoot),
  // which makes petals feel alive when they "pop" open.
  //
  // The "unfurl" trick: scaleY starts compressed (≈0.05) and
  // expands to 1.0.  In 2D this fakes a 3D fold-down effect —
  // like a petal standing vertically then lying flat.
  // ──────────────────────────────────────────────────────────
  _drawOnePetal(flower, petal) {
    const { ctx } = this;
    const { type, colors, bloomProgress } = flower;

    // ── Compute this petal's individual progress ────────────
    const STAGGER = 0.30;   // maximum delay fraction
    const rawStart   = petal.bloomDelay * STAGGER;
    const rawProgress = (bloomProgress - rawStart) / (1 - STAGGER);
    const petalProg  = clamp(rawProgress, 0, 1);

    if (petalProg <= 0) return;   // not time yet — skip

    // ── Apply easing ───────────────────────────────────────
    // easeOutBack gives the springy "pop" as the petal opens.
    const eased = easeOutBack(petalProg);

    // Clamp to avoid negative scale on the very first frames
    // (easeOutBack can dip slightly below 0 at t≈0)
    const scale = Math.max(0.001, eased);

    // ── Unfurl (fake 3D fold) ──────────────────────────────
    // When the petal starts opening it's "vertical" (small Y projection).
    // easeOutCubic is used here so the unfurl doesn't overshoot.
    const unfurl = lerp(0.04, 1.0, easeOutCubic(petalProg));

    // ── Petal dimensions (individual variation baked in) ───
    const len = type.petalLength * petal.lengthMult;
    const wid = type.petalWidth  * petal.widthMult;

    ctx.save();

    // Rotate to this petal's spread position around the flower center
    ctx.rotate(petal.spreadAngle + petal.rotationVariance);

    // Scale: overall size (eased) × Y unfurl compression
    ctx.scale(scale, scale * unfurl);

    // ── Petal bezier shape ─────────────────────────────────
    // Drawn along the –Y axis (pointing away from center).
    // Two cubic bezier curves form a symmetric teardrop.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // Left edge: base ─► tip
    ctx.bezierCurveTo(
      -wid * 0.60, -len * 0.22,
      -wid * 0.44, -len * 0.85,
      0, -len
    );
    // Right edge: tip ─► base
    ctx.bezierCurveTo(
       wid * 0.44, -len * 0.85,
       wid * 0.60, -len * 0.22,
      0, 0
    );
    ctx.closePath();

    // ── Fill: gradient from base color to tip ─────────────
    // Gradient coords are in the local (post-transform) space,
    // so they always flow base→tip regardless of rotation.
    const grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0.00, colors.base);
    grad.addColorStop(0.45, colors.mid);
    grad.addColorStop(1.00, colors.tip);

    ctx.globalAlpha = clamp(petalProg * 1.4, 0, 1);  // fade in as petal opens
    ctx.fillStyle   = grad;
    ctx.fill();

    // ── Petal edge stroke ──────────────────────────────────
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth   = 0.7;
    ctx.globalAlpha = clamp(petalProg * 0.35, 0, 0.35);
    ctx.stroke();

    // ── Central highlight vein ─────────────────────────────
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.08);
    ctx.bezierCurveTo(
       wid * 0.05, -len * 0.35,
       wid * 0.02, -len * 0.68,
      0, -len * 0.82
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth   = 1.2;
    ctx.globalAlpha = clamp(petalProg * 0.20, 0, 0.20);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Bud Cap (visible when flower is mostly closed) ────────
  // A small colored teardrop at the top of the stem that
  // fades out as the petals open.
  _drawBudCap(flower) {
    const { ctx } = this;
    const budVisible = 1 - flower.bloomProgress / 0.25;
    if (budVisible <= 0) return;

    ctx.save();
    ctx.globalAlpha = clamp(budVisible, 0, 1) * 0.85;

    const h = 16 + flower.type.petalLength * 0.22;
    const w = 7;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-w, -h * 0.3, -w * 0.7, -h * 0.85, 0, -h);
    ctx.bezierCurveTo( w * 0.7, -h * 0.85,  w, -h * 0.3,  0,  0);
    ctx.closePath();

    const bg = ctx.createLinearGradient(0, 0, 0, -h);
    bg.addColorStop(0.0, '#3a6020');
    bg.addColorStop(0.5, '#5a8838');
    bg.addColorStop(1.0, flower.colors.tip);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Flower Center ─────────────────────────────────────────
  // The central disc (stamens / pollen area).
  // It pops up fast (centerProg = bloomProgress * 2, capped at 1).
  _drawCenter(flower) {
    const { ctx, time } = this;
    const centerProg = clamp(flower.bloomProgress * 2, 0, 1);
    if (centerProg <= 0) return;

    const cr = flower.type.centerRadius * easeOutBack(centerProg);

    // Radial gradient: bright center, darker ring
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, cr);
    cg.addColorStop(0.00, lighten(flower.colors.center, 55));
    cg.addColorStop(0.45, flower.colors.center);
    cg.addColorStop(1.00, darken(flower.colors.center, 35));

    ctx.globalAlpha = centerProg;
    ctx.fillStyle   = cg;
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, Math.PI * 2);
    ctx.fill();

    // Stamen dots orbiting the center (for non-daisy types)
    if (flower.type.id !== 'daisy') {
      const dotCount = 8;
      const orbitR   = cr * 0.58;
      const dotR     = cr * 0.13;

      ctx.globalAlpha = centerProg * 0.65;
      for (let i = 0; i < dotCount; i++) {
        const ang = (i / dotCount) * Math.PI * 2 + time * 0.12;
        const dx  = Math.cos(ang) * orbitR;
        const dy  = Math.sin(ang) * orbitR;
        ctx.fillStyle = lighten(flower.colors.center, 65);
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }


  // ============================================================
  // § EVENT HANDLING
  // ============================================================

  /** Convert a DOM mouse/touch event to canvas-local coordinates */
  _toCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: src.clientX - rect.left,
      y: src.clientY - rect.top,
    };
  }

  /** Find whichever flower is under (px, py), or null */
  _flowerAt(px, py) {
    // Iterate in reverse (front-to-back) so front flowers win
    for (let i = this.flowers.length - 1; i >= 0; i--) {
      if (this.flowers[i].containsPoint(px, py, this.time)) {
        return this.flowers[i];
      }
    }
    return null;
  }

  bindEvents(controls) {
    const { canvas } = this;

    // ── Bloom All ───────────────────────────────────────────
    controls.bloomAll.addEventListener('click', () => this.bloomAll());

    // ── Reset ───────────────────────────────────────────────
    controls.reset.addEventListener('click', () => this.resetGarden());

    // ── Randomize ───────────────────────────────────────────
    controls.randomize.addEventListener('click', () => this.randomize());

    // ── Speed Slider ─────────────────────────────────────────
    controls.speed.addEventListener('input', e => {
      this.bloomSpeed = Number(e.target.value);
      controls.speedLabel.textContent = this.bloomSpeed;
      // Update CSS custom property for slider fill colour
      const pct = ((this.bloomSpeed - 1) / 9 * 100).toFixed(1);
      controls.speed.style.setProperty('--val', pct + '%');
    });

    // ── Click a flower ────────────────────────────────────────
    canvas.addEventListener('click', e => {
      const { x, y } = this._toCanvasCoords(e);
      const flower = this._flowerAt(x, y);
      if (flower) {
        // Toggle: if fully bloomed, close it; otherwise open it
        flower.targetBloom = flower.bloomProgress > 0.5 ? 0 : 1;
      }
    });

    // ── Hover glow ───────────────────────────────────────────
    canvas.addEventListener('mousemove', e => {
      const { x, y } = this._toCanvasCoords(e);
      let anyHovered = false;
      this.flowers.forEach(f => {
        f.isHovered = f.containsPoint(x, y, this.time);
        if (f.isHovered) anyHovered = true;
      });
      canvas.classList.toggle('hovering', anyHovered);
    });

    canvas.addEventListener('mouseleave', () => {
      this.flowers.forEach(f => f.isHovered = false);
      canvas.classList.remove('hovering');
    });

    // ── Touch: allow tapping individual flowers ───────────────
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const { x, y } = this._toCanvasCoords(e);
      const flower = this._flowerAt(x, y);
      if (flower) {
        flower.targetBloom = flower.bloomProgress > 0.5 ? 0 : 1;
      }
    }, { passive: false });
  }
}


// ============================================================
// § ENTRY POINT
//   Wire everything together and start the animation loop.
// ============================================================

(function init() {
  const canvas = document.getElementById('garden-canvas');

  const garden = new Garden(canvas);

  garden.bindEvents({
    bloomAll:   document.getElementById('btn-bloom-all'),
    reset:      document.getElementById('btn-reset'),
    randomize:  document.getElementById('btn-randomize'),
    speed:      document.getElementById('speed-slider'),
    speedLabel: document.getElementById('speed-label'),
  });

  // Initialise slider fill position
  const slider = document.getElementById('speed-slider');
  const pct    = ((Number(slider.value) - 1) / 9 * 100).toFixed(1);
  slider.style.setProperty('--val', pct + '%');

  garden.start();
})();
