import { edgeGeometry, ensureRoom, nearestEdge, pointInRoom } from "./geometry.js";

export function nearestWall(rooms, x, y) {
  let best = null;
  for (const room of rooms || []) {
    if (!room.points?.length) ensureRoom(room);
    const hit = nearestEdge(room, x, y);
    if (!hit) continue;
    const inside = pointInRoom(room, x, y);
    if (!best || hit.dist < best.dist - 0.5 || (Math.abs(hit.dist - best.dist) <= 0.5 && inside && !best.inside)) {
      best = {
        room,
        edgeIndex: hit.edgeIndex,
        side: hit.edgeIndex,
        dist: hit.dist,
        px: hit.x,
        py: hit.y,
        along: hit.along,
        inside,
      };
    }
  }
  return best;
}

export function createOpening(room, edgeIndex, point, preset, ceiling) {
  if (!room.points?.length) ensureRoom(room);
  const wall = edgeGeometry(room, edgeIndex);
  const length = Math.max(200, wall.length);
  const height = Math.max(400, Number(ceiling) || 2700);
  let w = 1000;
  let h = 1000;
  let sill = 1000;
  let along = length / 2;
  if (preset === "full") {
    w = length;
    h = height;
    sill = 0;
  } else if (preset === "waist") {
    w = length;
    sill = Math.min(2000, height - 200);
    h = Math.max(200, height - sill);
  } else {
    w = Math.min(1000, length);
    h = Math.min(1000, height - 1000);
    sill = Math.min(1000, height - h);
    const hit = nearestEdge(room, point.x, point.y);
    along = hit?.edgeIndex === wall.index ? hit.along : length / 2;
  }
  w = clamp(w, 200, length);
  along = clamp(along, w / 2, Math.max(w / 2, length - w / 2));
  return {
    roomId: room.id,
    edgeIndex: wall.index,
    wallSide: null,
    along,
    w,
    h,
    sill,
    preset: preset || "hole",
  };
}

export function openingCenter(room, opening) {
  if (!room.points?.length) ensureRoom(room);
  const wall = edgeGeometry(room, opening.edgeIndex || 0);
  const w = Math.min(opening.w, wall.length);
  const along = clamp(opening.along, w / 2, Math.max(w / 2, wall.length - w / 2));
  const point = wall.pointAt(along);
  return { x: point.x, y: point.y, along, wall };
}

export function moveOpening(plan, opening, x, y) {
  const hit = nearestWall(plan.rooms, x, y);
  if (!hit || hit.dist > 600) return;
  const wall = edgeGeometry(hit.room, hit.edgeIndex);
  const length = Math.max(200, wall.length);
  opening.roomId = hit.room.id;
  opening.edgeIndex = hit.edgeIndex;
  opening.wallSide = null;
  opening.w = Math.min(opening.w, length);
  opening.along = clamp(hit.along, opening.w / 2, Math.max(opening.w / 2, length - opening.w / 2));
}

export function resizeOpening(plan, opening, patch) {
  const room = plan.rooms.find((entry) => entry.id === opening.roomId);
  if (!room) return;
  const wall = edgeGeometry(room, opening.edgeIndex || 0);
  const length = Math.max(200, wall.length);
  const ceiling = Math.max(400, Number(plan.settings?.ceiling) || 2700);
  if (patch.sill != null) opening.sill = clamp(Number(patch.sill) || 0, 0, ceiling - 200);
  if (patch.h != null) opening.h = clamp(Number(patch.h) || 200, 200, ceiling - opening.sill);
  if (patch.w != null) opening.w = clamp(Number(patch.w) || 200, 200, length);
  opening.h = Math.min(opening.h, ceiling - opening.sill);
  opening.along = clamp(opening.along, opening.w / 2, Math.max(opening.w / 2, length - opening.w / 2));
  syncLeaves(plan);
}

export function cutsForWall(plan, room, edgeIndex) {
  if (!room.points?.length) ensureRoom(room);
  const target = edgeGeometry(room, edgeIndex);
  const tol = Math.max(Number(plan.settings?.wall) || 150, 80);
  const cuts = [];
  for (const opening of plan.openings || []) {
    const host = plan.rooms.find((entry) => entry.id === opening.roomId);
    if (!host) continue;
    const mapped = mapOpening(host, opening, room, target.index, tol);
    if (!mapped) continue;
    const a = Math.max(mapped.center - opening.w / 2, 0);
    const b = Math.min(mapped.center + opening.w / 2, target.length);
    if (b - a > 20) {
      cuts.push({
        a,
        b,
        sill: Number(opening.sill) || 0,
        h: Number(opening.h) || 0,
        id: opening.id,
        walkable: (Number(opening.sill) || 0) < 80,
      });
    }
  }
  return cuts.sort((p, q) => p.a - q.a);
}

export function hitOpening(plan, x, y) {
  let best = null;
  const tol = Math.max(Number(plan.settings?.wall) || 150, 80) + 80;
  for (const opening of plan.openings || []) {
    const room = plan.rooms.find((entry) => entry.id === opening.roomId);
    if (!room) continue;
    const center = openingCenter(room, opening);
    const wall = center.wall;
    let near = Infinity;
    const steps = Math.max(2, Math.ceil(opening.w / 80));
    for (let i = 0; i <= steps; i += 1) {
      const point = wall.pointAt(center.along - opening.w / 2 + (opening.w * i) / steps);
      near = Math.min(near, Math.hypot(point.x - x, point.y - y));
    }
    if (near > tol) continue;
    if (!best || near < best.dist) best = { opening, dist: near };
  }
  return best?.opening || null;
}

export function nearestOpeningOnWall(plan, wallHit, x, y) {
  if (!wallHit?.room) return null;
  const tol = Math.max(Number(plan.settings?.wall) || 150, 80);
  let best = null;
  for (const opening of plan.openings || []) {
    const room = plan.rooms.find((entry) => entry.id === opening.roomId);
    if (!room) continue;
    const mapped = mapOpening(room, opening, wallHit.room, wallHit.edgeIndex, tol);
    if (!mapped) continue;
    const along = Math.abs(mapped.center - wallHit.along);
    const limit = opening.w / 2 + 300;
    if (along <= limit && (!best || along < best.dist)) best = { opening, dist: along };
  }
  return best?.opening || null;
}

export function nearestOpening(plan, x, y, maxDist) {
  let best = null;
  for (const opening of plan.openings || []) {
    const room = plan.rooms.find((entry) => entry.id === opening.roomId);
    if (!room) continue;
    const center = openingCenter(room, opening);
    const dist = Math.hypot(center.x - x, center.y - y);
    if (dist <= maxDist && (!best || dist < best.dist)) best = { opening, dist };
  }
  return best?.opening || null;
}

export function syncLeaves(plan) {
  for (const entry of plan.items || []) {
    if (!entry.openingId) continue;
    const opening = (plan.openings || []).find((row) => row.id === entry.openingId);
    const room = opening && plan.rooms.find((row) => row.id === opening.roomId);
    if (!opening || !room) continue;
    const center = openingCenter(room, opening);
    entry.x = center.x;
    entry.y = center.y;
    entry.w = opening.w;
    entry.h = opening.h;
    entry.d = 40;
    entry.z = opening.sill + opening.h / 2;
    entry.roomId = opening.roomId;
    entry.wallSide = null;
    entry.edgeIndex = opening.edgeIndex;
    entry.place = "wall";
    entry.rot = Math.round((center.wall.angle * 180) / Math.PI);
    entry.opening = false;
  }
}

export function doorOpening(room, edgeIndex, point, cat, ceiling) {
  const opening = createOpening(room, edgeIndex, point, "hole", ceiling);
  const wall = edgeGeometry(room, edgeIndex);
  const length = Math.max(200, wall.length);
  const height = Math.max(400, Number(ceiling) || 2700);
  if (cat?.leaf === "window") {
    opening.w = Math.min(Math.max(200, Number(cat.w) || 1400), length);
    opening.h = Math.min(Math.max(200, Number(cat.h) || 1200), Math.max(200, height - 200));
    opening.sill = Math.min(1000, Math.max(0, height - opening.h));
  } else {
    opening.w = Math.min(Math.max(200, Number(cat?.w) || 900), length);
    opening.h = Math.min(Math.max(200, Number(cat?.h) || 2100), height);
    opening.sill = 0;
  }
  const hit = nearestEdge(room, point.x, point.y);
  const cursor = hit?.edgeIndex === wall.index ? hit.along : wall.length / 2;
  opening.along = clamp(cursor, opening.w / 2, Math.max(opening.w / 2, length - opening.w / 2));
  opening.preset = "hole";
  return opening;
}

export function applyDoorOpening(plan, opening, cat) {
  if (!opening || cat?.leaf !== "door") return;
  const room = (plan.rooms || []).find((entry) => entry.id === opening.roomId);
  if (!room) return;
  const wall = edgeGeometry(room, opening.edgeIndex || 0);
  const length = Math.max(200, wall.length);
  const ceiling = Math.max(400, Number(plan.settings?.ceiling) || 2700);
  const doorW = Math.min(Math.max(200, Number(cat.w) || 900), length);
  const doorH = Math.min(Math.max(200, Number(cat.h) || 2100), ceiling);
  const aboveFloor = (Number(opening.sill) || 0) >= 80;
  const fullWall = opening.w >= length - 80;
  if (fullWall) opening.w = doorW;
  opening.sill = 0;
  if (aboveFloor || fullWall || opening.h < doorH) opening.h = doorH;
  opening.h = Math.min(opening.h, ceiling);
  opening.along = clamp(opening.along, opening.w / 2, Math.max(opening.w / 2, length - opening.w / 2));
}

export function interiorLeft() {
  return "start";
}

export function hingeForHand(_side, hand) {
  return hand === "right" ? "end" : "start";
}

export function hingeForCatalog(opening, cat) {
  if (!cat || cat.swing === "double" || cat.leaf === "window") return "start";
  const hand = cat.hand === "right" ? "right" : "left";
  if (cat.swing === "slide") return hand === "right" ? "end" : "start";
  return hingeForHand(opening?.wallSide, hand);
}

export function hingePoint(room, opening, hinge) {
  const center = openingCenter(room, opening);
  const along = center.along + (hinge === "end" ? opening.w / 2 : -opening.w / 2);
  const point = center.wall.pointAt(along);
  return { x: point.x, y: point.y, wall: center.wall };
}

export function leafSwing(wall, hinge, swing) {
  const along = wall.length / 2;
  const tangent = wall.tangentAt(along);
  let closed = hinge === "end" ? tangent + Math.PI : tangent;
  const into = Math.atan2(wall.ny, wall.nx);
  const target = swing === "push" ? into + Math.PI : into;
  let delta = target - closed;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return { closed, delta, open: closed + delta };
}

export function attachLeaf(plan, opening, cat, id) {
  if (!opening || !cat) return null;
  if (cat.leaf === "door") applyDoorOpening(plan, opening, cat);
  const hinge = hingeForCatalog(opening, cat);
  let leaf = (plan.items || []).find((entry) => entry.openingId === opening.id);
  if (!leaf) {
    leaf = {
      id,
      catalogId: cat.id,
      name: cat.name,
      color: cat.color,
      place: "wall",
      openingId: opening.id,
      leaf: cat.leaf,
      hinge,
      price: null,
      groupId: null,
      opening: false,
      light: false,
      lightOn: false,
      lightLevel: 10,
      lightColor: "#fff4d6",
      residential: false,
      design: "",
      x: 0,
      y: 0,
      rot: 0,
      w: cat.w,
      d: cat.d,
      h: cat.h,
      z: 0,
      roomId: opening.roomId,
      wallSide: null,
      edgeIndex: opening.edgeIndex,
    };
    plan.items.push(leaf);
  } else {
    leaf.catalogId = cat.id;
    leaf.name = cat.name;
    leaf.color = cat.color;
    leaf.leaf = cat.leaf;
    leaf.hinge = hinge;
  }
  syncLeaves(plan);
  return leaf;
}

export function migrateOpenings(plan) {
  if (!Array.isArray(plan.openings)) plan.openings = [];
  for (const room of plan.rooms || []) ensureRoom(room);
  for (const opening of plan.openings) {
    if (opening.edgeIndex == null || opening.edgeIndex === "") {
      const room = plan.rooms.find((entry) => entry.id === opening.roomId);
      const side = opening.wallSide || "s";
      const index = { n: 0, e: 1, s: 2, w: 3 }[side] ?? 0;
      opening.edgeIndex = index;
      if (room && (side === "s" || side === "w")) {
        const length = edgeGeometry(room, index).length;
        opening.along = length - (Number(opening.along) || 0);
        for (const leaf of plan.items || []) {
          if (leaf.openingId === opening.id && (leaf.hinge === "start" || leaf.hinge === "end")) {
            leaf.hinge = leaf.hinge === "start" ? "end" : "start";
          }
        }
      }
    }
    opening.edgeIndex = Number(opening.edgeIndex) || 0;
  }
  for (const entry of plan.items || []) {
    const legacy = !entry.openingId && (entry.opening || entry.catalogId === "door" || entry.catalogId === "window");
    if (!legacy || !entry.roomId || !entry.wallSide) continue;
    const room = plan.rooms.find((row) => row.id === entry.roomId);
    if (!room) continue;
    const hit = nearestEdge(room, entry.x, entry.y);
    const index = hit && hit.dist < 500 ? hit.edgeIndex : ({ n: 0, e: 1, s: 2, w: 3 }[entry.wallSide] ?? 0);
    const wall = edgeGeometry(room, index);
    const id = Math.random().toString(36).slice(2, 10);
    const h = entry.h || (entry.catalogId === "window" ? 1200 : 2100);
    const sill = Math.max(0, (Number(entry.z) || h / 2) - h / 2);
    const along = hit && hit.dist < 500 ? hit.along : wall.length / 2;
    plan.openings.push({
      id,
      roomId: entry.roomId,
      edgeIndex: index,
      wallSide: null,
      along,
      w: entry.w || (entry.catalogId === "window" ? 1400 : 900),
      h,
      sill,
      preset: entry.catalogId === "window" ? "hole" : "full",
    });
    entry.openingId = id;
    entry.opening = false;
    entry.leaf = entry.catalogId === "window" ? "window" : "door";
    entry.hinge = entry.hinge || "start";
  }
  syncLeaves(plan);
}

export function clampOpenings(plan, room) {
  for (const opening of plan.openings || []) {
    if (opening.roomId !== room.id) continue;
    const count = room.points.length;
    opening.edgeIndex = ((Number(opening.edgeIndex) || 0) % count + count) % count;
    const length = edgeGeometry(room, opening.edgeIndex).length;
    opening.w = clamp(opening.w, 200, Math.max(200, length));
    opening.along = clamp(opening.along, opening.w / 2, Math.max(opening.w / 2, length - opening.w / 2));
  }
  syncLeaves(plan);
}

export function splitEdgeOpenings(plan, room, edgeIndex, splitAt) {
  const moved = [];
  for (const opening of plan.openings || []) {
    if (opening.roomId !== room.id || opening.edgeIndex == null) continue;
    if (opening.edgeIndex === edgeIndex && opening.along > splitAt) moved.push(opening);
    else if (opening.edgeIndex > edgeIndex) opening.edgeIndex += 1;
  }
  for (const opening of moved) {
    opening.edgeIndex = edgeIndex + 1;
    opening.along -= splitAt;
  }
}

export function noteRemovedVertex(plan, roomId, index, count) {
  for (const opening of plan.openings || []) {
    if (opening.roomId !== roomId || opening.edgeIndex == null) continue;
    if (index === 0) {
      if (opening.edgeIndex === 0 || opening.edgeIndex === count - 1) opening.edgeIndex = count - 2;
      else opening.edgeIndex -= 1;
    } else if (opening.edgeIndex === index) opening.edgeIndex = index - 1;
    else if (opening.edgeIndex > index) opening.edgeIndex -= 1;
  }
}

function mapOpening(hostRoom, opening, targetRoom, targetIndex, tol) {
  if (!hostRoom.points?.length) ensureRoom(hostRoom);
  if (!targetRoom.points?.length) ensureRoom(targetRoom);
  const host = edgeGeometry(hostRoom, opening.edgeIndex || 0);
  const target = edgeGeometry(targetRoom, targetIndex);
  if (host.arc || target.arc) {
    const forward = nearPoint(host.a, target.a, tol) && nearPoint(host.b, target.b, tol);
    const reverse = nearPoint(host.a, target.b, tol) && nearPoint(host.b, target.a, tol);
    if (!forward && !reverse) return null;
    if (!sameArc(host.arc, target.arc, reverse)) return null;
    const center = forward ? Number(opening.along) || 0 : target.length - (Number(opening.along) || 0);
    return { center };
  }
  const ux = host.b.x - host.a.x;
  const uy = host.b.y - host.a.y;
  const length = Math.hypot(ux, uy) || 1;
  const dx = ux / length;
  const dy = uy / length;
  const lineDist = (point) => Math.abs((point.x - host.a.x) * dy - (point.y - host.a.y) * dx);
  if (lineDist(target.a) > tol || lineDist(target.b) > tol) return null;
  const project = (point) => (point.x - host.a.x) * dx + (point.y - host.a.y) * dy;
  const start = project(target.a);
  const end = project(target.b);
  const overlapA = Math.max(0, Math.min(start, end));
  const overlapB = Math.min(length, Math.max(start, end));
  if (overlapB - overlapA < 20) return null;
  const along = Number(opening.along) || 0;
  return { center: end >= start ? along - start : start - along };
}

function sameArc(a, b, reverse) {
  if (!a?.radius && !b?.radius) return true;
  if (!a?.radius || !b?.radius) return false;
  if (Math.abs(a.radius - b.radius) > 30) return false;
  const bow = reverse ? -a.bow : a.bow;
  return bow === b.bow;
}

function nearPoint(a, b, tol) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
