// Tangentbord och mus. Kameran styrs alltid av musrörelser; pointer lock
// används när webbläsaren tillåter det (låser pekaren så den inte kan lämna
// fönstret), annars fungerar vanliga musrörelser över canvasen direkt.

const clampDelta = (v) => (v > 150 ? 150 : v < -150 ? -150 : v);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.cursorNX = 0;
    this.cursorNY = 0;
    this.wheel = 0;
    this.fireDown = false;
    this.parryDown = false;      // höger musknapp: parering i Vildheim
    this.parryPressed = false;   // bara bildrutan då den trycktes ner
    this.locked = false;
    this.sensitivity = 0.0022;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear(); this.fireDown = false; this.parryDown = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      // Kameran följer alltid musen — även utan pointer lock och utan knapp.
      // Klampen skyddar mot hopp när muspekaren återvänder efter alt-tab e.d.
      this.mouseDX += clampDelta(e.movementX || 0);
      this.mouseDY += clampDelta(e.movementY || 0);
      // Pekarens position i -1..1 — driver kantstyrningen när lås saknas.
      const nx = (e.clientX / Math.max(1, innerWidth)) * 2 - 1;
      const ny = (e.clientY / Math.max(1, innerHeight)) * 2 - 1;
      this.cursorNX = nx < -1 ? -1 : nx > 1 ? 1 : nx;
      this.cursorNY = ny < -1 ? -1 : ny > 1 ? 1 : ny;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.fireDown = true;
      // Högerknappen pareras med. `parryPressed` nollställs i endFrame, så
      // ett tryck ger exakt en parering hur länge man än håller inne.
      if (e.button === 2) {
        if (!this.parryDown) this.parryPressed = true;
        this.parryDown = true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireDown = false;
      if (e.button === 2) this.parryDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += e.deltaY; }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    this.initTouch(canvas);
  }

  // ------------------------------------------------------------------ touch

  /**
   * Vänstra halvan av skärmen är en spak som dyker upp där tummen landar,
   * högra halvan sveper kameran. Knapparna trycker samma virtuella tangenter
   * som tangentbordet, så resten av spelet behöver inte veta något om touch.
   */
  initTouch(canvas) {
    // Enheter vars primära pekdon är ett finger räknas som touch direkt, så
    // menyerna hinner visa rätt hjälptext innan någon rört skärmen.
    this.touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (this.touch) document.body.classList.add('touch');
    this.stickActive = false;
    this.stickBase = { x: 0, y: 0 };
    this.stickVec = { x: 0, y: 0 };
    this.moveId = null;
    this.lookId = null;
    this.lookPrev = { x: 0, y: 0 };
    this.touchSensitivity = 0.0052;
    const RADIUS = 62;

    const first = () => {
      if (this.touch) return;
      this.touch = true;
      document.body.classList.add('touch');
      if (this.onTouchStart) this.onTouchStart();
    };

    canvas.addEventListener('touchstart', (e) => {
      first();
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.5) {
          if (this.moveId !== null) continue;
          this.moveId = t.identifier;
          this.stickActive = true;
          this.stickBase.x = t.clientX; this.stickBase.y = t.clientY;
          this.stickVec.x = 0; this.stickVec.y = 0;
        } else {
          if (this.lookId !== null) continue;
          this.lookId = t.identifier;
          this.lookPrev.x = t.clientX; this.lookPrev.y = t.clientY;
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.moveId) {
          let dx = t.clientX - this.stickBase.x;
          let dy = t.clientY - this.stickBase.y;
          const d = Math.hypot(dx, dy);
          if (d > RADIUS) { dx = (dx / d) * RADIUS; dy = (dy / d) * RADIUS; }
          this.stickVec.x = dx / RADIUS;
          this.stickVec.y = dy / RADIUS;
        } else if (t.identifier === this.lookId) {
          this.mouseDX += clampDelta(t.clientX - this.lookPrev.x);
          this.mouseDY += clampDelta(t.clientY - this.lookPrev.y);
          this.lookPrev.x = t.clientX; this.lookPrev.y = t.clientY;
        }
      }
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.moveId) {
          this.moveId = null; this.stickActive = false;
          this.stickVec.x = 0; this.stickVec.y = 0;
        } else if (t.identifier === this.lookId) {
          this.lookId = null;
        }
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  /** Kopplar en skärmknapp till en tangent (eller attack via data-attack). */
  bindButton(el) {
    const key = el.dataset.key;
    const attack = el.hasAttribute('data-attack');
    const press = (e) => {
      e.preventDefault();
      el.classList.add('held');
      if (attack) this.fireDown = true;
      else if (key) {
        if (!this.keys.has(key)) this.justPressed.add(key);
        this.keys.add(key);
      }
    };
    const release = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('held');
      if (attack) this.fireDown = false;
      else if (key) this.keys.delete(key);
    };
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  }

  requestLock() {
    if (this.canvas.requestPointerLock) {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }

  /** Rörelseriktning i lokala koordinater: x = höger, y = framåt. */
  moveAxis() {
    if (this.stickActive) {
      // skärmens y pekar nedåt, spelets framåt är uppåt
      return { x: this.stickVec.x, y: -this.stickVec.y };
    }
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  /** Nollställ engångsvärden i slutet av varje bildruta. */
  endFrame() {
    this.justPressed.clear();
    this.parryPressed = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
