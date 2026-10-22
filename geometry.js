export function ensureRoom(room) {
  const w = Math.max(200, Number(room.w) || 6000);
  const h = Math.max(200, Number(room.h) || 4000);
  const x = Number(room.x) || 0;
  const y = Number(room.y) || 0;
  if (!Array.isArray(room.points) || room.points.length < 3) {
    room.points = rectanglePoints(x, y, w, h);
  } else {
    room.points = room.points.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
  }
  const arcs = Array.isArray(room.edges) ? room.edges : [];
  room.edges = room.points.map((_, index) => normalizeArc(arcs[index], room.points[index], room.points[(index + 1) % room.points.length]));
  syncBounds(room);
  return room;
}

export function rectanglePoints(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function syncBounds(room) {
  const box = pointBounds(outlinePoints(room, 80));
  room.x = box.minX;
  room.y = box.minY;
  room.w = Math.max(1, box.maxX - box.minX);
  room.h = Math.max(1, box.maxY - box.minY);
  return room;
}

export function edgeCount(room) {
  return room.points?.length || 0;
}

export function edgeLength(room, index) {
  return edgeGeometry(room, index).length;
}

export function edgeGeometry(room, index) {
  const count = room.points.length;
  const i = ((index % count) + count) % count;
  const a = room.points[i];
  const b = room.points[(i + 1) % count];
  const arc = room.edges?.[i] || null;
  const chord = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const frame = arc?.radius ? arcFrame(a, b, arc.radius, arc.bow) : null;
  const length = frame ? frame.length : chord;
  const pointAt = (along) => {
    const t = clamp(along, 0, length);
    if (!frame) {
      const u = t / length;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    const ang = frame.a0 + frame.sweep * (t / length);
    return { x: frame.cx + Math.cos(ang) * frame.r, y: frame.cy + Math.sin(ang) * frame.r };
  };
  const tangentAt = (along) => {
    if (!frame) return Math.atan2(b.y - a.y, b.x - a.x);
    const t = clamp(along, 0, length);
    const ang = frame.a0 + frame.sweep * (t / length);
    const dir = frame.sweep >= 0 ? 1 : -1;
    return Math.atan2(Math.cos(ang) * dir, -Math.sin(ang) * dir);
  };
  const inwardAt = (along) => {
    const ang = tangentAt(along);
    const tx = Math.cos(ang);
    const ty = Math.sin(ang);
    const clockwise = signedArea(room.points) >= 0;
    return clockwise ? { x: -ty, y: tx } : { x: ty, y: -tx };
  };
  const mid = pointAt(length / 2);
  const normal = inwardAt(length / 2);
  const angle = tangentAt(0);
  const horizontal = Math.abs(b.y - a.y) < 1 && !frame;
  const vertical = Math.abs(b.x - a.x) < 1 && !frame;
  return {
    index: i,
    a,
    b,
    arc,
    length,
    pointAt,
    tangentAt,
    inwardAt,
    nx: normal.x,
    ny: normal.y,
    angle,
    horizontal,
    vertical,
    mx: mid.x,
    my: mid.y,
  };
}

export function nearestEdge(room, x, y) {
  let best = null;
  for (let index = 0; index < room.points.length; index += 1) {
    const edge = edgeGeometry(room, index);
    const hit = projectEdge(edge, x, y);
    if (!best || hit.dist < best.dist) best = { ...hit, edge, edgeIndex: index, room };
  }
  return best;
}

export function pointInRoom(room, x, y) {
  const outline = outlinePoints(room, 40);
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[j];
    const b = outline[i];
    const intersect = ((a.y > y) !== (b.y > y)) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToBoundary(room, x, y) {
  return nearestEdge(room, x, y)?.dist ?? Infinity;
}

export function outlinePoints(room, step) {
  if (!room.points?.length) return [];
  const points = [];
  for (let index = 0; index < room.points.length; index += 1) {
    const edge = edgeGeometry(room, index);
    const count = edge.arc ? Math.max(8, Math.ceil(edge.length / Math.max(20, step || 80))) : 1;
    for (let i = 0; i < count; i += 1) points.push(edge.pointAt((edge.length * i) / count));
  }
  return points;
}

export function roomArea(room) {
  const outline = outlinePoints(room, 30);
  let sum = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function centroid(room) {
  const outline = outlinePoints(room, 80);
  let x = 0;
  let y = 0;
  for (const point of outline) {
    x += point.x;
    y += point.y;
  }
  const n = Math.max(1, outline.length);
  return { x: x / n, y: y / n };
}

export function translateRoom(room, dx, dy) {
  for (const point of room.points) {
    point.x += dx;
    point.y += dy;
  }
  syncBounds(room);
}

export function moveVertex(room, index, x, y) {
  const point = room.points[index];
  if (!point) return;
  point.x = x;
  point.y = y;
  const prev = (index - 1 + room.points.length) % room.points.length;
  tightenArc(room, prev);
  tightenArc(room, index);
  syncBounds(room);
}

export function scaleRoom(room, w, h) {
  ensureRoom(room);
  const box = pointBounds(room.points);
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const sx = Math.max(200, Number(w) || bw) / bw;
  const sy = Math.max(200, Number(h) || bh) / bh;
  for (const point of room.points) {
    point.x = box.minX + (point.x - box.minX) * sx;
    point.y = box.minY + (point.y - box.minY) * sy;
  }
  room.edges = room.edges.map((arc, index) => normalizeArc(arc, room.points[index], room.points[(index + 1) % room.points.length]));
  syncBounds(room);
}

export function setEdgeArc(room, index, radius, bow) {
  const count = room.points.length;
  const i = ((index % count) + count) % count;
  const a = room.points[i];
  const b = room.points[(i + 1) % count];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!radius) {
    room.edges[i] = null;
    syncBounds(room);
    return;
  }
  room.edges[i] = {
    radius: Math.max(Number(radius) || 0, chord / 2 + 1),
    bow: bow >= 0 ? 1 : -1,
  };
  syncBounds(room);
}

export function insertPoint(room, edgeIndex) {
  const edge = edgeGeometry(room, edgeIndex);
  const point = edge.pointAt(edge.length / 2);
  const at = edge.index + 1;
  room.points.splice(at, 0, point);
  room.edges.splice(edge.index, 1, null, null);
  syncBounds(room);
  return { index: at, splitAt: edge.length / 2, edgeIndex: edge.index };
}

export function removePoint(room, index) {
  if (room.points.length <= 3) return false;
  room.points.splice(index, 1);
  room.edges.splice(index, 1);
  const prev = (index - 1 + room.points.length) % room.points.length;
  room.edges[prev] = null;
  syncBounds(room);
  return true;
}

function normalizeArc(arc, a, b) {
  if (!arc?.radius) return null;
  const chord = Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
  return { radius: Math.max(Number(arc.radius) || 0, chord / 2 + 1), bow: arc.bow >= 0 ? 1 : -1 };
}

function tightenArc(room, index) {
  const arc = room.edges?.[index];
  if (!arc?.radius) return;
  const a = room.points[index];
  const b = room.points[(index + 1) % room.points.length];
  room.edges[index] = normalizeArc(arc, a, b);
}

function projectEdge(edge, x, y) {
  const steps = edge.arc ? Math.max(12, Math.ceil(edge.length / 40)) : 1;
  let best = null;
  for (let i = 0; i < steps; i += 1) {
    const a = edge.pointAt((edge.length * i) / steps);
    const b = edge.pointAt((edge.length * (i + 1)) / steps);
    const hit = projectSegment(a, b, x, y);
    const along = (edge.length * i) / steps + hit.t * (edge.length / steps);
    if (!best || hit.dist < best.dist) best = { dist: hit.dist, x: hit.x, y: hit.y, along };
  }
  return best;
}

function projectSegment(a, b, x, y) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1);
  const px = a.x + dx * t;
  const py = a.y + dy * t;
  return { t, x: px, y: py, dist: Math.hypot(x - px, y - py) };
}

function arcFrame(a, b, radius, bow) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy) || 1;
  const r = Math.max(radius, chord / 2 + 0.01);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const lx = -dy / chord;
  const ly = dx / chord;
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const bowSign = bow >= 0 ? 1 : -1;
  const cx = mx - lx * h * bowSign;
  const cy = my - ly * h * bowSign;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const a1 = Math.atan2(b.y - cy, b.x - cx);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  const mid = a0 + sweep / 2;
  const px = cx + Math.cos(mid) * r;
  const py = cy + Math.sin(mid) * r;
  const cross = dx * (py - a.y) - dy * (px - a.x);
  if ((cross > 0) !== (bowSign > 0)) sweep += sweep > 0 ? -Math.PI * 2 : Math.PI * 2;
  return { cx, cy, r, a0, sweep, length: Math.abs(sweep) * r, chord };
}

function pointBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
