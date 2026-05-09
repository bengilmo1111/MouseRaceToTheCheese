export type LevelTheme = {
  name: string;
  skyTop: string;
  skyBottom: string;
  floor: number;
  wallTop: number;
  wallSide: number;
  accent: number;
  hazard: number;
  trim: number;
  hud: string;
  fog: number;
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
    aliceTimeMs: 38000,
    catSpeed: 72,
    theme: {
      name: "Pantry",
      skyTop: "#f7d487",
      skyBottom: "#fff4d2",
      floor: 0xf7df93,
      wallTop: 0xe1a95f,
      wallSide: 0xb87133,
      accent: 0xffd84d,
      hazard: 0xc85644,
      trim: 0x8b5924,
      hud: "#7b4d15",
      fog: 0xfdebc0,
    },
    map: [
      "###################",
      "#P  #        #....#",
      "#.###.#####.#####.#",
      "#   #.....#     #G#",
      "###.###.###.###.#.#",
      "#...#...#   #     #",
      "#.#.###.#.###.#####",
      "#.#     #.....#...#",
      "#.#####.#.#.#####.#",
      "#G          #     #",
      "#.###############.#",
      "#C  T   G   T    W#",
      "###################",
    ],
  },
  {
    id: 2,
    title: "Garden Run",
    aliceTimeMs: 32000,
    catSpeed: 105,
    theme: {
      name: "Garden",
      skyTop: "#9dd9ac",
      skyBottom: "#e9ffd4",
      floor: 0xcfe89f,
      wallTop: 0x8bc16d,
      wallSide: 0x4a8a46,
      accent: 0x68d6ff,
      hazard: 0xd15d44,
      trim: 0x2f6b34,
      hud: "#275a2b",
      fog: 0xe9f7db,
    },
    map: [
      "###################",
      "#P            G...#",
      "#.###############.#",
      "# .             . #",
      "#.#######.#######.#",
      "#.#  .  #.#     #.#",
      "#.#.###.#.#.#.#.#.#",
      "#.# # # # # # # # #",
      "#.# # # # # # # #G#",
      "#.# #G# # # # # # #",
      "#.    #.#...#.#...#",
      "#C#T# # ....#T#  W#",
      "###################",
    ],
  },
  {
    id: 3,
    title: "Moonlight Attic",
    aliceTimeMs: 26000,
    catSpeed: 130,
    theme: {
      name: "Attic",
      skyTop: "#8093d8",
      skyBottom: "#d9e4ff",
      floor: 0xbcd1ff,
      wallTop: 0x8d9ae3,
      wallSide: 0x5865b6,
      accent: 0xfff08f,
      hazard: 0xc5645e,
      trim: 0x3a467f,
      hud: "#24316d",
      fog: 0xdfe6ff,
    },
    map: [
      "###################",
      "#P  #....#......G.#",
      "#.# #.##.#.######.#",
      "#.# #    #    #...#",
      "#.# ####.####.#.###",
      "#.#  G       T#...#",
      "#.######.#####.####",
      "#......#.#......#.#",
      "######.#.#.######.#",
      "#G    .#...#      #",
      "#.####.#####.######",
      "#C T..G..T..  G  W#",
      "###################",
    ],
  },
];
