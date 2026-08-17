// Tunt lager ovanpå WebGL2: program, meshar och instansbatchar.

export function initGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: false, depth: true, stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('This browser does not support WebGL2.');
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  return gl;
}

function compile(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(`Shaderfel i ${name}:\n${log}`);
    throw new Error(`${name}: ${log}`);
  }
  return sh;
}

export function makeProgram(gl, vsSrc, fsSrc, name = 'program') {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc, name + '.vert'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.frag'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${name} länkfel: ${gl.getProgramInfoLog(p)}`);
  }
  const cache = new Map();
  return {
    prog: p,
    use() { gl.useProgram(p); return this; },
    loc(n) {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n));
      return cache.get(n);
    },
    m4(n, v) { gl.uniformMatrix4fv(this.loc(n), false, v); return this; },
    f(n, v) { gl.uniform1f(this.loc(n), v); return this; },
    v2(n, a, b) { gl.uniform2f(this.loc(n), a, b); return this; },
    v3(n, a, b, c) {
      if (Array.isArray(a)) gl.uniform3f(this.loc(n), a[0], a[1], a[2]);
      else gl.uniform3f(this.loc(n), a, b, c);
      return this;
    },
  };
}

function attrib(gl, loc, size, stride, offset, divisor) {
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  if (divisor) gl.vertexAttribDivisor(loc, divisor);
}

/** Statisk mesh med position (0), normal (1) och valfri färg (2). */
export function uploadMesh(gl, m) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const put = (data, loc, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    attrib(gl, loc, size, 0, 0, 0);
  };
  put(m.positions, 0, 3);
  put(m.normals, 1, 3);
  if (m.colors) put(m.colors, 2, 3);
  const ebo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    vao,
    count: m.indices.length,
    type: m.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    draw() {
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, this.count, this.type, 0);
    },
  };
}

// Per instans: pos(3) skala(3) färg(3) rotation(3) glöd(1) = 13 flyttal.
export const INST_FLOATS = 14;   // 14:e = vindkänslighet, se INST_VS

export class InstancedBatch {
  constructor(gl, m, capacity = 256) {
    this.gl = gl;
    this.capacity = capacity;
    this.count = 0;
    this.data = new Float32Array(capacity * INST_FLOATS);
    this.indexCount = m.indices.length;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const put = (data, loc, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      attrib(gl, loc, size, 0, 0, 0);
    };
    put(m.positions, 0, 3);
    put(m.normals, 1, 3);

    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const st = INST_FLOATS * 4;
    attrib(gl, 2, 3, st, 0, 1);
    attrib(gl, 3, 3, st, 12, 1);
    attrib(gl, 4, 3, st, 24, 1);
    attrib(gl, 5, 3, st, 36, 1);
    attrib(gl, 6, 1, st, 48, 1);
    attrib(gl, 7, 1, st, 52, 1);
    gl.bindVertexArray(null);
  }

  clear() { this.count = 0; this.dirty = true; return this; }

  grow() {
    const gl = this.gl;
    this.capacity *= 2;
    const next = new Float32Array(this.capacity * INST_FLOATS);
    next.set(this.data);
    this.data = next;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, next.byteLength, gl.DYNAMIC_DRAW);
  }

  /**
   * rot är [x,y,z] i radianer; glow 0..1 lägger till egenljus.
   * sway > 0 låter vinden böja objektet — 0 för allt som ska stå stilla.
   */
  push(x, y, z, sx, sy, sz, col, rx = 0, ry = 0, rz = 0, glow = 0, sway = 0) {
    if (this.count >= this.capacity) this.grow();
    const d = this.data;
    let o = this.count * INST_FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = sx; d[o + 4] = sy; d[o + 5] = sz;
    d[o + 6] = col[0]; d[o + 7] = col[1]; d[o + 8] = col[2];
    d[o + 9] = rx; d[o + 10] = ry; d[o + 11] = rz;
    d[o + 12] = glow;
    d[o + 13] = sway;
    this.count++;
    this.dirty = true;
  }

  draw() {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * INST_FLOATS);
      this.dirty = false;
    }
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.count);
  }
}

// Per partikel: pos(3) storlek(1) färg(4) = 8 flyttal.
export const PART_FLOATS = 8;

export class BillboardBatch {
  constructor(gl, capacity = 2048) {
    this.gl = gl;
    this.capacity = capacity;
    this.count = 0;
    this.data = new Float32Array(capacity * PART_FLOATS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    attrib(gl, 0, 2, 0, 0, 0);

    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const st = PART_FLOATS * 4;
    attrib(gl, 1, 3, st, 0, 1);
    attrib(gl, 2, 1, st, 12, 1);
    attrib(gl, 3, 4, st, 16, 1);
    gl.bindVertexArray(null);
  }

  clear() { this.count = 0; this.dirty = true; return this; }

  grow() {
    const gl = this.gl;
    this.capacity *= 2;
    const next = new Float32Array(this.capacity * PART_FLOATS);
    next.set(this.data);
    this.data = next;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, next.byteLength, gl.DYNAMIC_DRAW);
  }

  push(x, y, z, size, r, g, b, a) {
    if (this.count >= this.capacity) this.grow();
    const d = this.data;
    let o = this.count * PART_FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
    this.count++;
    this.dirty = true;
  }

  draw() {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * PART_FLOATS);
      this.dirty = false;
    }
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.count);
  }
}
