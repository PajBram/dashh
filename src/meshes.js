// Proceduella meshar. Alla är centrerade i origo och 1 enhet stora,
// så instansens skala motsvarar objektets faktiska storlek.
import { TAU } from './math.js';

function mesh(positions, normals, indices) {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

export function sphere(seg = 18, rings = 12) {
  const p = [], n = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * TAU;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      p.push(x * 0.5, y * 0.5, z * 0.5);
      n.push(x, y, z);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh(p, n, idx);
}

/**
 * Samma låda som `box()`, men ut och in: varje triangel vänds och normalerna
 * pekar inåt. Stenarna i Vildheim använder den — de ritas dessutom utan
 * baksideskullning, annars skulle bara insidan av deras bortre vägg synas.
 * Det är en avsiktligt vrång look, inte en bugg.
 */
export function boxFlipped() {
  const m = box();
  for (let i = 0; i < m.normals.length; i++) m.normals[i] = -m.normals[i];
  // byt håll på varje triangel så framsidan blir baksida
  for (let i = 0; i < m.indices.length; i += 3) {
    const t = m.indices[i + 1];
    m.indices[i + 1] = m.indices[i + 2];
    m.indices[i + 2] = t;
  }
  return m;
}

export function box() {
  const p = [], n = [], idx = [];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [nr, up, right] of faces) {
    const base = p.length / 3;
    for (const [su, sr] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
      p.push(
        (nr[0] + up[0] * su + right[0] * sr) * 0.5,
        (nr[1] + up[1] * su + right[1] * sr) * 0.5,
        (nr[2] + up[2] * su + right[2] * sr) * 0.5,
      );
      n.push(nr[0], nr[1], nr[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mesh(p, n, idx);
}

export function cylinder(seg = 14, topScale = 1) {
  const p = [], n = [], idx = [];
  for (let s = 0; s <= seg; s++) {
    const th = (s / seg) * TAU, cx = Math.cos(th), cz = Math.sin(th);
    p.push(cx * 0.5 * topScale, 0.5, cz * 0.5 * topScale);
    n.push(cx, 0.25, cz);
    p.push(cx * 0.5, -0.5, cz * 0.5);
    n.push(cx, 0.25, cz);
  }
  for (let s = 0; s < seg; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  for (const y of [0.5, -0.5]) {
    const base = p.length / 3;
    const r = y > 0 ? 0.5 * topScale : 0.5;
    p.push(0, y, 0); n.push(0, Math.sign(y), 0);
    for (let s = 0; s <= seg; s++) {
      const th = (s / seg) * TAU;
      p.push(Math.cos(th) * r, y, Math.sin(th) * r);
      n.push(0, Math.sign(y), 0);
    }
    for (let s = 0; s < seg; s++) {
      if (y > 0) idx.push(base, base + 1 + s, base + 2 + s);
      else idx.push(base, base + 2 + s, base + 1 + s);
    }
  }
  return mesh(p, n, idx);
}

export function cone(seg = 14) {
  const p = [], n = [], idx = [];
  for (let s = 0; s < seg; s++) {
    const t0 = (s / seg) * TAU, t1 = ((s + 1) / seg) * TAU, tm = (t0 + t1) / 2;
    const base = p.length / 3;
    p.push(0, 0.5, 0, Math.cos(t0) * 0.5, -0.5, Math.sin(t0) * 0.5, Math.cos(t1) * 0.5, -0.5, Math.sin(t1) * 0.5);
    const nx = Math.cos(tm) * 0.89, nz = Math.sin(tm) * 0.89;
    for (let k = 0; k < 3; k++) n.push(nx, 0.45, nz);
    idx.push(base, base + 1, base + 2);
  }
  const base = p.length / 3;
  p.push(0, -0.5, 0); n.push(0, -1, 0);
  for (let s = 0; s <= seg; s++) {
    const th = (s / seg) * TAU;
    p.push(Math.cos(th) * 0.5, -0.5, Math.sin(th) * 0.5);
    n.push(0, -1, 0);
  }
  for (let s = 0; s < seg; s++) idx.push(base, base + 2 + s, base + 1 + s);
  return mesh(p, n, idx);
}

/** Platt skiva i XZ-planet — används för skuggor och markringar. */
export function disc(seg = 20) {
  const p = [0, 0, 0], n = [0, 1, 0], idx = [];
  for (let s = 0; s <= seg; s++) {
    const th = (s / seg) * TAU;
    p.push(Math.cos(th) * 0.5, 0, Math.sin(th) * 0.5);
    n.push(0, 1, 0);
  }
  for (let s = 0; s < seg; s++) idx.push(0, s + 2, s + 1);
  return mesh(p, n, idx);
}

/** Oktaeder — kantig kristall för orbs och pickups. */
export function octahedron() {
  const p = [], n = [], idx = [];
  const v = [[0, 0.5, 0], [0.5, 0, 0], [0, 0, 0.5], [-0.5, 0, 0], [0, 0, -0.5], [0, -0.5, 0]];
  const tris = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]];
  for (const t of tris) {
    const base = p.length / 3;
    const a = v[t[0]], b = v[t[1]], c = v[t[2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c]) { p.push(q[0], q[1], q[2]); n.push(nx, ny, nz); }
    idx.push(base, base + 1, base + 2);
  }
  return mesh(p, n, idx);
}

/** Rutnätsplan i XZ, 1x1 enheter, för vattenytan. */
export function grid(res = 48) {
  const p = [], n = [], idx = [];
  for (let z = 0; z <= res; z++) {
    for (let x = 0; x <= res; x++) {
      p.push(x / res - 0.5, 0, z / res - 0.5);
      n.push(0, 1, 0);
    }
  }
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const a = z * (res + 1) + x, b = a + res + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh(p, n, idx);
}
