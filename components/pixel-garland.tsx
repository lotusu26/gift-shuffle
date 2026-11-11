const W = 120;
const H = 40;

const GREEN = {
  outline: "#0e2e26",
  dark: "#1b5a44",
  mid: "#2f7d55",
  light: "#5fa86a",
  shine: "#9fd38a",
} as const;

const GREENS = new Set<string>(Object.values(GREEN));

const SPRITE_COLORS: Record<string, string> = {
  o: "#2a1418",
  R: "#c62a35",
  r: "#8e1b25",
  P: "#ff8a80",
  Y: "#f2b630",
  y: "#b07a1f",
  L: "#ffe38a",
  B: "#2b5ea8",
  b: "#1b3f78",
  W: "#f4efe6",
};

const BOW_RED = [
  ".oo.....oo.",
  "oRRo...oRRo",
  "oRrRo.oRrRo",
  "oRrrRoRrrRo",
  "oRrRoroRrRo",
  ".oRRoroRRo.",
  "..ooRoRoo..",
  "..oRo.oRo..",
  ".oRo...oRo.",
  ".oo.....oo.",
];

const BOW_GOLD = BOW_RED.map((row) => row.replace(/R/g, "Y").replace(/r/g, "y"));

const STAR = [
  "...o...",
  "..oYo..",
  "ooYLYoo",
  "oYYLYYo",
  ".oYYYo.",
  ".oYoYo.",
  ".oo.oo.",
];

const BERRY = [".R.", "RPR", ".r."];

const ORNAMENT_SPRITES = {
  stripe: [
    "..ooo..",
    ".oRRRo.",
    "oRPRRRo",
    "oYYYYYo",
    "oRRRRRo",
    ".oYYYo.",
    "..ooo..",
  ],
  flake: [
    "..ooo..",
    ".oBBBo.",
    "oBWBWBo",
    "oBBWBBo",
    "oBWBWBo",
    ".obbbo.",
    "..ooo..",
  ],
  bell: [
    "..ooo..",
    ".oYLYo.",
    ".oYLYo.",
    ".oYYYo.",
    "oYYYYYo",
    "ooooooo",
    "...y...",
  ],
  bauble: [".ooo.", "oRPRo", "oRRRo", "orrro", ".ooo."],
  band: [
    "..ooo..",
    ".oRRRo.",
    "oRPRRRo",
    "oYRYRYo",
    "oRRRRRo",
    ".orrro.",
    "..ooo..",
  ],
  star: STAR,
} as const;

type Cell = { x: number; y: number; color: string };
type PixelPath = { color: string; d: string };

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function swagY(x: number) {
  const t = x / (W - 1);
  return Math.round(8 + 40 * t * (1 - t));
}

function toPaths(cells: Cell[]): PixelPath[] {
  const latest = new Map<string, Cell>();
  for (const cell of cells) latest.set(`${cell.x},${cell.y}`, cell);
  const byColor = new Map<string, Map<number, number[]>>();
  for (const cell of latest.values()) {
    const rows = byColor.get(cell.color) ?? new Map<number, number[]>();
    const xs = rows.get(cell.y) ?? [];
    xs.push(cell.x);
    rows.set(cell.y, xs);
    byColor.set(cell.color, rows);
  }
  return [...byColor].map(([color, rows]) => {
    let d = "";
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0];
      let end = start;
      for (const x of [...xs.slice(1), Number.NaN]) {
        if (x === end + 1) {
          end = x;
          continue;
        }
        d += `M${start} ${y}h${end - start + 1}v1h${start - end - 1}z`;
        start = x;
        end = x;
      }
    }
    return { color, d };
  });
}

function stamp(cells: Cell[], sprite: readonly string[], left: number, top: number) {
  sprite.forEach((row, dy) => {
    [...row].forEach((char, dx) => {
      const color = SPRITE_COLORS[char];
      if (color) cells.push({ x: left + dx, y: top + dy, color });
    });
  });
}

function buildGarland(): PixelPath[] {
  const grid: Array<Array<string | null>> = Array.from({ length: H }, () => Array(W).fill(null));
  const set = (x: number, y: number, color: string) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = color;
  };

  for (let x = 2; x < W - 2; x += 1) {
    const center = swagY(x);
    const up = 3 + (seeded(x, 1) < 0.35 ? 1 : 0);
    const down = 3 + (seeded(x, 2) < 0.35 ? 1 : 0);
    for (let y = center - up; y <= center + down; y += 1) set(x, y, GREEN.dark);
  }

  for (let x = 3; x < W - 3; x += 2) {
    const center = swagY(x);
    const lean = seeded(x, 3) < 0.5 ? -1 : 1;
    const length = 1 + Math.floor(seeded(x, 4) * 3);
    for (let k = 1; k <= length; k += 1) {
      if (seeded(x, 5) < 0.75) set(x + lean * k, center - 3 - k, k === length ? GREEN.mid : GREEN.dark);
      if (seeded(x, 6) < 0.75) set(x - lean * k, center + 3 + k, GREEN.dark);
    }
  }

  for (const [x, step] of [[2, -1], [W - 3, 1]] as const) {
    const center = swagY(x);
    for (let k = 1; k <= 3; k += 1) {
      set(x + step * k, center - k, GREEN.dark);
      set(x + step * k, center, GREEN.mid);
      set(x + step * k, center + k, GREEN.dark);
    }
  }

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (grid[y][x] !== GREEN.dark) continue;
      const roll = seeded(x * 131 + y, 7);
      const upper = y < swagY(x);
      if (roll < 0.06 && upper) grid[y][x] = GREEN.shine;
      else if (roll < 0.2 && upper) grid[y][x] = GREEN.light;
      else if (roll < 0.42) grid[y][x] = GREEN.mid;
    }
  }

  const outline: Cell[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (grid[y][x]) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const color = grid[y + dy]?.[x + dx];
        return color != null && GREENS.has(color);
      });
      if (touches) outline.push({ x, y, color: GREEN.outline });
    }
  }

  const cells: Cell[] = [...outline];
  grid.forEach((row, y) =>
    row.forEach((color, x) => {
      if (color) cells.push({ x, y, color });
    }),
  );

  for (const x of [12, 26, 40, 53, 67, 80, 94, 108]) {
    stamp(cells, BERRY, x - 1, swagY(x) - 1 + (x % 3) - 1);
  }
  for (const x of [20, 46, 73, 100]) stamp(cells, STAR, x - 3, swagY(x) - 4);
  for (const [x, gold] of [[7, false], [33, true], [60, false], [86, true], [113, false]] as const) {
    stamp(cells, gold ? BOW_GOLD : BOW_RED, x - 5, swagY(x) - 4);
  }
  return toPaths(cells);
}

type OrnamentKind = keyof typeof ORNAMENT_SPRITES;

const ORNAMENTS: Array<{ x: number; drop: number; kind: OrnamentKind; delay: string }> = [
  { x: 4, drop: 4, kind: "stripe", delay: "0s" },
  { x: 15, drop: 11, kind: "flake", delay: "-0.9s" },
  { x: 27, drop: 6, kind: "star", delay: "-0.3s" },
  { x: 40, drop: 3, kind: "bauble", delay: "-1.4s" },
  { x: 80, drop: 3, kind: "band", delay: "-0.6s" },
  { x: 93, drop: 6, kind: "bell", delay: "-1.1s" },
  { x: 105, drop: 11, kind: "flake", delay: "-0.2s" },
  { x: 116, drop: 4, kind: "stripe", delay: "-1.7s" },
];

function buildOrnament(drop: number, kind: OrnamentKind): PixelPath[] {
  const sprite = ORNAMENT_SPRITES[kind];
  const cells: Cell[] = [];
  for (let y = 0; y < drop; y += 1) cells.push({ x: 0, y, color: "#b8893b" });
  for (let x = -1; x <= 1; x += 1) cells.push({ x, y: drop, color: "#b07a1f" });
  stamp(cells, sprite, -Math.floor(sprite[0].length / 2), drop + 1);
  return toPaths(cells);
}

const GARLAND_PATHS = buildGarland();
const ORNAMENT_PATHS = ORNAMENTS.map((ornament) => ({
  ...ornament,
  top: swagY(ornament.x) + 2,
  paths: buildOrnament(ornament.drop, ornament.kind),
}));

export function PixelGarland() {
  return (
    <div className="popup-trim" aria-hidden>
      <svg className="popup-garland" viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
        {ORNAMENT_PATHS.map((ornament) => (
          <g key={ornament.x} transform={`translate(${ornament.x} ${ornament.top})`}>
            <g className="garland-ornament" style={{ animationDelay: ornament.delay }}>
              {ornament.paths.map((path) => (
                <path key={path.color} d={path.d} fill={path.color} />
              ))}
            </g>
          </g>
        ))}
        {GARLAND_PATHS.map((path) => (
          <path key={path.color} d={path.d} fill={path.color} />
        ))}
      </svg>
    </div>
  );
}
