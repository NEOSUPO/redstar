import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { lookupItem } from "./catalog.js";
import { centroid, edgeGeometry, outlinePoints, pointInRoom } from "./geometry.js?v=20261022d";
import { cutsForWall, hingePoint, leafSwing, openingCenter } from "./openings.js?v=20261022f";
import { snapValue } from "./store.js?v=20261022l";
import { counterTop, seatItems, shiftGuests } from "./surface.js?v=20261022l";

const BRIGHTNESS = [0.45, 0.85, 1.25];

export function createView3d(canvas, store, ui) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0xd5dbe3);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 10, 200000);
  camera.position.set(8000, 6000, 8000);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(4000, 0, 3000);
  controls.maxPolarAngle = Math.PI * 0.49;
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(4000, 8000, 2000);
  scene.add(sun);
  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);
  scene.add(new THREE.GridHelper(40000, 40, 0xb7bdc4, 0xc5ccd3));
  const root = new THREE.Group();
  scene.add(root);
  let mode = "sky";
  let underlayKey = "";
  let underlayTexture = null;
  let selection = null;
  let spin = null;
  let slide = null;
  let blank = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const spinPlane = new THREE.Plane();
  const spinHit = new THREE.Vector3();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  }

  function rebuild() {
    while (root.children.length) root.remove(root.children[0]);
    const plan = store.get();
    const level = BRIGHTNESS[plan.settings.brightness] ?? BRIGHTNESS[1];
    sun.intensity = 1.1 * level;
    ambient.intensity = 0.55 * level;
    const ceiling = plan.settings.ceiling;
    ensureUnderlay(plan);
    if (plan.underlay && underlayTexture) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(plan.underlay.w, plan.underlay.h),
        new THREE.MeshBasicMaterial({ map: underlayTexture, transparent: true, opacity: 0.85 }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(plan.underlay.x + plan.underlay.w / 2, 1, plan.underlay.y + plan.underlay.h / 2);
      root.add(plane);
    }
    for (const room of plan.rooms) addRoom(room, plan, ceiling);
    for (const entry of plan.items) addItem(entry, plan, ceiling, level);
    const sole = selection?.kind === "item" && selection.ids.length === 1
      ? plan.items.find((row) => row.id === selection.ids[0])
      : null;
    if (sole && !sole.locked && !sole.openingId && sole.place !== "wall") addSpin(sole, plan, ceiling);
  }

  function addRoom(room, plan, ceiling) {
    const lift = Number(room.raisedFloor) || 0;
    const floorH = 40 + lift;
    const floor = new THREE.Mesh(
      floorGeometry(room, 0, floorH),
      new THREE.MeshLambertMaterial({ color: room.floorColor || room.color }),
    );
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    addWalls(room, plan, ceiling);
    const drop = Number(room.dropCeiling) || 0;
    if (drop > 40) {
      const slab = new THREE.Mesh(
        floorGeometry(room, plan.settings.wall, 20),
        new THREE.MeshLambertMaterial({ color: room.wallColor || "#e7edf2", transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = ceiling - drop - 20;
      root.add(slab);
    }
  }

  function floorGeometry(room, inset, depth) {
    const center = centroid(room);
    const outline = outlinePoints(room, 50).map((point) => {
      if (!inset) return point;
      const vx = center.x - point.x;
      const vy = center.y - point.y;
      const len = Math.hypot(vx, vy) || 1;
      return { x: point.x + (vx / len) * inset, y: point.y + (vy / len) * inset };
    });
    const shape = new THREE.Shape();
    outline.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, -point.y);
      else shape.lineTo(point.x, -point.y);
    });
    const geom = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1, depth || 1), bevelEnabled: false });
    return geom;
  }

  function addItem(entry, plan, ceiling, level) {
    if (entry.openingId) {
      addLeaf(entry, plan);
      return;
    }
    const cat = lookupItem(entry.catalogId, plan.customItems);
    const host = entry.hostId ? plan.items.find((row) => row.id === entry.hostId) : null;
    const room = roomFor(host || entry, plan);
    const lift = Number(room?.raisedFloor) || 0;
    const drop = Number(room?.dropCeiling) || 0;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(entry.w, entry.h, entry.d),
      new THREE.MeshLambertMaterial({ color: entry.color || cat?.color || "#999999" }),
    );
    const top = counterTop(plan.items, entry);
    let y = lift + top + entry.h / 2;
    if (entry.place === "ceiling") y = ceiling - drop - entry.h / 2;
    if (entry.place === "wall") y = lift + (entry.z || entry.h / 2);
    mesh.position.set(entry.x, y, entry.y);
    mesh.rotation.y = (-entry.rot * Math.PI) / 180;
    tag(mesh, { pick: "item", id: entry.id }, chosen("item", entry.id));
    root.add(mesh);
    if (entry.light && entry.lightOn) {
      const bulb = new THREE.PointLight(entry.lightColor || "#fff4d6", (Number(entry.lightLevel) || 1) / 10 * 4 * level, 4500);
      bulb.position.set(entry.x, y, entry.y);
      root.add(bulb);
    }
  }

  function addLeaf(entry, plan) {
    const opening = (plan.openings || []).find((row) => row.id === entry.openingId);
    const room = opening && plan.rooms.find((row) => row.id === opening.roomId);
    if (!opening || !room) return;
    const center = openingCenter(room, opening);
    const wall = center.wall;
    const lift = Number(room.raisedFloor) || 0;
    const y = lift + opening.sill + opening.h / 2;
    const cat = lookupItem(entry.catalogId, plan.customItems);
    const swing = cat?.swing || (entry.leaf === "window" ? "window" : "single");
    const leafH = opening.h * 0.96;
    const tangent = wall.tangentAt(center.along);
    if (swing === "window") {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(opening.w, opening.h * 0.92, 28),
        new THREE.MeshLambertMaterial({ color: entry.color || "#9ec9e0", transparent: true, opacity: 0.45, depthWrite: false }),
      );
      mesh.position.set(center.x, y, center.y);
      mesh.rotation.y = -tangent;
      tag(mesh, { pick: "opening", id: opening.id }, chosen("opening", opening.id));
      root.add(mesh);
      return;
    }
    if (swing === "slide") {
      const sign = entry.hinge === "end" ? 1 : -1;
      const shift = sign * opening.w * 0.42;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(opening.w * 0.92, leafH, 36),
        new THREE.MeshLambertMaterial({ color: entry.color || "#d7c4a8" }),
      );
      mesh.position.set(
        center.x + Math.cos(tangent) * shift + wall.nx * 40,
        y,
        center.y + Math.sin(tangent) * shift + wall.ny * 40,
      );
      mesh.rotation.y = -tangent;
      tag(mesh, { pick: "opening", id: opening.id }, chosen("opening", opening.id));
      root.add(mesh);
      return;
    }
    const hinges = swing === "double" ? ["start", "end"] : [entry.hinge === "end" ? "end" : "start"];
    const leafW = (swing === "double" ? opening.w / 2 : opening.w) * 0.96;
    for (const hinge of hinges) {
      const pose = leafSwing(wall, hinge, swing);
      const hp = hingePoint(room, opening, hinge);
      const group = new THREE.Group();
      group.position.set(hp.x, y, hp.y);
      group.rotation.y = -pose.open;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(leafW, leafH, 36),
        new THREE.MeshLambertMaterial({ color: entry.color || "#c9a27a" }),
      );
      mesh.position.x = leafW / 2;
      tag(mesh, { pick: "opening", id: opening.id }, chosen("opening", opening.id));
      group.add(mesh);
      root.add(group);
    }
  }

  function addSpin(entry, plan, ceiling) {
    const radius = Math.max(entry.w, entry.d) * 0.5 + 220;
    const y = itemBaseY(entry, plan, ceiling) + 30;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 70, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0x1d6fd4, depthTest: false, transparent: true, opacity: 0.92 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(entry.x, y, entry.y);
    ring.renderOrder = 3;
    tag(ring, { pick: "spin", id: entry.id }, false);
    root.add(ring);
    const nub = new THREE.Mesh(
      new THREE.SphereGeometry(110, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x1d6fd4, depthTest: false }),
    );
    const ang = (entry.rot * Math.PI) / 180;
    nub.position.set(entry.x + Math.cos(ang) * radius, y, entry.y + Math.sin(ang) * radius);
    nub.renderOrder = 4;
    tag(nub, { pick: "spin", id: entry.id }, false);
    root.add(nub);
  }

  function itemBaseY(entry, plan, ceiling) {
    const host = entry.hostId ? plan.items.find((row) => row.id === entry.hostId) : null;
    const room = roomFor(host || entry, plan);
    const lift = Number(room?.raisedFloor) || 0;
    const drop = Number(room?.dropCeiling) || 0;
    if (entry.place === "ceiling") return ceiling - drop - entry.h;
    if (entry.place === "wall") return lift + (Number(entry.z) || 0);
    return lift + counterTop(plan.items, entry);
  }

  function chosen(kind, id) {
    return selection?.kind === kind && selection.ids.includes(id);
  }

  function tag(mesh, data, on) {
    mesh.userData = data;
    if (on && mesh.material?.emissive) {
      mesh.material.emissive.set("#1d6fd4");
      mesh.material.emissiveIntensity = 0.35;
    }
  }

  function eventNdc(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  }

  function rayHit(event) {
    eventNdc(event);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(root.children, true);
    for (const hit of hits) {
      let obj = hit.object;
      while (obj && obj !== root) {
        if (obj.userData?.pick) return obj.userData;
        obj = obj.parent;
      }
    }
    return null;
  }

  function pointerOnPlane(event, y) {
    eventNdc(event);
    raycaster.setFromCamera(ndc, camera);
    spinPlane.set(new THREE.Vector3(0, 1, 0), -y);
    return raycaster.ray.intersectPlane(spinPlane, spinHit) ? spinHit.clone() : null;
  }

  function endGesture(event) {
    const doneSpin = spin;
    const doneSlide = slide;
    const click = blank;
    spin = null;
    slide = null;
    blank = null;
    if (doneSlide && !doneSlide.pending) {
      store.mutate((draft) => {
        const guests = draft.items.filter((item) => item.hostId === doneSlide.id).map((item) => item.id);
        seatItems(draft, [doneSlide.id, ...guests]);
      });
    }
    const done = doneSlide || doneSpin;
    if (done && !done.pending) {
      ui?.select({ kind: "item", ids: [done.id] });
      return;
    }
    if (!click || event?.type !== "pointerup") return;
    const dx = event.clientX - click.x;
    const dy = event.clientY - click.y;
    if (dx * dx + dy * dy <= 36) ui?.select(null);
  }

  function slideStarts(plan, id) {
    const starts = {};
    for (const entry of plan.items) {
      if (entry.id === id || entry.hostId === id) starts[entry.id] = { x: entry.x, y: entry.y };
    }
    return starts;
  }

  function addWalls(room, plan, ceiling) {
    const thickness = plan.settings.wall;
    const lift = Number(room.raisedFloor) || 0;
    const height = Math.max(100, ceiling - lift);
    const material = new THREE.MeshLambertMaterial({ color: room.wallColor || "#d7dde4", side: THREE.DoubleSide });
    const joins = room.points.map((_, index) => cornerJoin(room, index, thickness));
    for (let index = 0; index < room.points.length; index += 1) {
      const wall = edgeGeometry(room, index);
      const cuts = cutsForWall(plan, room, index)
        .map((cut) => ({
          a: clamp(cut.a, 0, wall.length),
          b: clamp(cut.b, 0, wall.length),
          bottom: clamp(lift + cut.sill, lift, ceiling),
          top: clamp(lift + cut.sill + cut.h, lift, ceiling),
        }))
        .filter((cut) => cut.b - cut.a > 20 && cut.top - cut.bottom > 20);
      const boxes = wallPieces(0, wall.length, lift, height, mergeCuts(cuts));
      for (const box of boxes) placeWallBox(wall, box, thickness, material, joins[index], joins[(index + 1) % room.points.length]);
    }
    for (let index = 0; index < joins.length; index += 1) {
      const join = joins[index];
      if (join.miter || cornerCutOpen(plan, room, index, thickness)) continue;
      if (Math.abs(polygonArea([join.vertex, join.innerB, join.innerA])) < 8) continue;
      addWallPrism(join.vertex, join.innerB, join.innerA, join.vertex, lift, lift + height, material, { start: true, end: true });
    }
  }

  function placeWallBox(wall, box, thickness, material, startJoin, endJoin) {
    const len = box.len;
    const steps = wall.arc ? Math.max(1, Math.ceil(len / 220)) : 1;
    const span = box.mid - len / 2;
    const y0 = box.y - box.h / 2;
    const y1 = box.y + box.h / 2;
    for (let i = 0; i < steps; i += 1) {
      const a = span + (len * i) / steps;
      const b = span + (len * (i + 1)) / steps;
      if (wall.arc) {
        const mid = (a + b) / 2;
        const point = wall.pointAt(mid);
        const normal = wall.inwardAt(mid);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(8, b - a), box.h, thickness), material);
        mesh.position.set(point.x + normal.x * thickness / 2, box.y, point.y + normal.y * thickness / 2);
        mesh.rotation.y = -wall.tangentAt(mid);
        root.add(mesh);
        continue;
      }
      const normal = wall.inwardAt(wall.length / 2);
      const endOf = (along, atStart) => {
        const point = wall.pointAt(along);
        return {
          outer: point,
          inner: { x: point.x + normal.x * thickness, y: point.y + normal.y * thickness },
          cap: atStart,
        };
      };
      const left = endOf(a, a <= 1);
      const right = endOf(b, false);
      const o0 = left.cap && startJoin ? startJoin.vertex : left.outer;
      const i0 = left.cap && startJoin ? joinInner(startJoin, "start") : left.inner;
      const o1 = b >= wall.length - 1 && endJoin ? endJoin.vertex : right.outer;
      const i1 = b >= wall.length - 1 && endJoin ? joinInner(endJoin, "end") : right.inner;
      if (polygonArea([o0, i0, i1, o1]) < 8) continue;
      addWallPrism(o0, i0, i1, o1, y0, y1, material, {
        start: !(left.cap && startJoin),
        end: !(b >= wall.length - 1 && endJoin),
      });
    }
  }

  function cornerJoin(room, vertexIndex, thickness) {
    const prev = edgeGeometry(room, vertexIndex - 1);
    const next = edgeGeometry(room, vertexIndex);
    const vertex = next.a;
    const nA = prev.inwardAt(prev.length);
    const nB = next.inwardAt(0);
    const tA = angleVector(prev.tangentAt(prev.length));
    const tB = angleVector(next.tangentAt(0));
    const innerA = { x: vertex.x + nA.x * thickness, y: vertex.y + nA.y * thickness };
    const innerB = { x: vertex.x + nB.x * thickness, y: vertex.y + nB.y * thickness };
    const hit = lineIntersect(innerA, tA, innerB, tB);
    const offset = hit ? { x: hit.x - vertex.x, y: hit.y - vertex.y } : null;
    const inward = offset && dot(offset, nA) > thickness * 0.2 && dot(offset, nB) > thickness * 0.2;
    const near = offset && Math.hypot(offset.x, offset.y) <= thickness * 4;
    if (hit && inward && near) return { vertex, inner: hit, innerA, innerB, miter: true };
    return { vertex, innerA, innerB, miter: false };
  }

  function joinInner(join, side) {
    if (join.miter) return join.inner;
    return side === "start" ? join.innerB : join.innerA;
  }

  function cornerCutOpen(plan, room, vertexIndex, thickness) {
    const prev = edgeGeometry(room, vertexIndex - 1);
    const next = edgeGeometry(room, vertexIndex);
    const prevCuts = cutsForWall(plan, room, (vertexIndex - 1 + room.points.length) % room.points.length);
    const nextCuts = cutsForWall(plan, room, vertexIndex % room.points.length);
    const open = (cut) => (Number(cut.sill) || 0) < 80;
    return prevCuts.some((cut) => open(cut) && cut.b > prev.length - thickness - 20) || nextCuts.some((cut) => open(cut) && cut.a < thickness + 20);
  }

  function addWallPrism(o0, i0, i1, o1, y0, y1, material, caps) {
    const positions = [];
    const p = (point, y) => [point.x, y, point.y];
    const top = [p(o0, y1), p(i0, y1), p(i1, y1), p(o1, y1)];
    const low = [p(o0, y0), p(i0, y0), p(i1, y0), p(o1, y0)];
    const push = (a, b, c) => {
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const acx = c[0] - a[0];
      const acy = c[1] - a[1];
      const acz = c[2] - a[2];
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      if (cx * cx + cy * cy + cz * cz < 1) return;
      positions.push(...a, ...b, ...c);
    };
    push(top[0], top[1], top[2]);
    push(top[0], top[2], top[3]);
    const sides = [[0, 3], [2, 1]];
    if (caps?.end) sides.push([3, 2]);
    if (caps?.start) sides.push([1, 0]);
    for (const [from, to] of sides) {
      if (Math.hypot(low[from][0] - low[to][0], low[from][2] - low[to][2]) < 0.5) continue;
      push(low[from], low[to], top[to]);
      push(low[from], top[to], top[from]);
    }
    if (positions.length < 9) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    root.add(new THREE.Mesh(geometry, material));
  }

  function mergeCuts(cuts) {
    const sorted = [...cuts].sort((p, q) => p.a - q.a);
    const merged = [];
    for (const cut of sorted) {
      const last = merged[merged.length - 1];
      if (last && cut.a <= last.b) {
        last.b = Math.max(last.b, cut.b);
        last.bottom = Math.min(last.bottom, cut.bottom);
        last.top = Math.max(last.top, cut.top);
      } else merged.push({ ...cut });
    }
    return merged;
  }

  function wallPieces(start, end, base, height, cuts) {
    const boxes = [];
    const full = (a, b) => boxes.push({ mid: (a + b) / 2, len: b - a, y: base + height / 2, h: height });
    const band = (a, b, low, high) => boxes.push({ mid: (a + b) / 2, len: b - a, y: (low + high) / 2, h: high - low });
    let cursor = start;
    for (const cut of cuts) {
      if (cut.a > cursor + 10) full(cursor, cut.a);
      if (cut.bottom - base > 10) band(cut.a, cut.b, base, cut.bottom);
      if (base + height - cut.top > 10) band(cut.a, cut.b, cut.top, base + height);
      cursor = Math.max(cursor, cut.b);
    }
    if (end > cursor + 10) full(cursor, end);
    return boxes;
  }

  function ensureUnderlay(plan) {
    const href = plan.underlay?.href;
    if (!href || href === underlayKey) return;
    underlayKey = href;
    const image = new Image();
    image.onload = () => {
      underlayTexture = new THREE.Texture(image);
      underlayTexture.needsUpdate = true;
      underlayTexture.colorSpace = THREE.SRGBColorSpace;
      rebuild();
    };
    image.src = href;
  }

  function frame() {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function setMode(next) {
    mode = next;
    if (mode === "walk") {
      camera.position.set(controls.target.x + 400, 1600, controls.target.z + 400);
      controls.maxPolarAngle = Math.PI * 0.85;
    } else {
      controls.maxPolarAngle = Math.PI * 0.49;
    }
    controls.update();
  }

  function fit() {
    const plan = store.get();
    const boxes = plan.rooms.length ? plan.rooms : [{ x: 0, y: 0, w: 6000, h: 4000 }];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const room of boxes) {
      minX = Math.min(minX, room.x);
      minY = Math.min(minY, room.y);
      maxX = Math.max(maxX, room.x + room.w);
      maxY = Math.max(maxY, room.y + room.h);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 2000);
    controls.target.set(cx, 0, cz);
    camera.position.set(cx + span * 0.85, span * 0.95, cz + span * 0.85);
    controls.update();
  }

  function capture() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  }

  window.addEventListener("resize", resize);
  store.subscribe(rebuild);
  resize();
  rebuild();
  fit();
  frame();

  function getPose() {
    return {
      mode,
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z,
    };
  }

  function setPose(pose) {
    if (!pose) return;
    camera.position.set(pose.px, pose.py, pose.pz);
    controls.target.set(pose.tx, pose.ty, pose.tz);
    setMode(pose.mode || "sky");
  }

  function setSelection(next) {
    selection = next?.ids?.length ? { kind: next.kind, ids: [...next.ids] } : null;
    rebuild();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const hit = rayHit(event);
    if (!hit) {
      blank = selection ? { x: event.clientX, y: event.clientY } : null;
      return;
    }
    blank = null;
    if (hit.pick === "spin") {
      const entry = store.get().items.find((row) => row.id === hit.id);
      if (!entry || entry.locked) return;
      const point = pointerOnPlane(event, itemBaseY(entry, store.get(), store.get().settings.ceiling) + 30);
      if (!point) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      spin = {
        id: entry.id,
        startRot: Number(entry.rot) || 0,
        startAngle: Math.atan2(point.z - entry.y, point.x - entry.x),
        pending: true,
      };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      return;
    }
    if (hit.pick === "item") {
      const entry = store.get().items.find((row) => row.id === hit.id);
      const already = selection?.kind === "item" && selection.ids.length === 1 && selection.ids[0] === hit.id;
      if (already && entry && !entry.locked && !entry.openingId && entry.place !== "wall") {
        const point = pointerOnPlane(event, itemBaseY(entry, store.get(), store.get().settings.ceiling) + 30);
        if (point) {
          event.stopImmediatePropagation();
          event.preventDefault();
          slide = {
            id: entry.id,
            startX: entry.x,
            startY: entry.y,
            originX: point.x,
            originZ: point.z,
            starts: slideStarts(store.get(), entry.id),
            pending: true,
          };
          try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
          return;
        }
      }
    }
    event.stopImmediatePropagation();
    if (ui?.tool !== "select") ui?.setTool("select");
    if (hit.pick === "opening") ui?.select({ kind: "opening", ids: [hit.id] });
    else ui?.select({ kind: "item", ids: [hit.id] });
  }, true);

  canvas.addEventListener("pointermove", (event) => {
    if (slide) {
      const plan = store.get();
      const entry = plan.items.find((row) => row.id === slide.id);
      if (!entry || entry.locked) {
        endGesture();
        return;
      }
      const point = pointerOnPlane(event, itemBaseY(entry, plan, plan.settings.ceiling) + 30);
      if (!point) return;
      const steps = [plan.settings.module / plan.settings.division, (Number(plan.settings.wall) || 150) / 2];
      const enabled = plan.settings.snap !== false;
      const x = snapValue(slide.startX + (point.x - slide.originX), steps, enabled);
      const y = snapValue(slide.startY + (point.z - slide.originZ), steps, enabled);
      if (Math.round(entry.x) === Math.round(x) && Math.round(entry.y) === Math.round(y)) return;
      if (slide.pending) {
        store.checkpoint();
        slide.pending = false;
      }
      store.mutate((draft) => {
        const row = draft.items.find((item) => item.id === slide.id);
        if (!row || row.locked) return;
        row.x = x;
        row.y = y;
        shiftGuests(draft, [row.id], slide.starts);
      });
      return;
    }
    if (!spin) return;
    const plan = store.get();
    const entry = plan.items.find((row) => row.id === spin.id);
    if (!entry || entry.locked) {
      endGesture();
      return;
    }
    const point = pointerOnPlane(event, itemBaseY(entry, plan, plan.settings.ceiling) + 30);
    if (!point) return;
    let delta = Math.atan2(point.z - entry.y, point.x - entry.x) - spin.startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = Number(plan.settings.rotationStep) || 15;
    let rot = spin.startRot + (delta * 180) / Math.PI;
    rot = Math.round(rot / step) * step;
    rot = ((rot % 360) + 360) % 360;
    if (Math.round(Number(entry.rot) || 0) === rot) return;
    if (spin.pending) {
      store.checkpoint();
      spin.pending = false;
    }
    store.mutate((draft) => {
      const row = draft.items.find((item) => item.id === spin.id);
      if (!row || row.locked) return;
      row.rot = rot;
      const guests = draft.items.filter((item) => item.hostId === row.id).map((item) => item.id);
      seatItems(draft, [row.id, ...guests]);
    });
  });

  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);

  return { setMode, resize, fit, getPose, setPose, capture, setSelection };
}

function roomFor(entry, plan) {
  if (entry.roomId) {
    const named = plan.rooms.find((room) => room.id === entry.roomId);
    if (named) return named;
  }
  for (let i = plan.rooms.length - 1; i >= 0; i -= 1) {
    const room = plan.rooms[i];
    if (pointInRoom(room, entry.x, entry.y)) return room;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleVector(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function lineIntersect(p, d, q, e) {
  const det = d.x * e.y - d.y * e.x;
  if (Math.abs(det) < 1e-6) return null;
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / det;
  return { x: p.x + d.x * s, y: p.y + d.y * s };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
