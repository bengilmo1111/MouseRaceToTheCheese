export type LevelTheme = {
  name: string;
  floor: number;
  wallTop: number;
  wallFace: number;
  accent: number;
  hud: string;
  shadow: number;
};

export type LevelDefinition = {
  id: number;
  title: string;
  aliceTimeMs: number;
  catSpeed: number;
  theme: LevelTheme;
  map: string[];
};

export const LEVELS: LevelDefinition[] = [
  {
    id: 1,
    title: "Pantry Dash",
    aliceTimeMs: 42000,
    catSpeed: 88,
    theme: {
      name: "Pantry",
      floor: 0xf7df93,
      wallTop: 0xe1a95f,
      wallFace: 0xb87133,
      accent: 0xffd84d,
      hud: "#7b4d15",
      shadow: 0x7d5d2c,
    },
    map: [
      "#############",
      "#P..#....T.W#",
      "#.#.#.##.##.#",
      "#.#...#...#.#",
      "#.###.#.#.#.#",
      "#...G.#.#...#",
      "###.#.#.###.#",
      "#C..#...G...#",
      "#############",
    ],
  },
  {
    id: 2,
    title: "Garden Run",
    aliceTimeMs: 36000,
    catSpeed: 112,
    theme: {
      name: "Garden",
      floor: 0xcfe89f,
      wallTop: 0x8bc16d,
      wallFace: 0x4a8a46,
      accent: 0x68d6ff,
      hud: "#275a2b",
      shadow: 0x2d5c2b,
    },
    map: [
      "#############",
      "#P...#....#W#",
      "#.###.#.##.#G",
      "#...#.#....##",
      "###.#.####..#",
      "#...#....#T.#",
      "#.#.####.#..#",
      "#C#....G....#",
      "#############",
    ],
  },
  {
    id: 3,
    title: "Moonlight Attic",
    aliceTimeMs: 32000,
    catSpeed: 126,
    theme: {
      name: "Attic",
      floor: 0xbcd1ff,
      wallTop: 0x8d9ae3,
      wallFace: 0x5865b6,
      accent: 0xfff08f,
      hud: "#24316d",
      shadow: 0x26345b,
    },
    map: [
      "#############",
      "#P..#......W#",
      "#.#.#.#######",
      "#.#.#...G...#",
      "#...###.#.#.#",
      "###.....#.#.#",
      "#T#.#####.#.#",
      "#C....G.....#",
      "#############",
    ],
  },
];
