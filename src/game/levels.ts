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
    title: "Cheese Wedge",
    aliceTimeMs: 42000,
    catSpeed: 88,
    title: "Pantry Dash",
    aliceTimeMs: 38000,
    catSpeed: 72,
    theme: {
      name: "Cheese",
      skyTop: "#ffd966",
      skyBottom: "#fff2cc",
      floor: 0xffe599,
      wallTop: 0xf1c232,
      wallSide: 0xbf9000,
      accent: 0xff9900,
      hazard: 0xcc0000,
      trim: 0x7f6000,
      hud: "#b45f06",
      fog: 0xfff2cc,
    },
    map: [
      "       #       ",
      "      #W#      ",
      "     #...#     ",
      "    #..#..#    ",
      "   #.......#   ",
      "  #..###.G..#  ",
      " #P.......C..# ",
      "#...#..T...#..#",
      "###############"
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
    title: "Sweetheart",
    aliceTimeMs: 36000,
    catSpeed: 112,
    title: "Garden Run",
    aliceTimeMs: 32000,
    catSpeed: 105,
    theme: {
      name: "Heart",
      skyTop: "#f4cccc",
      skyBottom: "#ea9999",
      floor: 0xe06666,
      wallTop: 0xcc0000,
      wallSide: 0x990000,
      accent: 0xffffff,
      hazard: 0x000000,
      trim: 0x660000,
      hud: "#660000",
      fog: 0xf4cccc,
    },
    map: [
      "  ###   ###  ",
      " #P..# #..W# ",
      "#.G...#...T.#",
      "#...........#",
      " #..##.##..# ",
      "  #.......#  ",
      "   #..C..#   ",
      "    #...#    ",
      "     #.#     ",
      "      #      "
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
    title: "Midnight Octagon",
    aliceTimeMs: 32000,
    catSpeed: 126,
    title: "Moonlight Attic",
    aliceTimeMs: 26000,
    catSpeed: 130,
    theme: {
      name: "Night",
      skyTop: "#0b0c10",
      skyBottom: "#1f2833",
      floor: 0x2a313d,
      wallTop: 0x45a29e,
      wallSide: 0x1f2833,
      accent: 0x66fcf1,
      hazard: 0xff0000,
      trim: 0xc5c6c7,
      hud: "#66fcf1",
      fog: 0x0b0c10,
    },
    map: [
      "   #######   ",
      "  #.......#  ",
      " #..##.##..# ",
      "#P...G.....W#",
      "#..#.....#..#",
      "#....T...C..#",
      " #..##.##..# ",
      "  #.......#  ",
      "   #######   "
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
