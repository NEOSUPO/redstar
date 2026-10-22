/** Representative catalog for the local planner. Sizes are millimetres. */
export const ROOM_TYPES = [
  ["実験室", "#d5e4f2"],
  ["測定室", "#e7e2f5"],
  ["培養室", "#d9f0e3"],
  ["BSL実験室", "#f6d9d9"],
  ["秤量室", "#f8efd2"],
  ["保管庫", "#e6e6e6"],
  ["フリーザー室", "#d4eef5"],
  ["実験準備室", "#f3e6d8"],
  ["共同機器室", "#dde7f8"],
  ["研究室", "#e8f0d8"],
  ["会議室", "#f7e3d4"],
  ["更衣室", "#eee6f6"],
  ["ロッカールーム", "#e8e8f2"],
  ["ホール", "#f3f0e4"],
  ["階段", "#ececec"],
  ["廊下", "#f4f4f4"],
  ["機械室", "#e5e5e0"],
  ["吹抜", "#f7f7f7"],
  ["PS", "#f6ead9"],
  ["EPS", "#f8e4c8"],
].map(([name, color]) => ({ name, color }));

export const CATALOG = [
  item("hood", "ヒュームフード", ["ライフアイテム", "ヒュームフード"], 1800, 900, 2400, "floor", "#7eafd4"),
  item("bench", "実験台", ["ライフアイテム", "ラボファニチャー"], 1800, 750, 850, "floor", "#e4d0b0"),
  item("sink", "流し台", ["ライフアイテム", "ラボファニチャー"], 1500, 750, 850, "floor", "#d7e3ea"),
  item("balance", "天秤台", ["ライフアイテム", "ラボファニチャー"], 900, 750, 850, "floor", "#efe6d6"),
  item("cabinet", "薬品保管庫", ["ライフアイテム", "ラボファニチャー"], 900, 600, 1800, "floor", "#c9d4c2"),
  item("shower", "緊急シャワー", ["ライフアイテム", "ラボファニチャー"], 400, 400, 2300, "floor", "#f0d36a"),
  item("chair", "ラボチェア", ["ライフアイテム", "ラボファニチャー"], 450, 450, 900, "floor", "#6f8fa8"),
  item("bsc", "安全キャビネット", ["ライフアイテム", "バイオテクノロジー関連設備"], 1500, 800, 2200, "floor", "#f2f6f8"),
  item("clean", "クリーンベンチ", ["ライフアイテム", "クリーン関連設備"], 1500, 800, 1900, "floor", "#e7f3f8"),
  item("outlet", "コンセント 01", ["ライフアイテム", "ユーティリティ", "コンセント"], 140, 80, 120, "wall", "#f4f4f4", { mountHeight: 1200 }),
  item("reel", "リーラーコンセント", ["ライフアイテム", "ユーティリティ", "コンセント"], 150, 150, 1200, "ceiling", "#c5ccd3", { scaleH: [800, 2500] }),
  item("pipe", "配管 直管", ["ライフアイテム", "ユーティリティ", "配管"], 250, 250, 500, "free", "#b7c0c8", { scalable: true }),
  item("elbow", "配管 90度管", ["ライフアイテム", "ユーティリティ", "配管"], 250, 100, 250, "free", "#aeb8c2", { scalable: true }),
  item("board", "盤", ["ライフアイテム", "ユーティリティ", "盤"], 900, 300, 2000, "free", "#e6d7b8", { scalable: true }),
  item("door", "左開き", ["階段/ドア/窓", "ドア"], 900, 40, 2100, "wall", "#c9a27a", { leaf: "door", swing: "single", hand: "left" }),
  item("door-right", "右開き", ["階段/ドア/窓", "ドア"], 900, 40, 2100, "wall", "#c9a27a", { leaf: "door", swing: "single", hand: "right" }),
  item("door-double", "両開き", ["階段/ドア/窓", "ドア"], 1600, 40, 2100, "wall", "#c9a27a", { leaf: "door", swing: "double" }),
  item("door-push", "押し戸", ["階段/ドア/窓", "ドア"], 900, 40, 2100, "wall", "#b9835a", { leaf: "door", swing: "push", hand: "left" }),
  item("door-slide", "引き戸", ["階段/ドア/窓", "ドア"], 1600, 40, 2100, "wall", "#d7c4a8", { leaf: "door", swing: "slide", hand: "left" }),
  item("window", "窓", ["階段/ドア/窓", "窓"], 1400, 40, 1200, "wall", "#b9d7ea", { leaf: "window", swing: "window" }),
  item("pillar", "柱", ["柱/梁", "柱"], 400, 400, 2700, "floor", "#9aa3ad", { scalable: true }),
  item("beam", "梁", ["柱/梁", "梁"], 3000, 300, 400, "ceiling", "#b7b0a4", { scalable: true }),
  item("light", "照明", ["ライフアイテム", "照明"], 600, 600, 80, "ceiling", "#f7f3e8", { light: true }),
  item("kitchen", "キッチン", ["住宅設備", "キッチン"], 2400, 650, 850, "floor", "#e8e4dc", { residential: true, scalable: true }),
  item("bath", "浴室", ["住宅設備", "浴室"], 1600, 1600, 2200, "floor", "#d5e6ea", { residential: true, scalable: true }),
  item("toilet", "トイレ", ["住宅設備", "トイレ"], 900, 1600, 2200, "floor", "#e7eef2", { residential: true, scalable: true }),
  item("wash", "洗面", ["住宅設備", "洗面"], 900, 600, 1800, "floor", "#f4f1ea", { residential: true, scalable: true }),
];

function item(id, name, category, w, d, h, place, color, extra = {}) {
  return { id, name, category, w, d, h, place, color, price: null, ...extra };
}

export function catalogById(id) {
  return CATALOG.find((entry) => entry.id === id) || null;
}

export function lookupItem(id, extras = []) {
  return extras.find((entry) => entry.id === id) || catalogById(id);
}

export function categoryTree(extras = []) {
  const root = [];
  for (const entry of [...CATALOG, ...extras]) {
    let level = root;
    for (const name of entry.category) {
      let node = level.find((child) => child.name === name);
      if (!node) {
        node = { name, children: [], items: [] };
        level.push(node);
      }
      level = node.children;
      if (name === entry.category[entry.category.length - 1]) node.items.push(entry);
    }
  }
  return root;
}
