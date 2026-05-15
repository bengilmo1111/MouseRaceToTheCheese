import * as THREE from "three";
import { LEVELS, LevelDefinition } from "./levels";
import bgMusicUrl from "../music/The_Parmesan_Gambit.mp3";
import { AudioBus } from "./audio";

const MUTE_KEY = "mouseRace.muted";
const DIFFICULTY_KEY = "mouseRace.difficulty";

type ControlKey = "up" | "down" | "left" | "right";
type DifficultyKey = "easy" | "medium" | "hard";

type DifficultySettings = {
  label: string;
  catSpeedMultiplier: number;
  aliceTimeMultiplier: number;
  chaseRangeMultiplier: number;
  startingLives: number;
  extraLifeCrumbs: number;
  greenCrumbInterval: number;
  requiredKeyLimit?: number;
  forgivingHits: boolean;
};

type WallRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type MazePickup = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  active: boolean;
  pairIndex?: number;
  guideCrumb?: boolean;
};

type MazeHazard = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  kind: "trap" | "lava" | "water";
};

type MazeState = {
  map: string[];
  originX: number;
  originZ: number;
  rows: number;
  cols: number;
  walls: WallRect[];
  crumbs: MazePickup[];
  traps: MazeHazard[];
  trapGlows: THREE.Mesh[];
  gems: MazePickup[];
  cheeseKeys: MazePickup[];
  patrol: THREE.Vector3[];
  levelGroup: THREE.Group;
  startPoint: THREE.Vector3;
  cheesePoint: THREE.Vector3;
  catPoint: THREE.Vector3;
  mazeCenter: THREE.Vector3;
  mazeWidth: number;
  mazeDepth: number;
  sharedGeometries: THREE.BufferGeometry[];
  sharedMaterials: THREE.Material[];
};

type ScoutPin = {
  element: HTMLDivElement;
  getPosition: () => THREE.Vector3;
  isVisible: () => boolean;
};

const PLAYER_RADIUS = 0.42;
const CAT_RADIUS = 0.5;
const SCOUT_PEEK_DURATION_MS = 12000;
const SCOUT_CRUMBS_PER_CHARGE = 5;
const MAX_SCOUT_PEEKS = 3;
const DEFAULT_DIFFICULTY: DifficultyKey = "easy";
const DIFFICULTY_SETTINGS: Record<DifficultyKey, DifficultySettings> = {
  easy: {
    label: "Kid",
    catSpeedMultiplier: 0.38,
    aliceTimeMultiplier: 2.6,
    chaseRangeMultiplier: 0.68,
    startingLives: 5,
    extraLifeCrumbs: 2,
    greenCrumbInterval: 4,
    requiredKeyLimit: 1,
    forgivingHits: true,
  },
  medium: {
    label: "Medium",
    catSpeedMultiplier: 0.72,
    aliceTimeMultiplier: 1.45,
    chaseRangeMultiplier: 0.9,
    startingLives: 4,
    extraLifeCrumbs: 3,
    greenCrumbInterval: 7,
    requiredKeyLimit: 2,
    forgivingHits: false,
  },
  hard: {
    label: "Hard",
    catSpeedMultiplier: 1,
    aliceTimeMultiplier: 1,
    chaseRangeMultiplier: 1,
    startingLives: 3,
    extraLifeCrumbs: 3,
    greenCrumbInterval: 11,
    forgivingHits: false,
  },
};

export class MouseRace3D {
  private readonly host: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly clock = new THREE.Clock();
  private sceneLighting!: {
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    ambient: THREE.AmbientLight;
    floorGlow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
    island: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
    playerLight: THREE.PointLight;
  };
  private readonly tileSize = 2.6;
  private readonly moveSpeed = 6.0;
  private readonly accel = 18;
  private readonly decel = 12;
  private readonly turnSpeed = 3.0;
  private readonly hazardGraceMs = 1300;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly movementDelta = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly _tmpVec = new THREE.Vector3();
  private readonly _projected = new THREE.Vector3();
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private currentSpeed = 0;
  private targetSpeed = 0;
  private bankAngle = 0;
  private pitchAngle = 0;
  private turnRate = 0;
  private cameraShakeAmp = 0;
  private paused = false;
  private footstepAccum = 0;
  private readonly audio = new AudioBus();
  private readonly controls: Record<ControlKey, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  private levelIndex = 0;
  private startLevelIndex = 0;
  private lives = 3;
  private crumbs = 0;
  private extraLifeBank = 0;
  private hasSeenIntro = false;
  private levelComplete = false;
  private hasWonGame = false;
  private gemCooldownUntil = 0;
  private hazardLockedUntil = 0;
  private cheeseLockHintUntil = 0;
  private aliceElapsedMs = 0;
  private collectedCheeseKeys = 0;
  private scoutPeeks = 0;
  private scoutCrumbBank = 0;
  private scoutPeekUntil = 0;
  private wasScoutPeekActive = false;
  private currentHintTimeout = 0;
  private catPatrolIndex = 0;
  private playtestTick = 0;
  private playerHeading = 0;
  private cameraYaw = 0;
  private cameraInitialized = false;
  private catChasing = false;
  private difficulty: DifficultyKey = DEFAULT_DIFFICULTY;
  private scoutPins: ScoutPin[] = [];

  private bgMusic: HTMLAudioElement;

  private maze!: MazeState;
  private player!: THREE.Group;
  private mouseParts!: {
    earL: THREE.Object3D;
    earR: THREE.Object3D;
    tail: THREE.Object3D;
    eyeL: THREE.Object3D;
    eyeR: THREE.Object3D;
  };
  private cat!: THREE.Group;
  private cheese!: THREE.Group;

  private readonly hud = {
    root: this.must<HTMLDivElement>("hud"),
    level: this.must<HTMLDivElement>("hud-level"),
    status: this.must<HTMLDivElement>("hud-status"),
    toast: this.must<HTMLDivElement>("hud-toast"),
    vignette: this.must<HTMLDivElement>("vignette"),
    timerFill: this.must<HTMLDivElement>("timer-fill"),
    timerAlice: this.must<HTMLImageElement>("timer-alice"),
    scoutButton: this.must<HTMLButtonElement>("scout-btn"),
    scoutOverlay: this.must<HTMLDivElement>("scout-map-overlay"),
  };
  private lastGuideLabel = "";
  private lastDistanceText = "";
  private guideTrail?: THREE.Group;
  private guideTrailUntil = 0;
  private guideTrailTarget = "";
  private readonly pickupBursts: { mesh: THREE.Points; ageMs: number; lifeMs: number }[] = [];

  private readonly startScreen = this.must<HTMLDivElement>("start-screen");
  private readonly overlay = {
    root: this.must<HTMLDivElement>("overlay"),
    title: this.must<HTMLHeadingElement>("overlay-title"),
    body: this.must<HTMLParagraphElement>("overlay-body"),
    button: this.must<HTMLButtonElement>("overlay-btn"),
    icon: this.must<HTMLImageElement>("overlay-icon"),
  };
  private readonly touchControls = this.must<HTMLDivElement>("touch-controls");
  private readonly playtest = {
    state: this.must<HTMLPreElement>("playtest-state"),
  };

  constructor(host: HTMLElement) {
    this.host = host;
    this.bgMusic = new Audio(bgMusicUrl);
    this.bgMusic.loop = true;
    this.bgMusic.volume = 0.5;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.host.appendChild(this.renderer.domElement);

    this.audio.setMuted(localStorage.getItem(MUTE_KEY) === "1");
    this.buildSceneShell();
    this.bindUi();
    this.bindPlaytestUi();
    this.resize();
    this.animate();

    window.addEventListener("resize", this.resize);
  }

  private must<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing #${id} element.`);
    }

    return element as T;
  }

  private buildSceneShell(): void {
    this.scene.fog = new THREE.Fog(0xfdebc0, 18, 52);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const hemi = new THREE.HemisphereLight(0xfff6d9, 0x6e4421, 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1c7, 2.1);
    sun.position.set(12, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xffd7a0, 0.55);
    rim.position.set(-9, 7, -12);
    this.scene.add(rim);

    const ambient = new THREE.AmbientLight(0xffe6bd, 0.18);
    this.scene.add(ambient);

    const floorGlow = new THREE.Mesh(
      new THREE.CircleGeometry(46, 48),
      new THREE.MeshBasicMaterial({ color: 0xffefbe, transparent: true, opacity: 0.35 }),
    );
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.y = -0.08;
    this.scene.add(floorGlow);

    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(28, 34, 1.8, 8),
      new THREE.MeshStandardMaterial({ color: 0xf3d68f, roughness: 0.92 }),
    );
    island.position.y = -1;
    island.receiveShadow = true;
    this.scene.add(island);

    const playerLight = new THREE.PointLight(0xfff0c0, 0, 18, 0.85);
    playerLight.position.set(0, 2.2, 0);
    this.scene.add(playerLight);

    this.sceneLighting = { hemi, sun, rim, ambient, floorGlow, island, playerLight };

    this.player = this.buildMouse();
    this.cat = this.buildCat();
    this.cheese = this.buildCheese();

    this.scene.add(this.player, this.cat, this.cheese);
  }

  private bindUi(): void {
    this.bindDifficultyPicker();
    this.bindMazePicker();

    this.must<HTMLButtonElement>("start-btn").addEventListener("click", () => {
      this.startRun(true);
    });

    this.overlay.button.addEventListener("click", () => this.advanceOverlayFlow());
    this.hud.scoutButton.addEventListener("click", () => this.activateScoutPeek());
    const fullscreenTarget = this.host.parentElement ?? document.documentElement;
    const toggleFullscreen = (): void => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void fullscreenTarget.requestFullscreen();
      }
    };
    this.must<HTMLButtonElement>("fullscreen-btn").addEventListener("click", toggleFullscreen);
    this.must<HTMLButtonElement>("start-fullscreen-btn").addEventListener("click", toggleFullscreen);

    const muteBtn = this.must<HTMLButtonElement>("mute-btn");
    const refreshMuteIcon = (): void => {
      muteBtn.textContent = this.audio.isMuted() ? "🔇" : "🔊";
    };
    refreshMuteIcon();
    muteBtn.addEventListener("click", () => {
      this.audio.resume();
      const next = !this.audio.isMuted();
      this.audio.setMuted(next);
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      refreshMuteIcon();
    });

    window.addEventListener("keydown", (event) => {
      if (event.code === "ArrowUp" || event.code === "KeyW") this.controls.up = true;
      if (event.code === "ArrowDown" || event.code === "KeyS") this.controls.down = true;
      if (event.code === "ArrowLeft" || event.code === "KeyA") this.controls.left = true;
      if (event.code === "ArrowRight" || event.code === "KeyD") this.controls.right = true;
      if (event.code === "Space") {
        event.preventDefault();
        this.advanceOverlayFlow();
      }
      if (event.code === "Escape") {
        this.togglePause();
      }
      if (event.code === "KeyM") {
        event.preventDefault();
        this.activateScoutPeek();
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.code === "ArrowUp" || event.code === "KeyW") this.controls.up = false;
      if (event.code === "ArrowDown" || event.code === "KeyS") this.controls.down = false;
      if (event.code === "ArrowLeft" || event.code === "KeyA") this.controls.left = false;
      if (event.code === "ArrowRight" || event.code === "KeyD") this.controls.right = false;
    });

    const touchMap: Record<string, ControlKey> = {
      "touch-up": "up",
      "touch-down": "down",
      "touch-left": "left",
      "touch-right": "right",
    };

    const releaseAllTouchControls = (): void => {
      Object.entries(touchMap).forEach(([id, key]) => {
        this.controls[key] = false;
        this.must<HTMLButtonElement>(id).classList.remove("active");
      });
    };

    this.must<HTMLDivElement>("touch-controls").addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    Object.entries(touchMap).forEach(([id, key]) => {
      const element = this.must<HTMLButtonElement>(id);
      const activate = (value: boolean) => {
        this.controls[key] = value;
        element.classList.toggle("active", value);
      };
      const deactivate = (event: PointerEvent) => {
        event.preventDefault();
        activate(false);
      };

      element.addEventListener("contextmenu", (event) => {
        event.preventDefault();
      });
      element.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        activate(true);
      });
      element.addEventListener("pointerup", (event) => {
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        deactivate(event);
      });
      element.addEventListener("pointercancel", deactivate);
      element.addEventListener("lostpointercapture", () => activate(false));
    });

    window.addEventListener("blur", releaseAllTouchControls);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        releaseAllTouchControls();
      }
    });
  }

  private bindDifficultyPicker(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-difficulty]"));
    const savedDifficulty = localStorage.getItem(DIFFICULTY_KEY);
    const setDifficulty = (difficulty: DifficultyKey, persist = true): void => {
      this.difficulty = difficulty;
      if (persist) {
        localStorage.setItem(DIFFICULTY_KEY, difficulty);
      }
      buttons.forEach((button) => {
        const isActive = button.dataset.difficulty === difficulty;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    };

    buttons.forEach((button) => {
      const difficulty = button.dataset.difficulty as DifficultyKey | undefined;
      if (!difficulty || !(difficulty in DIFFICULTY_SETTINGS)) {
        return;
      }

      button.addEventListener("click", () => setDifficulty(difficulty));
    });

    if (savedDifficulty && savedDifficulty in DIFFICULTY_SETTINGS) {
      setDifficulty(savedDifficulty as DifficultyKey, false);
    } else {
      setDifficulty(this.difficulty, false);
    }
  }

  private bindMazePicker(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-maze]"));
    const setMaze = (index: number): void => {
      this.startLevelIndex = index;
      buttons.forEach((button) => {
        const isActive = Number(button.dataset.maze) === index;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    };

    buttons.forEach((button) => {
      const index = Number(button.dataset.maze);
      if (isNaN(index) || index < 0 || index >= LEVELS.length) return;
      button.addEventListener("click", () => setMaze(index));
    });

    setMaze(0);
  }

  private bindPlaytestUi(): void {
    const params = new URLSearchParams(window.location.search);
    const showPanel = params.get("playtest") === "1" || window.location.hash.includes("playtest");
    const panel = document.getElementById("playtest-panel");
    if (panel && showPanel) {
      panel.classList.remove("hidden");
    }

    const agentApi = {
      state: () => this.getStateSnapshot(),
      step: (dir: ControlKey) => this.stepMove(dir),
      startRun: () => this.startRun(true),
      reset: () => this.startRun(false),
      advance: () => this.advanceOverlayFlow(),
      warpCrumb: () => this.warpToPickup("crumb"),
      warpGreenCrumb: () => this.warpToPickup("greenCrumb"),
      warpGem: () => this.warpToPickup("gem"),
      warpTrap: () => this.warpToHazard("trap"),
      warpCheese: () => this.warpToCheese(),
      warpCat: () => this.warpToCat(),
      forceHit: () => this.triggerHazard("Forced agent hit."),
      setAliceProgress: (ratio: number) => {
        this.aliceElapsedMs = this.getAliceTimeMs(LEVELS[this.levelIndex]) * Math.max(0, Math.min(1, ratio));
      },
      showPanel: () => panel?.classList.remove("hidden"),
    };
    (window as unknown as { mouseRace?: typeof agentApi }).mouseRace = agentApi;

    this.must<HTMLButtonElement>("ptest-start").addEventListener("click", () => this.startRun(true));
    this.must<HTMLButtonElement>("ptest-continue").addEventListener("click", () => this.advanceOverlayFlow());
    this.must<HTMLButtonElement>("ptest-reset").addEventListener("click", () => this.startRun(false));
    this.must<HTMLButtonElement>("ptest-up").addEventListener("click", () => this.stepMove("up"));
    this.must<HTMLButtonElement>("ptest-down").addEventListener("click", () => this.stepMove("down"));
    this.must<HTMLButtonElement>("ptest-left").addEventListener("click", () => this.stepMove("left"));
    this.must<HTMLButtonElement>("ptest-right").addEventListener("click", () => this.stepMove("right"));
    this.must<HTMLButtonElement>("ptest-crumb").addEventListener("click", () => this.warpToPickup("crumb"));
    this.must<HTMLButtonElement>("ptest-green-crumb").addEventListener("click", () => this.warpToPickup("greenCrumb"));
    this.must<HTMLButtonElement>("ptest-gem").addEventListener("click", () => this.warpToPickup("gem"));
    this.must<HTMLButtonElement>("ptest-trap").addEventListener("click", () => this.warpToHazard("trap"));
    this.must<HTMLButtonElement>("ptest-cheese").addEventListener("click", () => this.warpToCheese());
    this.must<HTMLButtonElement>("ptest-cat").addEventListener("click", () => this.warpToCat());
    this.must<HTMLButtonElement>("ptest-alice").addEventListener("click", () => {
      this.aliceElapsedMs = this.getAliceTimeMs(LEVELS[this.levelIndex]) * 0.95;
      this.updatePlaytestState();
    });
    this.must<HTMLButtonElement>("ptest-hit").addEventListener("click", () => this.triggerHazard("Forced playtest hit."));
  }

  private startRun(fromStartScreen: boolean): void {
    if (fromStartScreen) {
      this.startScreen.classList.add("hidden");
    }
    this.audio.resume();

    if (this.bgMusic.paused) {
      this.bgMusic.play().catch((e) => console.warn("Audio play failed", e));
    }

    this.hud.root.classList.remove("hidden");
    this.levelIndex = this.startLevelIndex;
    this.lives = DIFFICULTY_SETTINGS[this.difficulty].startingLives;
    this.crumbs = 0;
    this.extraLifeBank = 0;
    this.scoutPeeks = 1;
    this.scoutCrumbBank = 0;
    this.scoutPeekUntil = 0;
    this.wasScoutPeekActive = false;
    this.hasWonGame = false;
    this.hasSeenIntro = false;
    this.loadLevel(this.startLevelIndex);
    this.showIntro();
  }

  private loadLevel(index: number): void {
    this.levelComplete = false;
    this.aliceElapsedMs = 0;
    this.gemCooldownUntil = 0;
    this.hazardLockedUntil = 0;
    this.cheeseLockHintUntil = 0;
    this.catPatrolIndex = 0;
    this.collectedCheeseKeys = 0;
    this.scoutPeeks = Math.min(MAX_SCOUT_PEEKS, Math.max(this.scoutPeeks, 1));
    this.scoutPeekUntil = 0;
    this.wasScoutPeekActive = false;
    this.clearGuideTrail();

    if (this.maze) {
      this.maze.sharedGeometries.forEach((g) => g.dispose());
      this.maze.sharedMaterials.forEach((m) => m.dispose());
      this.scene.remove(this.maze.levelGroup);
    }

    this.maze = this.buildLevel(LEVELS[index]);
    this.scene.add(this.maze.levelGroup);

    this.player.position.copy(this.maze.startPoint);
    this.cat.position.copy(this.maze.catPoint);
    this.cheese.position.copy(this.maze.cheesePoint);
    this.playerHeading = this.headingFromTo(this.maze.startPoint, this.maze.cheesePoint);
    this.cameraYaw = this.playerHeading;
    this.player.rotation.y = this.playerHeading;
    this.cameraInitialized = false;
    this.currentSpeed = 0;
    this.targetSpeed = 0;
    this.turnRate = 0;
    this.bankAngle = 0;
    this.pitchAngle = 0;
    this.footstepAccum = 0;
    this.catChasing = false;
    this.hud.vignette.classList.remove("active");
    this.updateTheme(LEVELS[index]);
    this.rebuildScoutPins();
    this.refreshHud();
  }

  private buildLevel(level: LevelDefinition): MazeState {
    const group = new THREE.Group();
    const walls: WallRect[] = [];
    const crumbs: MazePickup[] = [];
    const traps: MazeHazard[] = [];
    const trapGlows: THREE.Mesh[] = [];
    const gems: MazePickup[] = [];
    const cheeseKeys: MazePickup[] = [];
    const patrol: THREE.Vector3[] = [];

    const rows = level.map.length;
    const cols = level.map[0].length;
    const width = cols * this.tileSize;
    const depth = rows * this.tileSize;
    const originX = -width * 0.5 + this.tileSize * 0.5;
    const originZ = -depth * 0.5 + this.tileSize * 0.5;

    let startPoint = new THREE.Vector3();
    let cheesePoint = new THREE.Vector3();
    let catPoint = new THREE.Vector3();
    let crumbIndex = 0;

    const floorMat = this.createFloorMaterial(level, width, depth);
    const floorGeo = new THREE.BoxGeometry(width + 2.4, 0.5, depth + 2.4);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, -0.28, 0);
    floor.receiveShadow = true;
    group.add(floor);

    const wallMaterials = this.createWallMaterials(level);
    const wallScale = 0.94;
    const isThinPanel = level.theme.wallStyle === "cardboard" || level.theme.wallStyle === "stone" || level.theme.wallStyle === "bamboo" || level.theme.wallStyle === "metal";
    const wallHeight = level.theme.wallStyle === "stone" ? 1.75
      : level.theme.wallStyle === "bamboo" ? 1.55
      : level.theme.wallStyle === "cardboard" ? 1.45
      : level.theme.wallStyle === "metal" ? 1.65
      : 2.4;
    const panelLength = this.tileSize * 1.02;
    const panelThickness = this.tileSize * 0.16;
    const hPanelGeo = new THREE.BoxGeometry(panelLength, wallHeight, panelThickness);
    const vPanelGeo = new THREE.BoxGeometry(panelThickness, wallHeight, panelLength);
    const solidGeo = new THREE.BoxGeometry(this.tileSize * wallScale, wallHeight, this.tileSize * wallScale);
    const sharedGeometries = [hPanelGeo, vPanelGeo, solidGeo, floorGeo];
    const sharedMaterials: THREE.Material[] = [floorMat];
    const seenMats = new Set<THREE.Material>();
    for (const m of wallMaterials) {
      if (!seenMats.has(m)) { seenMats.add(m); sharedMaterials.push(m); }
    }
    const tapeMaterial = level.theme.wallStyle === "cardboard"
      ? new THREE.MeshStandardMaterial({ color: 0xe7c783, roughness: 0.9, transparent: true, opacity: 0.82 })
      : level.theme.wallStyle === "stone"
      ? new THREE.MeshStandardMaterial({ color: 0x1e3010, roughness: 0.95, transparent: true, opacity: 0.65 })
      : level.theme.wallStyle === "bamboo"
      ? new THREE.MeshStandardMaterial({ color: 0x1a0e06, roughness: 0.88, transparent: true, opacity: 0.72 })
      : level.theme.wallStyle === "metal"
      ? new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.2, transparent: true, opacity: 0.55, emissive: 0x004488, emissiveIntensity: 0.8 })
      : undefined;

    level.map.forEach((line, row) => {
      [...line].forEach((cell, col) => {
        const x = originX + col * this.tileSize;
        const z = originZ + row * this.tileSize;

        if (cell === "#") {
          if (isThinPanel) {
            const hasHorizontal = level.map[row]?.[col - 1] === "#" || level.map[row]?.[col + 1] === "#";
            const hasVertical = level.map[row - 1]?.[col] === "#" || level.map[row + 1]?.[col] === "#";

            if (hasHorizontal || !hasVertical) {
              const wall = new THREE.Mesh(hPanelGeo, wallMaterials);
              wall.position.set(x, wallHeight * 0.5 - 0.02, z);
              wall.castShadow = true;
              wall.receiveShadow = true;
              group.add(wall);
              if (tapeMaterial && (row + col) % 7 === 0) {
                this.addCardboardTape(group, x, z, panelLength * 0.42, panelThickness * 0.55, wallHeight, tapeMaterial, false);
              }
              walls.push({
                minX: x - panelLength * 0.5,
                maxX: x + panelLength * 0.5,
                minZ: z - panelThickness * 0.5,
                maxZ: z + panelThickness * 0.5,
              });
            }

            if (hasVertical) {
              const wall = new THREE.Mesh(vPanelGeo, wallMaterials);
              wall.position.set(x, wallHeight * 0.5 - 0.02, z);
              wall.castShadow = true;
              wall.receiveShadow = true;
              group.add(wall);
              if (tapeMaterial && (row + col) % 7 === 3) {
                this.addCardboardTape(group, x, z, panelThickness * 0.55, panelLength * 0.42, wallHeight, tapeMaterial, true);
              }
              walls.push({
                minX: x - panelThickness * 0.5,
                maxX: x + panelThickness * 0.5,
                minZ: z - panelLength * 0.5,
                maxZ: z + panelLength * 0.5,
              });
            }
            return;
          }

          const wallHalfSize = (this.tileSize * wallScale) / 2;
          const wall = new THREE.Mesh(solidGeo, wallMaterials);
          wall.position.set(x, wallHeight * 0.5 - 0.02, z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          group.add(wall);
          if (tapeMaterial && (row + col) % 5 === 0) {
            this.addCardboardTape(group, x, z, wallHalfSize, wallHalfSize, wallHeight, tapeMaterial, (row + col) % 2 === 0);
          }
          walls.push({
            minX: x - wallHalfSize,
            maxX: x + wallHalfSize,
            minZ: z - wallHalfSize,
            maxZ: z + wallHalfSize,
          });
          return;
        }

        if (cell === ".") {
          crumbIndex += 1;
          const isGuideCrumb = crumbIndex % DIFFICULTY_SETTINGS[this.difficulty].greenCrumbInterval === 0;
          const crumbGeom = new THREE.IcosahedronGeometry(0.18, 0);
          const posAttr = crumbGeom.getAttribute("position") as THREE.BufferAttribute;
          for (let v = 0; v < posAttr.count; v += 1) {
            const jitter = 0.55 + Math.random() * 0.6;
            posAttr.setXYZ(v, posAttr.getX(v) * jitter, posAttr.getY(v) * (0.5 + Math.random() * 0.6), posAttr.getZ(v) * jitter);
          }
          crumbGeom.computeVertexNormals();
          const crumbMesh = new THREE.Mesh(
            crumbGeom,
            new THREE.MeshStandardMaterial({
              color: isGuideCrumb ? 0x77f27a : 0xf2d27a,
              emissive: isGuideCrumb ? 0x24bf4f : 0xb98328,
              emissiveIntensity: isGuideCrumb ? 0.65 : 0.18,
              roughness: 0.85,
              flatShading: true,
            }),
          );
          crumbMesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
          crumbMesh.scale.setScalar(isGuideCrumb ? 1.18 : 1);
          crumbMesh.castShadow = true;
          crumbMesh.position.set(x, 0.18, z);
          if (isGuideCrumb) {
            const glow = new THREE.Mesh(
              new THREE.RingGeometry(0.32, 0.46, 24),
              new THREE.MeshBasicMaterial({
                color: 0x5cff80,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                depthWrite: false,
              }),
            );
            glow.rotation.x = -Math.PI / 2;
            glow.position.y = -0.14;
            crumbMesh.add(glow);
          }
          group.add(crumbMesh);
          crumbs.push({ mesh: crumbMesh, position: crumbMesh.position.clone(), active: true, guideCrumb: isGuideCrumb });
          return;
        }

        if (cell === "T") {
          const trap = this.buildMouseTrap();
          trap.position.set(x, 0.05, z);
          trap.rotation.y = Math.random() * Math.PI;
          group.add(trap);
          traps.push({ mesh: trap, position: trap.position.clone(), kind: "trap" });

          const glow = new THREE.Mesh(
            new THREE.RingGeometry(0.55, 0.95, 32),
            new THREE.MeshBasicMaterial({
              color: 0xff5a3a,
              transparent: true,
              opacity: 0.35,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          glow.rotation.x = -Math.PI / 2;
          glow.position.set(x, 0.012, z);
          glow.userData = { kind: "trap" };
          group.add(glow);
          trapGlows.push(glow);
          return;
        }

        if (cell === "L") {
          if (level.theme.hazardStyle === "void") {
            const voidTile = this.buildVoidRift();
            voidTile.position.set(x, 0.01, z);
            group.add(voidTile);
            traps.push({ mesh: voidTile, position: voidTile.position.clone(), kind: "lava" });
            const glow = new THREE.Mesh(
              new THREE.RingGeometry(0.28, 0.58, 32),
              new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }),
            );
            glow.rotation.x = -Math.PI / 2;
            glow.position.set(x, 0.022, z);
            glow.userData = { kind: "lava" };
            group.add(glow);
            trapGlows.push(glow);
          } else {
            const lavaTile = this.buildLavaPit();
            lavaTile.position.set(x, 0.01, z);
            group.add(lavaTile);
            traps.push({ mesh: lavaTile, position: lavaTile.position.clone(), kind: "lava" });
            const glow = new THREE.Mesh(
              new THREE.RingGeometry(0.32, 0.52, 32),
              new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
            );
            glow.rotation.x = -Math.PI / 2;
            glow.position.set(x, 0.022, z);
            glow.userData = { kind: "lava" };
            group.add(glow);
            trapGlows.push(glow);
          }
          return;
        }

        if (cell === "~") {
          const waterTile = this.buildWaterTrap();
          waterTile.position.set(x, 0.01, z);
          group.add(waterTile);
          traps.push({ mesh: waterTile, position: waterTile.position.clone(), kind: "water" });
          for (let ri = 0; ri < 3; ri += 1) {
            const inner = 0.18 + ri * 0.14;
            const ripple = new THREE.Mesh(
              new THREE.RingGeometry(inner, inner + 0.1, 32),
              new THREE.MeshBasicMaterial({ color: 0x40c8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
            );
            ripple.rotation.x = -Math.PI / 2;
            ripple.position.set(x, 0.022, z);
            ripple.userData = { kind: "water", phase: (ri / 3) * Math.PI * 2 };
            group.add(ripple);
            trapGlows.push(ripple);
          }
          return;
        }

        if (cell === "G") {
          const gem = this.buildGem(level.theme.accent);
          gem.position.set(x, 0.6, z);
          group.add(gem);
          gems.push({ mesh: gem, position: gem.position.clone(), active: true });
          return;
        }

        if (cell === "K") {
          const key = this.buildCheeseKey(level.theme.accent);
          key.position.set(x, 0.45, z);
          key.add(this.createWorldMarker("KEY", level.theme.accent, level.theme.trim, 0.95));
          group.add(key);
          cheeseKeys.push({ mesh: key, position: key.position.clone(), active: true });
          return;
        }

        if (cell === "P") {
          startPoint = new THREE.Vector3(x, 0.3, z);
        }

        if (cell === "W") {
          cheesePoint = new THREE.Vector3(x, 0.28, z);
        }

        if (cell === "C") {
          catPoint = new THREE.Vector3(x, 0.34, z);
          patrol.push(new THREE.Vector3(x, 0.34, z));
        }

        if (cell !== "#") {
          const neighbors = [
            level.map[row]?.[col - 1],
            level.map[row]?.[col + 1],
            level.map[row - 1]?.[col],
            level.map[row + 1]?.[col],
          ].filter((value) => value && value !== "#");

          if (neighbors.length >= 3) {
            patrol.push(new THREE.Vector3(x, 0.34, z));
          }
        }
      });
    });

    gems.forEach((gem, indexGem) => {
      gem.pairIndex = gems.length > 1 ? (indexGem + 1) % gems.length : undefined;
    });



    return {
      map: level.map,
      originX,
      originZ,
      rows,
      cols,
      walls,
      crumbs,
      traps,
      trapGlows,
      gems,
      cheeseKeys,
      patrol: patrol.length > 1 ? patrol : [catPoint.clone(), startPoint.clone()],
      levelGroup: group,
      startPoint,
      cheesePoint,
      catPoint,
      mazeCenter: new THREE.Vector3(0, 0, 0),
      mazeWidth: width,
      mazeDepth: depth,
      sharedGeometries,
      sharedMaterials,
    };
  }

  private buildMouse(): THREE.Group {
    const group = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xc4bdc9, roughness: 0.78 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xf6eef3, roughness: 0.85 });
    const earInner = new THREE.MeshStandardMaterial({ color: 0xf6b9cf, roughness: 0.55 });
    const sclera = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x141114, roughness: 0.2 });
    const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xff7aa0, roughness: 0.35, emissive: 0x661022, emissiveIntensity: 0.3 });
    const blushMat = new THREE.MeshStandardMaterial({ color: 0xff9bbf, roughness: 0.7, transparent: true, opacity: 0.55 });
    const pawMat = new THREE.MeshStandardMaterial({ color: 0xf3a8c0, roughness: 0.6 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a2228, roughness: 0.4 });
    const whiskerMat = new THREE.LineBasicMaterial({ color: 0x2a2530, transparent: true, opacity: 0.55 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xeea3b8, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 22, 22), fur);
    body.scale.set(1.08, 0.94, 1.45);
    body.position.y = 0.06;
    body.castShadow = true;
    group.add(body);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 18), bellyMat);
    belly.scale.set(0.9, 0.7, 1.32);
    belly.position.set(0, -0.08, 0.02);
    group.add(belly);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 22, 22), fur);
    head.position.set(0, 0.22, -0.52);
    head.scale.set(1.08, 1.02, 1.05);
    head.castShadow = true;
    group.add(head);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 14), bellyMat);
    snout.scale.set(0.95, 0.72, 1.1);
    snout.position.set(0, 0.08, -0.82);
    group.add(snout);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), noseMat);
    nose.position.set(0, 0.11, -0.95);
    group.add(nose);

    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.012, 6, 14, Math.PI),
      mouthMat,
    );
    mouth.rotation.set(0, 0, Math.PI);
    mouth.position.set(0, 0.0, -0.9);
    group.add(mouth);

    const buildEye = (side: number): THREE.Group => {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(side * 0.14, 0.28, -0.74);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.078, 16, 16), sclera);
      white.scale.set(1, 1, 0.65);
      eyeGroup.add(white);
      const dark = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 14), pupil);
      dark.position.set(side * -0.008, -0.006, -0.04);
      dark.scale.set(0.95, 1.05, 0.45);
      eyeGroup.add(dark);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), shineMat);
      shine.position.set(side * -0.022, 0.022, -0.07);
      eyeGroup.add(shine);
      return eyeGroup;
    };

    const eyeL = buildEye(-1);
    const eyeR = buildEye(1);
    group.add(eyeL, eyeR);

    for (const side of [-1, 1]) {
      const blush = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), blushMat);
      blush.scale.set(1, 0.45, 0.5);
      blush.position.set(side * 0.24, 0.1, -0.74);
      group.add(blush);
    }

    const buildEar = (side: number): THREE.Group => {
      const earGroup = new THREE.Group();
      earGroup.position.set(side * 0.22, 0.46, -0.5);
      const outer = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), fur);
      outer.scale.set(0.98, 0.4, 1);
      outer.castShadow = true;
      earGroup.add(outer);
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 14), earInner);
      inner.scale.set(0.9, 0.28, 0.95);
      inner.position.y = 0.04;
      earGroup.add(inner);
      earGroup.rotation.z = side * 0.16;
      return earGroup;
    };

    const earL = buildEar(-1);
    const earR = buildEar(1);
    group.add(earL, earR);

    for (const side of [-1, 1]) {
      const frontPaw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), pawMat);
      frontPaw.scale.set(1, 0.55, 1.2);
      frontPaw.position.set(side * 0.18, -0.24, -0.32);
      group.add(frontPaw);

      const backPaw = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), pawMat);
      backPaw.scale.set(1, 0.55, 1.3);
      backPaw.position.set(side * 0.22, -0.26, 0.28);
      group.add(backPaw);

      const whiskerGeom = new THREE.BufferGeometry();
      const wx = side * 0.14;
      const verts: number[] = [];
      for (let row = 0; row < 3; row += 1) {
        const angle = (row - 1) * 0.2;
        verts.push(wx, 0.04 + (row - 1) * 0.05, -0.86);
        verts.push(side * (0.14 + 0.42 * Math.cos(angle)), 0.04 + (row - 1) * 0.06, -0.86 - 0.34 * Math.sin(angle) - 0.05);
      }
      whiskerGeom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const whiskers = new THREE.LineSegments(whiskerGeom, whiskerMat);
      group.add(whiskers);
    }

    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0.02, 0.55);
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.05, 0.08, 0.26),
      new THREE.Vector3(-0.05, 0.22, 0.5),
      new THREE.Vector3(0.04, 0.36, 0.7),
    ]);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 24, 0.05, 8, false), tailMat);
    tail.castShadow = true;
    tailGroup.add(tail);
    group.add(tailGroup);

    this.mouseParts = { earL, earR, tail: tailGroup, eyeL, eyeR };
    return group;
  }

  private animateMouse(now: number): void {
    if (!this.mouseParts) return;

    const idleWag = Math.sin(now * 0.006) * 0.18;
    const turnWag = THREE.MathUtils.clamp(-this.turnRate * 0.18, -0.6, 0.6);
    const speedFactor = 1 + Math.min(1.5, Math.abs(this.currentSpeed) * 0.18);
    this.mouseParts.tail.rotation.z = (idleWag + turnWag) * speedFactor;
    this.mouseParts.tail.rotation.y = Math.sin(now * 0.0072 + 0.7) * 0.1 * speedFactor;

    const earBase = 0.16;
    const twitch = Math.sin(now * 0.011) * 0.06 + (Math.sin(now * 0.0017) > 0.97 ? 0.18 : 0);
    this.mouseParts.earL.rotation.z = -earBase + twitch;
    this.mouseParts.earR.rotation.z = earBase - twitch;
    this.mouseParts.earL.rotation.x = Math.sin(now * 0.009) * 0.05;
    this.mouseParts.earR.rotation.x = Math.sin(now * 0.009 + 0.4) * 0.05;

    const blinkPeriod = 3600;
    const phase = (now % blinkPeriod) / blinkPeriod;
    let blink = 0;
    if (phase > 0.94) {
      blink = Math.sin((phase - 0.94) / 0.06 * Math.PI);
    }
    const eyeY = 1 - blink * 0.92;
    this.mouseParts.eyeL.scale.y = eyeY;
    this.mouseParts.eyeR.scale.y = eyeY;
  }

  private buildCat(): THREE.Group {
    const group = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xee8a3a, roughness: 0.7, metalness: 0.02 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xa84a22, roughness: 0.78 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xfbe0b8, roughness: 0.85 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xfff08a, emissive: 0xfff08a, emissiveIntensity: 0.5, roughness: 0.3 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.2 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xff8aa8, roughness: 0.4 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 24), fur);
    body.scale.set(1.18, 0.95, 1.52);
    body.position.y = 0.06;
    body.castShadow = true;
    group.add(body);

    const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 18), belly);
    bellyMesh.scale.set(0.95, 0.65, 1.3);
    bellyMesh.position.set(0, -0.12, 0);
    group.add(bellyMesh);

    for (let i = 0; i < 5; i += 1) {
      const stripeRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.38 + i * 0.02, 0.05, 8, 18, Math.PI),
        stripe,
      );
      stripeRing.rotation.set(0, Math.PI / 2, 0);
      stripeRing.position.set(0, 0.18 - i * 0.05, -0.35 + i * 0.18);
      stripeRing.scale.set(1.2, 0.55, 1);
      group.add(stripeRing);
    }

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 18), fur);
    head.position.set(0, 0.26, -0.5);
    head.castShadow = true;
    group.add(head);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 14), belly);
    snout.scale.set(1, 0.7, 0.8);
    snout.position.set(0, 0.16, -0.74);
    group.add(snout);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), noseMat);
    nose.position.set(0, 0.22, -0.82);
    group.add(nose);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), eyeMat);
      eye.position.set(side * 0.13, 0.32, -0.66);
      group.add(eye);
      const slit = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6), pupil);
      slit.position.set(side * 0.13, 0.32, -0.7);
      group.add(slit);

      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 4), fur);
      ear.position.set(side * 0.2, 0.58, -0.56);
      ear.rotation.set(0, Math.PI / 4, side * 0.15);
      ear.castShadow = true;
      group.add(ear);
      const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), noseMat);
      earInner.position.set(side * 0.2, 0.55, -0.55);
      earInner.rotation.set(0, Math.PI / 4, side * 0.15);
      group.add(earInner);
    }

    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.05, 0.55),
      new THREE.Vector3(0.1, 0.2, 0.85),
      new THREE.Vector3(-0.05, 0.5, 1.0),
      new THREE.Vector3(0.18, 0.7, 0.86),
    ]);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 24, 0.07, 8, false), fur);
    tail.castShadow = true;
    group.add(tail);

    return group;
  }

  private buildCheese(): THREE.Group {
    const group = new THREE.Group();
    const cheeseMat = new THREE.MeshStandardMaterial({
      color: 0xffce46,
      roughness: 0.55,
      emissive: 0xf5a623,
      emissiveIntensity: 0.12,
    });
    const holeMat = new THREE.MeshStandardMaterial({
      color: 0xc88e1c,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });

    const wedgeShape = new THREE.Shape();
    wedgeShape.moveTo(0, 0);
    wedgeShape.lineTo(1.2, 0);
    wedgeShape.lineTo(0, 0.78);
    wedgeShape.lineTo(0, 0);
    const wedge = new THREE.Mesh(
      new THREE.ExtrudeGeometry(wedgeShape, {
        depth: 0.7,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 3,
      }),
      cheeseMat,
    );
    wedge.position.set(-0.55, 0.0, -0.35);
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    group.add(wedge);

    const holePositions = [
      [-0.2, 0.18, 0.1, 0.09],
      [0.18, 0.32, 0.34, 0.07],
      [0.08, 0.48, -0.12, 0.06],
      [-0.32, 0.12, -0.18, 0.08],
      [0.32, 0.2, -0.04, 0.05],
    ];
    for (const hole of holePositions) {
      const indent = new THREE.Mesh(new THREE.SphereGeometry(hole[3], 12, 10), holeMat);
      indent.position.set(hole[0], hole[1], hole[2]);
      group.add(indent);
    }

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.24, 4.8, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xfff1a7,
        emissive: 0xffc84e,
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    beacon.position.y = 2.4;
    group.add(beacon);

    const goalRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.94, 0.08, 10, 20),
      new THREE.MeshStandardMaterial({
        color: 0xffd04f,
        emissive: 0xffc84e,
        emissiveIntensity: 0.4,
      }),
    );
    goalRing.rotation.x = Math.PI / 2;
    goalRing.position.y = 0.08;
    group.add(goalRing);
    group.add(this.createWorldMarker("CHEESE", 0xfff1a7, 0x7f4a00, 2.85));

    return group;
  }

  private buildGem(accentColor: number): THREE.Group {
    const group = new THREE.Group();

    const hull = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        emissive: accentColor,
        emissiveIntensity: 0.55,
        roughness: 0.06,
        metalness: 0.55,
        transparent: true,
        opacity: 0.78,
        flatShading: true,
      }),
    );
    hull.scale.set(0.78, 1.45, 0.78);
    hull.castShadow = true;
    group.add(hull);

    const facetEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(hull.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    facetEdges.scale.copy(hull.scale);
    group.add(facetEdges);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    core.scale.set(0.95, 1.35, 0.95);
    group.add(core);

    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.022, 8, 36),
      new THREE.MeshBasicMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.7,
      }),
    );
    orbit.rotation.x = Math.PI / 2.4;
    group.add(orbit);

    const orbit2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.014, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
      }),
    );
    orbit2.rotation.x = Math.PI / 1.8;
    orbit2.rotation.z = Math.PI / 6;
    group.add(orbit2);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.95, 36),
      new THREE.MeshBasicMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.55;
    group.add(halo);

    return group;
  }

  private buildCheeseKey(accentColor: number): THREE.Group {
    const group = new THREE.Group();
    const keyMat = new THREE.MeshStandardMaterial({
      color: 0xffdf5a,
      emissive: accentColor,
      emissiveIntensity: 0.35,
      roughness: 0.28,
      metalness: 0.55,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a16, roughness: 0.5, metalness: 0.25 });

    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 10, 24), keyMat);
    bow.rotation.x = Math.PI / 2;
    bow.castShadow = true;
    group.add(bow);

    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.72), keyMat);
    shaft.position.z = 0.48;
    shaft.castShadow = true;
    group.add(shaft);

    const toothA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.12), darkMat);
    toothA.position.set(0.08, 0, 0.82);
    toothA.castShadow = true;
    group.add(toothA);

    const toothB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.12), darkMat);
    toothB.position.set(-0.04, 0, 0.62);
    toothB.castShadow = true;
    group.add(toothB);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.78, 32),
      new THREE.MeshBasicMaterial({
        color: accentColor,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.38;
    group.add(glow);

    return group;
  }

  private buildMouseTrap(): THREE.Group {
    const group = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xc28a4a, roughness: 0.82 });
    const woodDarkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a28, roughness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.65, roughness: 0.35 });
    const metalDarkMat = new THREE.MeshStandardMaterial({ color: 0x6e7077, metalness: 0.7, roughness: 0.4 });
    const baitMat = new THREE.MeshStandardMaterial({ color: 0xffce46, roughness: 0.55, emissive: 0xb88318, emissiveIntensity: 0.12 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.13, 1.55), woodMat);
    base.position.y = 0.065;
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);

    const baseEdge = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.04, 1.57), woodDarkMat);
    baseEdge.position.y = 0.018;
    group.add(baseEdge);

    const baitPad = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.32), woodDarkMat);
    baitPad.position.set(0, 0.14, 0.5);
    group.add(baitPad);

    const bait = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), baitMat);
    bait.scale.set(1, 0.55, 1);
    bait.position.set(0, 0.18, 0.5);
    bait.castShadow = true;
    group.add(bait);

    const snapBar = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.025, 10, 24, Math.PI),
      metalMat,
    );
    snapBar.rotation.set(0, 0, 0);
    snapBar.position.set(0, 0.16, -0.2);
    snapBar.castShadow = true;
    group.add(snapBar);

    for (const sx of [-0.42, 0.42]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), metalDarkMat);
      post.position.set(sx, 0.18, -0.2);
      group.add(post);
    }

    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 18), metalMat);
    spring.rotation.set(0, 0, Math.PI / 2);
    spring.position.set(-0.42, 0.18, -0.2);
    group.add(spring);
    const spring2 = spring.clone();
    spring2.position.set(0.42, 0.18, -0.2);
    group.add(spring2);

    const holdBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 8), metalMat);
    holdBar.rotation.x = Math.PI / 2;
    holdBar.position.set(0.0, 0.16, 0.05);
    group.add(holdBar);

    const catchPin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.16), metalDarkMat);
    catchPin.position.set(0, 0.155, 0.36);
    group.add(catchPin);

    return group;
  }

  private createWorldMarker(text: string, color: number, textColor: number, height: number): THREE.Object3D {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) {
      return new THREE.Group();
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff9ef";
    context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.lineWidth = 8;
    context.beginPath();
    context.roundRect(10, 10, 172, 54, 18);
    context.fill();
    context.stroke();
    context.fillStyle = `#${textColor.toString(16).padStart(6, "0")}`;
    context.font = "bold 34px Trebuchet MS";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 96, 38);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, height, 0);
    sprite.scale.set(1.8, 0.9, 1);
    return sprite;
  }

  private rebuildScoutPins(): void {
    this.hud.scoutOverlay.replaceChildren();
    this.scoutPins = [];

    this.addScoutPin("YOU", 0x45a7ff, () => this.player.position, () => true);
    this.addScoutPin("CAT", 0xff5a5a, () => this.cat.position, () => true);
    this.addScoutPin("CHEESE", 0xffde4f, () => this.cheese.position, () => true);

    this.maze.cheeseKeys.forEach((key, index) => {
      this.addScoutPin(`KEY ${index + 1}`, 0xb879ff, () => key.position, () => key.active);
    });
  }

  private addScoutPin(
    text: string,
    color: number,
    getPosition: () => THREE.Vector3,
    isVisible: () => boolean,
  ): void {
    const element = document.createElement("div");
    element.className = "scout-pin";
    element.textContent = text;
    element.style.setProperty("--pin-color", `#${color.toString(16).padStart(6, "0")}`);
    element.hidden = true;
    this.hud.scoutOverlay.appendChild(element);
    this.scoutPins.push({ element, getPosition, isVisible });
  }

  private updateScoutPins(): void {
    const scoutActive = this.isScoutPeekActive();
    this.hud.scoutOverlay.classList.toggle("hidden", !scoutActive);
    this.hud.scoutOverlay.setAttribute("aria-hidden", String(!scoutActive));
    this.touchControls.classList.toggle("scout-hidden", scoutActive);

    if (!scoutActive) {
      for (const pin of this.scoutPins) {
        pin.element.hidden = true;
      }
      return;
    }

    const overlayWidth = this.hud.scoutOverlay.clientWidth || window.innerWidth;
    const overlayHeight = this.hud.scoutOverlay.clientHeight || window.innerHeight;

    for (const pin of this.scoutPins) {
      const visible = pin.isVisible();
      pin.element.hidden = !visible;
      if (!visible) continue;
      this._projected.copy(pin.getPosition());
      this._projected.y = 3.25;
      this._projected.project(this.camera);
      const x = THREE.MathUtils.clamp((this._projected.x * 0.5 + 0.5) * overlayWidth, 70, overlayWidth - 70);
      const y = THREE.MathUtils.clamp((-this._projected.y * 0.5 + 0.5) * overlayHeight, 108, overlayHeight - 120);
      pin.element.style.left = `${x}px`;
      pin.element.style.top = `${y}px`;
    }
  }

  private createFloorMaterial(level: LevelDefinition, width: number, depth: number): THREE.Material {
    const rep = (w: number, d: number) => [Math.max(6, w / 8), Math.max(6, d / 8)] as const;
    if (level.theme.wallStyle === "cardboard") {
      const map = this.createCardboardTexture("floor");
      const [rx, ry] = rep(width, depth);
      map.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ color: level.theme.floor, map, roughness: 0.98 });
    }
    if (level.theme.wallStyle === "stone") {
      const map = this.createStoneTexture("floor");
      const [rx, ry] = rep(width, depth);
      map.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ color: level.theme.floor, map, roughness: 0.97, bumpMap: map, bumpScale: 0.03, emissive: level.theme.floor, emissiveIntensity: 0.08 });
    }
    if (level.theme.wallStyle === "bamboo") {
      const map = this.createBambooTexture("floor");
      const [rx, ry] = rep(width, depth);
      map.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ color: level.theme.floor, map, roughness: 0.96, emissive: level.theme.floor, emissiveIntensity: 0.08 });
    }
    if (level.theme.wallStyle === "metal") {
      const map = this.createMetalTexture("floor");
      const [rx, ry] = rep(width, depth);
      map.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({
        color: level.theme.floor,
        map,
        roughness: 0.3,
        metalness: 0.7,
        emissive: 0x003366,
        emissiveIntensity: 0.32,
      });
    }
    return new THREE.MeshStandardMaterial({ color: level.theme.floor, roughness: 0.96 });
  }

  private createWallMaterials(level: LevelDefinition): THREE.Material[] {
    if (level.theme.wallStyle === "cardboard") {
      const sideMap = this.createCardboardTexture("side");
      const topMap = this.createCardboardTexture("top");
      const side = new THREE.MeshStandardMaterial({
        color: level.theme.wallSide, map: sideMap, emissive: 0x5b3518, emissiveIntensity: 0.1,
        roughness: 0.96, bumpMap: sideMap, bumpScale: 0.035,
      });
      const top = new THREE.MeshStandardMaterial({
        color: level.theme.wallTop, map: topMap, roughness: 0.98, bumpMap: topMap, bumpScale: 0.025,
      });
      return [side, side, top, side, side, side];
    }
    if (level.theme.wallStyle === "stone") {
      const sideMap = this.createStoneTexture("side");
      const topMap = this.createStoneTexture("top");
      const side = new THREE.MeshStandardMaterial({
        color: level.theme.wallSide, map: sideMap, roughness: 0.94,
        emissive: level.theme.wallSide, emissiveIntensity: 0.07,
        bumpMap: sideMap, bumpScale: 0.06,
      });
      const top = new THREE.MeshStandardMaterial({
        color: level.theme.wallTop, map: topMap, roughness: 0.98,
        emissive: level.theme.wallTop, emissiveIntensity: 0.06,
        bumpMap: topMap, bumpScale: 0.04,
      });
      return [side, side, top, side, side, side];
    }
    if (level.theme.wallStyle === "bamboo") {
      const sideMap = this.createBambooTexture("side");
      const topMap = this.createBambooTexture("top");
      const side = new THREE.MeshStandardMaterial({
        color: level.theme.wallSide, map: sideMap, roughness: 0.82,
        emissive: level.theme.wallSide, emissiveIntensity: 0.08,
        bumpMap: sideMap, bumpScale: 0.04,
      });
      const top = new THREE.MeshStandardMaterial({
        color: level.theme.wallTop, map: topMap, roughness: 0.88,
        emissive: level.theme.wallTop, emissiveIntensity: 0.07,
      });
      return [side, side, top, side, side, side];
    }
    if (level.theme.wallStyle === "metal") {
      const sideMap = this.createMetalTexture("side");
      const topMap = this.createMetalTexture("top");
      const side = new THREE.MeshStandardMaterial({
        color: level.theme.wallSide,
        map: sideMap,
        roughness: 0.22,
        metalness: 0.85,
        emissive: 0x0066aa,
        emissiveIntensity: 0.3,
        bumpMap: sideMap,
        bumpScale: 0.02,
      });
      const top = new THREE.MeshStandardMaterial({
        color: level.theme.wallTop,
        map: topMap,
        roughness: 0.18,
        metalness: 0.9,
        emissive: 0x0088cc,
        emissiveIntensity: 0.28,
      });
      return [side, side, top, side, side, side];
    }
    const wallTop = new THREE.MeshStandardMaterial({ color: level.theme.wallTop, roughness: 0.72 });
    const wallSide = new THREE.MeshStandardMaterial({ color: level.theme.wallSide, roughness: 0.88 });
    return [wallSide, wallSide, wallTop, wallSide, wallSide, wallSide];
  }

  private createCardboardTexture(kind: "floor" | "side" | "top"): THREE.CanvasTexture {
    const cached = this.textureCache.get(`cardboard-${kind}`);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) {
      return new THREE.CanvasTexture(canvas);
    }

    const base = kind === "side" ? "#cf9557" : kind === "top" ? "#dba45d" : "#d5a760";
    const fiber = kind === "side" ? "#8f5f33" : "#9b6a33";
    const highlight = kind === "side" ? "#efbd7d" : "#edc27a";
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.globalAlpha = 0.28;
    for (let y = 0; y < canvas.height; y += kind === "side" ? 9 : 15) {
      context.fillStyle = y % 2 === 0 ? highlight : fiber;
      context.fillRect(0, y, canvas.width, kind === "side" ? 2 : 1);
    }

    context.globalAlpha = 0.22;
    for (let i = 0; i < 120; i += 1) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const length = 8 + Math.random() * 28;
      context.strokeStyle = Math.random() > 0.5 ? fiber : highlight;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + length, y + (Math.random() - 0.5) * 5);
      context.stroke();
    }

    if (kind === "top") {
      context.globalAlpha = 0.25;
      context.strokeStyle = "#775028";
      context.lineWidth = 3;
      context.setLineDash([18, 12]);
      context.beginPath();
      context.moveTo(18, 28);
      context.lineTo(238, 228);
      context.stroke();
      context.setLineDash([]);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.textureCache.set(`cardboard-${kind}`, texture);
    return texture;
  }

  private createStoneTexture(kind: "floor" | "side" | "top"): THREE.CanvasTexture {
    const cached = this.textureCache.get(`stone-${kind}`);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = kind === "floor" ? "#2e231a" : kind === "top" ? "#4a3a2a" : "#352820";
    ctx.fillRect(0, 0, 256, 256);
    if (kind === "side") {
      const brickH = 32, brickW = 64;
      for (let row = 0; row < 256 / brickH; row++) {
        const offset = (row % 2) * (brickW / 2);
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#1a120c";
        ctx.fillRect(0, row * brickH, 256, 2);
        for (let col = -1; col < 256 / brickW + 1; col++) {
          ctx.fillRect(col * brickW + offset, row * brickH, 2, brickH);
        }
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = "#6a5040";
        ctx.fillRect(0, row * brickH + 4, 256, brickH - 8);
      }
    }
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 80; i++) {
      const px = Math.random() * 256, py = Math.random() * 256;
      const len = 4 + Math.random() * 18;
      ctx.strokeStyle = Math.random() > 0.5 ? "#1a1008" : "#5a4030";
      ctx.lineWidth = Math.random() > 0.7 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + len * (Math.random() - 0.5), py + len * (Math.random() - 0.5));
      ctx.stroke();
    }
    if (kind === "top") {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = "#1a0e08";
      for (let i = 0; i < 8; i++) {
        const cx = 20 + Math.random() * 216, cy = 20 + Math.random() * 216, r = 10 + Math.random() * 22;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.textureCache.set(`stone-${kind}`, texture);
    return texture;
  }

  private createBambooTexture(kind: "floor" | "side" | "top"): THREE.CanvasTexture {
    const cached = this.textureCache.get(`bamboo-${kind}`);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = kind === "floor" ? "#1e3010" : kind === "top" ? "#3a5a20" : "#2e4a18";
    ctx.fillRect(0, 0, 256, 256);
    if (kind === "side") {
      const nodeSpacing = 38;
      ctx.globalAlpha = 0.18;
      for (let y = nodeSpacing * 0.6; y < 256; y += nodeSpacing) {
        ctx.fillStyle = "#0e1e08";
        ctx.fillRect(0, y - 3, 256, 6);
        ctx.fillStyle = "#5a8a30";
        ctx.fillRect(0, y + 3, 256, 2);
      }
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = "#7ab040";
      for (let x = 0; x < 256; x += 8) {
        ctx.fillRect(x, 0, 1, 256);
      }
    }
    if (kind === "top") {
      ctx.globalAlpha = 0.3;
      const cx = 128, cy = 128;
      for (let r = 100; r > 0; r -= 18) {
        ctx.strokeStyle = r % 36 === 0 ? "#0e1e08" : "#5a8030";
        ctx.lineWidth = r % 36 === 0 ? 3 : 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (kind === "floor") {
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 60; i++) {
        const lx = Math.random() * 256, ly = Math.random() * 256;
        const lw = 6 + Math.random() * 20, lh = 3 + Math.random() * 8;
        ctx.fillStyle = Math.random() > 0.5 ? "#3a6020" : "#0e1a08";
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(Math.random() * Math.PI);
        ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
        ctx.restore();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.textureCache.set(`bamboo-${kind}`, texture);
    return texture;
  }

  private createMetalTexture(kind: "floor" | "side" | "top"): THREE.CanvasTexture {
    const cacheKey = `metal-${kind}`;
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;

    if (kind === "side") {
      // Metallic panel with horizontal seams and a cyan edge-light strip
      ctx.fillStyle = "#121e2e";
      ctx.fillRect(0, 0, 256, 256);

      // Panel seams
      ctx.globalAlpha = 0.55;
      for (let y = 64; y < 256; y += 64) {
        ctx.fillStyle = "#050c18";
        ctx.fillRect(0, y - 2, 256, 4);
        ctx.fillStyle = "#1e3050";
        ctx.fillRect(0, y + 2, 256, 2);
      }

      // Vertical rivet lines
      ctx.globalAlpha = 0.18;
      for (let x = 32; x < 256; x += 32) {
        ctx.fillStyle = "#0a1828";
        ctx.fillRect(x, 0, 1, 256);
      }

      // Rivets at seam intersections
      ctx.globalAlpha = 0.7;
      for (let y = 64; y < 256; y += 64) {
        for (let x = 32; x < 256; x += 32) {
          ctx.fillStyle = "#2a4060";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#4a7090";
          ctx.beginPath();
          ctx.arc(x - 1, y - 1, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Cyan edge glow strip at bottom
      ctx.globalAlpha = 1;
      const grad = ctx.createLinearGradient(0, 220, 0, 256);
      grad.addColorStop(0, "rgba(0, 180, 255, 0)");
      grad.addColorStop(0.6, "rgba(0, 180, 255, 0.28)");
      grad.addColorStop(1, "rgba(0, 220, 255, 0.55)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 220, 256, 36);

    } else if (kind === "top") {
      // Brushed metal top — concentric panel rings
      ctx.fillStyle = "#1a2a40";
      ctx.fillRect(0, 0, 256, 256);
      ctx.globalAlpha = 0.3;
      for (let r = 120; r > 0; r -= 16) {
        ctx.strokeStyle = r % 32 === 0 ? "#0a1e38" : "#243c58";
        ctx.lineWidth = r % 32 === 0 ? 3 : 1;
        ctx.beginPath();
        ctx.arc(128, 128, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Corner bolt holes
      ctx.globalAlpha = 0.8;
      for (const [cx, cy] of [[24, 24], [232, 24], [24, 232], [232, 232]] as [number, number][]) {
        ctx.fillStyle = "#050c18";
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#304860";
        ctx.beginPath();
        ctx.arc(cx - 1, cy - 1, 3, 0, Math.PI * 2);
        ctx.fill();
      }

    } else {
      // Floor — grid of glowing cyan lines on dark metal
      ctx.fillStyle = "#080e18";
      ctx.fillRect(0, 0, 256, 256);

      // Grid lines
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = "#00aaff";
      ctx.lineWidth = 1;
      for (let i = 32; i < 256; i += 32) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
      }

      // Brighter intersection dots
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#00ccff";
      for (let x = 32; x < 256; x += 32) {
        for (let y = 32; y < 256; y += 32) {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Subtle scratches
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = "#4488aa";
      ctx.lineWidth = 1;
      for (let i = 0; i < 30; i++) {
        const sx = Math.random() * 256, sy = Math.random() * 256;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (Math.random() - 0.5) * 40, sy + (Math.random() - 0.5) * 40);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private buildLavaPit(): THREE.Group {
    const group = new THREE.Group();
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0a0400";
    ctx.fillRect(0, 0, 128, 128);
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 24; i++) {
      const x1 = Math.random() * 128, y1 = Math.random() * 128;
      const x2 = x1 + (Math.random() - 0.5) * 60, y2 = y1 + (Math.random() - 0.5) * 60;
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, "#ff6600");
      grad.addColorStop(0.5, "#ffaa00");
      grad.addColorStop(1, "#cc2200");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 8; i++) {
      const bx = Math.random() * 110 + 9, by = Math.random() * 110 + 9;
      ctx.fillStyle = "#ff8800";
      ctx.beginPath();
      ctx.arc(bx, by, 2 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const lavaMap = new THREE.CanvasTexture(canvas);
    lavaMap.colorSpace = THREE.SRGBColorSpace;
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.04, 0.78),
      new THREE.MeshStandardMaterial({
        color: 0xff4400,
        map: lavaMap,
        emissive: 0xff3300,
        emissiveIntensity: 0.75,
        roughness: 0.55,
        metalness: 0.1,
      }),
    );
    tile.castShadow = false;
    tile.receiveShadow = true;
    group.add(tile);
    const innerGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, 0.65),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    innerGlow.rotation.x = -Math.PI / 2;
    innerGlow.position.y = 0.025;
    group.add(innerGlow);
    return group;
  }

  private buildWaterTrap(): THREE.Group {
    const group = new THREE.Group();
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#041428";
    ctx.fillRect(0, 0, 128, 128);
    ctx.globalAlpha = 0.45;
    const cx = 64, cy = 64;
    for (let r = 56; r > 0; r -= 12) {
      ctx.strokeStyle = r % 24 === 0 ? "#2090cc" : "#104070";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 12; i++) {
      const px = Math.random() * 128, py = Math.random() * 128, pr = 2 + Math.random() * 6;
      ctx.fillStyle = "#40b8ff";
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    const waterMap = new THREE.CanvasTexture(canvas);
    waterMap.colorSpace = THREE.SRGBColorSpace;
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.04, 0.78),
      new THREE.MeshStandardMaterial({
        color: 0x0055bb,
        map: waterMap,
        emissive: 0x0044aa,
        emissiveIntensity: 0.22,
        roughness: 0.25,
        metalness: 0.15,
        transparent: true,
        opacity: 0.88,
      }),
    );
    tile.castShadow = false;
    tile.receiveShadow = true;
    group.add(tile);
    const sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ color: 0x40c8ff, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.y = 0.025;
    group.add(sheen);
    return group;
  }

  private buildVoidRift(): THREE.Group {
    const group = new THREE.Group();
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    // Dark void center with purple energy rings
    const radialGrad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    radialGrad.addColorStop(0, "#000000");
    radialGrad.addColorStop(0.35, "#0a0020");
    radialGrad.addColorStop(0.65, "#220055");
    radialGrad.addColorStop(0.85, "#4400aa");
    radialGrad.addColorStop(1, "#6600cc");
    ctx.fillStyle = radialGrad;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();

    // Energy ring lines
    ctx.globalAlpha = 0.7;
    for (let r = 15; r < 60; r += 12) {
      ctx.strokeStyle = `rgba(${140 + r}, 0, ${200 + r * 0.5}, 0.6)`;
      ctx.lineWidth = r < 30 ? 3 : 2;
      ctx.beginPath();
      ctx.arc(64, 64, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Spark streaks
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const r1 = 20 + Math.random() * 10;
      const r2 = 48 + Math.random() * 12;
      ctx.strokeStyle = "#aa44ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(angle) * r1, 64 + Math.sin(angle) * r1);
      ctx.lineTo(64 + Math.cos(angle + 0.3) * r2, 64 + Math.sin(angle + 0.3) * r2);
      ctx.stroke();
    }

    const voidMap = new THREE.CanvasTexture(canvas);
    voidMap.colorSpace = THREE.SRGBColorSpace;
    voidMap.needsUpdate = true;

    const tile = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 32),
      new THREE.MeshBasicMaterial({
        map: voidMap,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.y = 0.012;
    group.add(tile);

    // Outer glow ring
    const outerGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1.08, 32),
      new THREE.MeshBasicMaterial({
        color: 0x6600cc,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    outerGlow.rotation.x = -Math.PI / 2;
    outerGlow.position.y = 0.008;
    group.add(outerGlow);

    return group;
  }

  private addCardboardTape(
    group: THREE.Group,
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    wallHeight: number,
    material: THREE.Material,
    rotate: boolean,
  ): void {
    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(rotate ? 0.12 : halfX * 1.55, 0.035, rotate ? halfZ * 1.55 : 0.12),
      material,
    );
    tape.position.set(x, wallHeight + 0.015, z);
    tape.receiveShadow = true;
    group.add(tape);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();
    const scoutActive = this.isScoutPeekActive();

    if (!this.isOverlayOpen() && !this.paused && this.maze && !scoutActive) {
      this.updatePlayer(delta, now);
      this.updateCat(delta, now);
      this.updatePickups(delta, now);
      this.updateAlice(delta);
      this.updateCamera(delta);
    } else if (this.player) {
      this.updateCamera(delta);
    }

    this.updatePickupBursts(delta);
    this.updateGuideTrail(now);
    this.updateScoutPins();
    this.animateMouse(now);
    this.updatePlayerLight();

    this.playtestTick += 1;
    if (this.playtestTick % 5 === 0) {
      this.updatePlaytestState();
      this.updateGuidanceHud();
      this.refreshScoutButton();
    }

    this.renderer.render(this.scene, this.camera);
  };

  private stepMove(direction: ControlKey): void {
    if (!this.maze || this.isOverlayOpen()) {
      return;
    }

    if (direction === "left" || direction === "right") {
      this.playerHeading -= (direction === "right" ? 1 : -1) * 0.45;
    } else {
      const sign = direction === "up" ? 1 : -1;
      const dx = -Math.sin(this.playerHeading) * sign * 0.7;
      const dz = -Math.cos(this.playerHeading) * sign * 0.7;
      this.movementDelta.set(dx, 0, dz);
      this.moveWithCollisions(this.player.position, PLAYER_RADIUS, this.movementDelta);
    }

    this.player.rotation.y = this.playerHeading;
    this.updatePickups(0, performance.now());
    this.updatePlaytestState();
  }

  private warpToPickup(kind: "crumb" | "greenCrumb" | "gem"): void {
    if (!this.maze) {
      return;
    }

    const pool =
      kind === "gem"
        ? this.maze.gems
        : this.maze.crumbs.filter((item) => (kind === "greenCrumb" ? item.guideCrumb : !item.guideCrumb));
    const target = pool.find((item) => item.active);
    if (!target) {
      this.flashHint(`No active ${kind === "greenCrumb" ? "green crumb" : kind} found.`);
      return;
    }

    this.player.position.set(target.position.x, 0.3, target.position.z);
    this.updatePickups(0, performance.now());
    this.updatePlaytestState();
  }

  private warpToHazard(kind: "trap"): void {
    if (!this.maze) {
      return;
    }

    const target = kind === "trap" ? this.maze.traps[0] : undefined;
    if (!target) {
      return;
    }

    this.player.position.set(target.position.x, 0.3, target.position.z);
    this.updatePickups(0, performance.now());
    this.updatePlaytestState();
  }

  private warpToCheese(): void {
    if (!this.maze) {
      return;
    }

    this.player.position.set(this.cheese.position.x, 0.3, this.cheese.position.z);
    this.updatePickups(0, performance.now());
    this.updatePlaytestState();
  }

  private warpToCat(): void {
    this.player.position.set(this.cat.position.x, 0.3, this.cat.position.z);
    this.updateCat(0, performance.now());
    this.updatePlaytestState();
  }

  private updatePlayer(delta: number, now: number): void {
    const turnInput = (this.controls.right ? 1 : 0) - (this.controls.left ? 1 : 0);
    const forwardInput = (this.controls.up ? 1 : 0) - (this.controls.down ? 1 : 0);

    const desiredTurnRate = -turnInput * this.turnSpeed * (this.currentSpeed > 1 ? 1 : 0.7);
    this.turnRate = THREE.MathUtils.lerp(this.turnRate, desiredTurnRate, Math.min(1, delta * 8));
    this.playerHeading += this.turnRate * delta;

    this.targetSpeed = this.moveSpeed * forwardInput * (forwardInput < 0 ? 0.55 : 1);
    const accelRate = forwardInput !== 0 ? this.accel : this.decel;
    this.currentSpeed = THREE.MathUtils.lerp(
      this.currentSpeed,
      this.targetSpeed,
      Math.min(1, delta * accelRate * 0.18),
    );
    if (Math.abs(this.currentSpeed) < 0.01) this.currentSpeed = 0;

    if (this.currentSpeed !== 0) {
      const forwardX = -Math.sin(this.playerHeading);
      const forwardZ = -Math.cos(this.playerHeading);
      this.playerVelocity.set(forwardX * this.currentSpeed * delta, 0, forwardZ * this.currentSpeed * delta);
      this.moveWithCollisions(this.player.position, PLAYER_RADIUS, this.playerVelocity);
      if (Math.abs(this.currentSpeed) > 0.4) {
        this.footstepAccum += Math.abs(this.currentSpeed) * delta;
        if (this.footstepAccum >= 0.45) {
          this.footstepAccum = 0;
          this.audio.tickFootstep();
        }
      } else {
        this.footstepAccum = 0;
      }
    } else {
      this.footstepAccum = 0;
    }

    const targetBank = THREE.MathUtils.clamp(-this.turnRate * 0.25, -0.35, 0.35);
    this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, targetBank, Math.min(1, delta * 8));
    const speedFraction = this.currentSpeed / this.moveSpeed;
    const targetPitch = THREE.MathUtils.clamp(speedFraction * 0.18, -0.18, 0.18);
    this.pitchAngle = THREE.MathUtils.lerp(this.pitchAngle, targetPitch, Math.min(1, delta * 6));

    const moving = Math.abs(this.currentSpeed) > 0.2;
    const bob = moving ? Math.sin(now * 0.018) * 0.05 * Math.abs(speedFraction) : 0;
    const waddle = moving ? Math.sin(now * 0.015) * 0.08 * Math.abs(speedFraction) : 0;
    this.player.rotation.set(this.pitchAngle, this.playerHeading, this.bankAngle + waddle);
    this.player.position.y = 0.3 + bob;
  }

  private headingFromTo(from: THREE.Vector3, to: THREE.Vector3): number {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx === 0 && dz === 0) {
      return 0;
    }
    return Math.atan2(-dx, -dz);
  }

  private moveWithCollisions(position: THREE.Vector3, radius: number, delta: THREE.Vector3): void {
    position.x += delta.x;
    this.resolveAxis(position, radius, "x");
    position.z += delta.z;
    this.resolveAxis(position, radius, "z");
  }

  private resolveAxis(position: THREE.Vector3, radius: number, axis: "x" | "z"): void {
    for (const wall of this.maze.walls) {
      if (
        position.x + radius <= wall.minX ||
        position.x - radius >= wall.maxX ||
        position.z + radius <= wall.minZ ||
        position.z - radius >= wall.maxZ
      ) {
        continue;
      }

      if (axis === "x") {
        if (position.x < (wall.minX + wall.maxX) * 0.5) {
          position.x = wall.minX - radius;
        } else {
          position.x = wall.maxX + radius;
        }
      } else {
        if (position.z < (wall.minZ + wall.maxZ) * 0.5) {
          position.z = wall.minZ - radius;
        } else {
          position.z = wall.maxZ + radius;
        }
      }
    }
  }

  private updateCat(delta: number, now: number): void {
    const patrol = this.maze.patrol;
    if (patrol.length === 0) {
      return;
    }

    const playerVector = this._tmpVec.copy(this.player.position).sub(this.cat.position);
    playerVector.y = 0;
    const playerDistance = playerVector.length();
    const baseChaseRange = this.levelIndex === 0 ? 5.0 : this.levelIndex === 1 ? 6.0 : 7.0;
    const chaseRange = baseChaseRange * DIFFICULTY_SETTINGS[this.difficulty].chaseRangeMultiplier;
    const shouldChase = playerDistance < chaseRange;

    if (shouldChase !== this.catChasing) {
      this.catChasing = shouldChase;
      this.flashHint(shouldChase ? "Cat spotted you!" : "Cat lost you.", shouldChase);
      if (shouldChase) this.audio.playCatAlert();
      else this.audio.playCatLost();
      this.hud.vignette.classList.toggle("active", shouldChase);
    }

    const target = shouldChase ? this.player.position : patrol[this.catPatrolIndex];
    const vector = this._tmpVec.copy(target).sub(this.cat.position);
    vector.y = 0;
    const distance = vector.length();

    if (!shouldChase && distance < 0.15) {
      this.catPatrolIndex = (this.catPatrolIndex + 1) % patrol.length;
      return;
    }

    const speedScale = shouldChase ? (this.levelIndex === 0 ? 1.05 : this.levelIndex === 1 ? 1.18 : 1.3) : 0.85;
    vector.normalize().multiplyScalar((this.getCatSpeed(LEVELS[this.levelIndex]) / 24) * speedScale * delta);
    this.moveWithCollisions(this.cat.position, CAT_RADIUS, vector);
    this.cat.rotation.y = Math.atan2(-vector.x, -vector.z);
    this.cat.rotation.z = Math.sin(now * 0.012) * (shouldChase ? 0.14 : 0.09);
    this.cat.position.y = 0.34 + Math.sin(now * 0.008) * 0.04;

    if (this.player.position.distanceToSquared(this.cat.position) < 0.85 * 0.85) {
      this.triggerHazard("The cat caught you!");
    }
  }

  private updatePickups(_delta: number, now: number): void {
    for (const crumb of this.maze.crumbs) {
      if (!crumb.active) continue;
      crumb.mesh.rotation.y += 0.03;
      if (crumb.guideCrumb) {
        crumb.mesh.position.y = 0.22 + Math.sin(now * 0.005 + crumb.position.x) * 0.04;
      }
      if (this.player.position.distanceToSquared(crumb.position) < 0.85 * 0.85) {
        crumb.active = false;
        crumb.mesh.visible = false;
        this.crumbs += 1;
        this.extraLifeBank += 1;
        const crumbsForLife = DIFFICULTY_SETTINGS[this.difficulty].extraLifeCrumbs;
        if (this.extraLifeBank >= crumbsForLife) {
          this.extraLifeBank = 0;
          this.lives += 1;
          this.flashHint(`${crumbsForLife} crumbs earned another life.`);
          this.audio.playLifeUp();
        } else {
          this.audio.playCrumb();
        }
        this.collectScoutCrumb();
        if (crumb.guideCrumb) {
          this.revealObjectivePath();
        }
        this.spawnPickupBurst(crumb.position, crumb.guideCrumb ? 0x65ff87 : 0xffe084);
        this.refreshHud();
      }
    }

    for (const trap of this.maze.traps) {
      if (this.player.position.distanceToSquared(trap.position) < 0.75 * 0.75) {
        this.audio.playTrap();
        const msg = trap.kind === "lava" ? "You fell into a lava pit!"
          : trap.kind === "water" ? "You sank into a water trap!"
          : "A mousetrap snapped shut!";
        this.triggerHazard(msg);
      }
    }

    if (this.maze.trapGlows.length) {
      for (const glow of this.maze.trapGlows) {
        const kind = (glow.userData as { kind?: string; phase?: number }).kind || "trap";
        if (kind === "lava") {
          const pulse = 0.5 + Math.sin(now * 0.009) * 0.5;
          const scale = 0.82 + pulse * 0.32;
          glow.scale.set(scale, scale, scale);
          (glow.material as THREE.MeshBasicMaterial).opacity = 0.32 + pulse * 0.52;
        } else if (kind === "water") {
          const phase = (glow.userData as { phase?: number }).phase ?? 0;
          const pulse = 0.5 + Math.sin(now * 0.0018 + phase) * 0.5;
          const scale = 0.55 + pulse * 0.85;
          glow.scale.set(scale, scale, scale);
          (glow.material as THREE.MeshBasicMaterial).opacity = 0.06 + pulse * 0.34;
        } else {
          const pulse = 0.5 + Math.sin(now * 0.004) * 0.5;
          const scale = 0.9 + pulse * 0.18;
          glow.scale.set(scale, scale, scale);
          (glow.material as THREE.MeshBasicMaterial).opacity = 0.22 + pulse * 0.28;
        }
      }
    }

    for (const gem of this.maze.gems) {
      if (!gem.active) continue;
      gem.mesh.rotation.y += 0.04;
      gem.mesh.position.y = 0.6 + Math.sin(now * 0.004 + gem.position.x) * 0.1;
      if (this.player.position.distanceToSquared(gem.position) < 0.95 * 0.95) {
        this.teleportFromGem(gem);
      }
    }

    for (const key of this.maze.cheeseKeys) {
      if (!key.active) continue;
      key.mesh.rotation.y += 0.035;
      key.mesh.position.y = 0.45 + Math.sin(now * 0.0045 + key.position.z) * 0.08;
      if (this.player.position.distanceToSquared(key.position) < 0.9 * 0.9) {
        key.active = false;
        key.mesh.visible = false;
        this.collectedCheeseKeys += 1;
        this.spawnPickupBurst(key.position, 0xffdf5a);
        this.audio.playGem();
        this.flashHint(`Cheese key found. ${this.remainingRequiredCheeseKeys()} still needed.`);
        this.refreshHud();
      }
    }

    this.cheese.rotation.y += 0.02;
    if (this.player.position.distanceToSquared(this.cheese.position) < 1.0 * 1.0) {
      const remainingKeys = this.remainingRequiredCheeseKeys();
      if (remainingKeys === 0) {
        this.completeLevel();
      } else if (now > this.cheeseLockHintUntil) {
        this.cheeseLockHintUntil = now + 1800;
        this.flashHint(`${remainingKeys} cheese ${remainingKeys === 1 ? "key" : "keys"} still lock the wedge.`, true);
      }
    }
  }

  private totalRequiredCheeseKeys(): number {
    const keyLimit = DIFFICULTY_SETTINGS[this.difficulty].requiredKeyLimit;
    return Math.min(this.maze.cheeseKeys.length, keyLimit ?? this.maze.cheeseKeys.length);
  }

  private remainingRequiredCheeseKeys(): number {
    return Math.max(0, this.totalRequiredCheeseKeys() - this.collectedCheeseKeys);
  }

  private revealObjectivePath(): void {
    const objective = this.getNextObjectivePath();
    if (!objective) {
      this.flashHint("Green crumb found. The cheese is already close.");
      return;
    }

    this.renderGuideTrail(objective.path);
    this.guideTrailUntil = performance.now() + 9000;
    this.guideTrailTarget = objective.label;
    this.flashHint(`Green crumb trail: follow it to the ${objective.label}.`);
    this.audio.playGem();
  }

  private getNextObjectivePath(): { label: string; path: THREE.Vector3[] } | undefined {
    if (!this.maze) {
      return undefined;
    }

    const targets =
      this.remainingRequiredCheeseKeys() > 0
        ? this.maze.cheeseKeys.filter((key) => key.active).map((key) => ({ label: "key", position: key.position }))
        : [{ label: "cheese", position: this.cheese.position }];

    let best: { label: string; path: THREE.Vector3[] } | undefined;
    for (const target of targets) {
      const path = this.findGridPath(this.player.position, target.position);
      if (!path.length) {
        continue;
      }
      if (!best || path.length < best.path.length) {
        best = { label: target.label, path };
      }
    }

    return best;
  }

  private findGridPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const start = this.nearestWalkableCell(from);
    const goal = this.nearestWalkableCell(to);
    if (!start || !goal) {
      return [];
    }

    const queue: { row: number; col: number }[] = [start];
    const visited = new Set<string>([`${start.row},${start.col}`]);
    const parent = new Map<string, string>();
    const directions = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
    ];
    let foundKey = "";

    while (queue.length) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const currentKey = `${current.row},${current.col}`;
      if (current.row === goal.row && current.col === goal.col) {
        foundKey = currentKey;
        break;
      }

      for (const direction of directions) {
        const next = { row: current.row + direction.row, col: current.col + direction.col };
        const nextKey = `${next.row},${next.col}`;
        if (visited.has(nextKey) || !this.isWalkableCell(next.row, next.col)) {
          continue;
        }

        visited.add(nextKey);
        parent.set(nextKey, currentKey);
        queue.push(next);
      }
    }

    if (!foundKey) {
      return [];
    }

    const cells: { row: number; col: number }[] = [];
    let key = foundKey;
    while (key) {
      const [row, col] = key.split(",").map(Number);
      cells.push({ row, col });
      if (key === `${start.row},${start.col}`) {
        break;
      }
      key = parent.get(key) ?? "";
    }

    return cells.reverse().map((cell) => this.cellCenter(cell.row, cell.col, 0.13));
  }

  private nearestWalkableCell(position: THREE.Vector3): { row: number; col: number } | undefined {
    const centerRow = THREE.MathUtils.clamp(
      Math.round((position.z - this.maze.originZ) / this.tileSize),
      0,
      this.maze.rows - 1,
    );
    const centerCol = THREE.MathUtils.clamp(
      Math.round((position.x - this.maze.originX) / this.tileSize),
      0,
      this.maze.cols - 1,
    );

    if (this.isWalkableCell(centerRow, centerCol)) {
      return { row: centerRow, col: centerCol };
    }

    for (let radius = 1; radius < Math.max(this.maze.rows, this.maze.cols); radius += 1) {
      for (let row = centerRow - radius; row <= centerRow + radius; row += 1) {
        for (let col = centerCol - radius; col <= centerCol + radius; col += 1) {
          if (Math.abs(row - centerRow) !== radius && Math.abs(col - centerCol) !== radius) {
            continue;
          }
          if (this.isWalkableCell(row, col)) {
            return { row, col };
          }
        }
      }
    }

    return undefined;
  }

  private isWalkableCell(row: number, col: number): boolean {
    return row >= 0 && row < this.maze.rows && col >= 0 && col < this.maze.cols && this.maze.map[row]?.[col] !== "#";
  }

  private cellCenter(row: number, col: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(this.maze.originX + col * this.tileSize, y, this.maze.originZ + row * this.tileSize);
  }

  private renderGuideTrail(path: THREE.Vector3[]): void {
    this.clearGuideTrail();
    if (path.length < 2) {
      return;
    }

    const trail = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(path),
      new THREE.LineBasicMaterial({
        color: 0x00d84a,
        transparent: true,
        opacity: 1,
      }),
    );
    trail.add(line);

    const dotGeometry = new THREE.CircleGeometry(0.28, 24);
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: 0x00d84a,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0xb8ff47,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    path.slice(1).forEach((point, index) => {
      if (index % 2 !== 0 && index !== path.length - 2) {
        return;
      }
      const isPulseDot = index % 4 === 0;
      const dot = new THREE.Mesh(
        isPulseDot ? new THREE.CircleGeometry(0.42, 24) : dotGeometry,
        isPulseDot ? pulseMaterial : dotMaterial,
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.copy(point);
      dot.position.y = 0.11 + (index % 4 === 0 ? 0.02 : 0);
      trail.add(dot);
    });

    this.scene.add(trail);
    this.guideTrail = trail;
  }

  private updateGuideTrail(now: number): void {
    if (!this.guideTrail) {
      return;
    }

    const remainingMs = this.guideTrailUntil - now;
    if (remainingMs <= 0) {
      this.clearGuideTrail();
      return;
    }

    const opacityScale = THREE.MathUtils.clamp(remainingMs / 1800, 0.45, 1);
    const pulse = 0.9 + Math.sin(now * 0.008) * 0.1;
    this.guideTrail.traverse((object) => {
      const material = object instanceof THREE.Line ? object.material : object instanceof THREE.Mesh ? object.material : undefined;
      if (!material) {
        return;
      }
      const materials = Array.isArray(material) ? material : [material];
      materials.forEach((item) => {
        if ("opacity" in item) {
          item.opacity = opacityScale * pulse;
        }
      });
    });
  }

  private clearGuideTrail(): void {
    if (!this.guideTrail) {
      this.guideTrailTarget = "";
      this.guideTrailUntil = 0;
      return;
    }

    this.scene.remove(this.guideTrail);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.guideTrail.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        const material = object.material;
        const objectMaterials = Array.isArray(material) ? material : [material];
        objectMaterials.forEach((item) => materials.add(item));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.guideTrail = undefined;
    this.guideTrailTarget = "";
    this.guideTrailUntil = 0;
  }

  private teleportFromGem(gem: MazePickup): void {
    if (performance.now() < this.gemCooldownUntil || gem.pairIndex === undefined) {
      return;
    }

    const pair = this.maze.gems[gem.pairIndex];
    if (!pair) {
      return;
    }

    this.gemCooldownUntil = performance.now() + 900;
    this.player.position.set(pair.position.x, 0.3, pair.position.z);
    this.cameraShakeAmp = Math.max(this.cameraShakeAmp, 0.22);
    this.flashHint("Zip. The teleport gem shifted the maze under you.");
    this.audio.playGem();
  }

  private updateAlice(delta: number): void {
    const level = LEVELS[this.levelIndex];
    this.aliceElapsedMs += delta * 1000;
    const progress = THREE.MathUtils.clamp(this.aliceElapsedMs / this.getAliceTimeMs(level), 0, 1);
    this.hud.timerFill.style.transform = `scaleX(${1 - progress})`;
    this.hud.timerAlice.style.setProperty("--alice-progress", progress.toString());
    this.hud.timerAlice.setAttribute("aria-label", `Alice is ${Math.round(progress * 100)}% of the way to the cheese`);

    if (progress > 0.8) {
      this.hud.timerFill.style.background = "linear-gradient(90deg, #ff9252 0%, #e85452 100%)";
    } else if (progress > 0.55) {
      this.hud.timerFill.style.background = "linear-gradient(90deg, #ffbd47 0%, #ff8e57 100%)";
    } else {
      this.hud.timerFill.style.background = "linear-gradient(90deg, #ffd251 0%, #ffb04d 100%)";
    }

    if (progress >= 1) {
      this.aliceElapsedMs = 0;
      this.triggerAliceWin();
    }
  }

  private triggerAliceWin(): void {
    if (performance.now() < this.hazardLockedUntil || this.isOverlayOpen()) {
      return;
    }

    this.hazardLockedUntil = performance.now() + this.hazardGraceMs;
    this.audio.playGameOver();
    this.lives = 0;
    this.refreshHud();
    this.showOverlay(
      "Alice Wins!",
      "She reached the parmesan first. Better luck next race.",
      "alice",
    );
  }

  private getCatSpeed(level: LevelDefinition): number {
    return level.catSpeed * DIFFICULTY_SETTINGS[this.difficulty].catSpeedMultiplier;
  }

  private getAliceTimeMs(level: LevelDefinition): number {
    return level.aliceTimeMs * DIFFICULTY_SETTINGS[this.difficulty].aliceTimeMultiplier;
  }

  private collectScoutCrumb(): void {
    this.scoutCrumbBank += 1;
    if (this.scoutCrumbBank < SCOUT_CRUMBS_PER_CHARGE || this.scoutPeeks >= MAX_SCOUT_PEEKS) {
      return;
    }

    this.scoutCrumbBank = 0;
    this.scoutPeeks += 1;
    this.flashHint("Scout peek earned. Press M or 🔭 for a maze view.");
    this.refreshScoutButton();
  }

  private activateScoutPeek(): void {
    if (!this.maze || this.isOverlayOpen()) {
      return;
    }

    if (this.isScoutPeekActive()) {
      this.scoutPeekUntil = performance.now() + SCOUT_PEEK_DURATION_MS;
      this.flashHint("Scout peek extended. Find yourself, keys, and cheese.");
      return;
    }

    if (this.scoutPeeks <= 0) {
      this.flashHint(`Collect ${SCOUT_CRUMBS_PER_CHARGE} crumbs to earn another scout peek.`, true);
      return;
    }

    this.scoutPeeks -= 1;
    this.scoutPeekUntil = performance.now() + SCOUT_PEEK_DURATION_MS;
    this.cameraInitialized = false;
    this.wasScoutPeekActive = true;
    this.currentSpeed = 0;
    this.targetSpeed = 0;
    this.flashHint("Scout peek: the race pauses while you look for keys and cheese.");
    this.audio.playGem();
    this.refreshScoutButton();
  }

  private isScoutPeekActive(): boolean {
    return performance.now() < this.scoutPeekUntil;
  }

  private refreshScoutButton(): void {
    const active = this.isScoutPeekActive();
    this.hud.scoutButton.textContent = active ? "🗺️" : `🔭${this.scoutPeeks}`;
    this.hud.scoutButton.classList.toggle("active", active);
    this.hud.scoutButton.setAttribute(
      "aria-label",
      active
        ? "Scout view active"
        : `Use scout view. ${this.scoutPeeks} ${this.scoutPeeks === 1 ? "peek" : "peeks"} available`,
    );
  }

  private updateScoutCamera(): void {
    this.wasScoutPeekActive = true;
    this.cameraYaw = 0;
    const targetFov = 50;
    const verticalFovRad = THREE.MathUtils.degToRad(targetFov);
    const horizontalFovRad = 2 * Math.atan(Math.tan(verticalFovRad / 2) * this.camera.aspect);
    const limitingFov = Math.max(THREE.MathUtils.degToRad(24), Math.min(verticalFovRad, horizontalFovRad));
    const mazeRadius = Math.hypot(this.maze.mazeWidth, this.maze.mazeDepth) * 0.5;
    const focus = this.getScoutFocus();
    const scoutDistance = THREE.MathUtils.clamp(
      focus.radius / Math.sin(limitingFov / 2),
      24,
      mazeRadius * 3.2,
    );
    const scoutDirection = new THREE.Vector3(0, 1, 0.01).normalize();

    this.cameraTarget.copy(focus.center).addScaledVector(scoutDirection, scoutDistance);
    this.camera.position.lerp(this.cameraTarget, this.cameraInitialized ? 0.18 : 1);
    this.cameraInitialized = true;
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(focus.center.x, 0, focus.center.z);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.14);
    this.camera.far = Math.max(600, scoutDistance + mazeRadius + 60);
    this.camera.updateProjectionMatrix();

    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = Math.max(40, scoutDistance - focus.radius * 0.2);
      fog.far = scoutDistance + mazeRadius + 80;
    }

    this.refreshScoutButton();
  }

  private getScoutFocus(): { center: THREE.Vector3; radius: number } {
    const points = [this.player.position, this.cheese.position];
    const nextKey = this.getNearestActiveCheeseKey();
    if (nextKey) {
      points.push(nextKey.position);
    }
    points.push(this.cat.position);

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minZ = Math.min(...points.map((point) => point.z));
    const maxZ = Math.max(...points.map((point) => point.z));
    const center = new THREE.Vector3((minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5);
    const width = Math.max(12, maxX - minX + this.tileSize * 5);
    const depth = Math.max(12, maxZ - minZ + this.tileSize * 5);
    return {
      center,
      radius: Math.min(Math.hypot(this.maze.mazeWidth, this.maze.mazeDepth) * 0.5, Math.hypot(width, depth) * 0.5),
    };
  }

  private getNearestActiveCheeseKey(): MazePickup | undefined {
    return this.maze.cheeseKeys
      .filter((key) => key.active)
      .sort((a, b) => a.position.distanceToSquared(this.player.position) - b.position.distanceToSquared(this.player.position))[0];
  }

  private updateCamera(_delta: number): void {
    if (this.isScoutPeekActive()) {
      this.updateScoutCamera();
      return;
    }

    if (this.wasScoutPeekActive) {
      this.cameraInitialized = false;
      this.wasScoutPeekActive = false;
    }

    this.cameraYaw = this.playerHeading;
    this.camera.up.set(0, 1, 0);
    this.camera.far = 300;
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = 18;
      fog.far = 52;
    }
    const baseDist = 5.4;
    const height = 3.0;
    const sinH = Math.sin(this.cameraYaw);
    const cosH = Math.cos(this.cameraYaw);

    const dist = this.clampCameraDistance(sinH, cosH, baseDist);
    const desiredX = this.player.position.x + sinH * dist;
    const desiredZ = this.player.position.z + cosH * dist;
    const desiredY = this.player.position.y + height;
    this.cameraTarget.set(desiredX, desiredY, desiredZ);

    if (!this.cameraInitialized) {
      this.camera.position.copy(this.cameraTarget);
      this.cameraInitialized = true;
    } else {
      this.camera.position.lerp(this.cameraTarget, 0.22);
    }

    const lookAhead = 1.6 + Math.abs(this.currentSpeed) * 0.18;
    const lookX = this.player.position.x - sinH * lookAhead;
    const lookZ = this.player.position.z - cosH * lookAhead;
    this.camera.lookAt(lookX, this.player.position.y + 0.5, lookZ);

    const targetFov = 52 + THREE.MathUtils.clamp(Math.abs(this.currentSpeed) * 0.6, 0, 6);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.08);
    this.camera.updateProjectionMatrix();

    if (this.cameraShakeAmp > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.cameraShakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.cameraShakeAmp;
      this.camera.position.z += (Math.random() - 0.5) * this.cameraShakeAmp;
      this.cameraShakeAmp *= 0.85;
    }
  }

  private clampCameraDistance(sinH: number, cosH: number, baseDist: number): number {
    if (!this.maze) return baseDist;
    const margin = 0.6;
    let maxDist = baseDist;
    for (const wall of this.maze.walls) {
      for (let step = 0.4; step <= baseDist; step += 0.4) {
        const x = this.player.position.x + sinH * step;
        const z = this.player.position.z + cosH * step;
        if (x > wall.minX - margin && x < wall.maxX + margin && z > wall.minZ - margin && z < wall.maxZ + margin) {
          maxDist = Math.min(maxDist, step - 0.3);
          break;
        }
      }
    }
    return Math.max(2.6, maxDist);
  }

  private spawnPickupBurst(at: THREE.Vector3, color: number): void {
    const count = 14;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3 + 0] = at.x;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 1.4;
      velocities[i * 3 + 0] = Math.cos(angle) * speed;
      velocities[i * 3 + 1] = 1.2 + Math.random() * 1.8;
      velocities[i * 3 + 2] = Math.sin(angle) * speed;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("velocity", new THREE.BufferAttribute(velocities, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.14,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const points = new THREE.Points(geom, mat);
    this.scene.add(points);
    this.pickupBursts.push({ mesh: points, ageMs: 0, lifeMs: 600 });
  }

  private updatePickupBursts(delta: number): void {
    if (this.pickupBursts.length === 0) return;
    const dtMs = delta * 1000;
    for (let i = this.pickupBursts.length - 1; i >= 0; i -= 1) {
      const burst = this.pickupBursts[i];
      burst.ageMs += dtMs;
      const t = burst.ageMs / burst.lifeMs;
      if (t >= 1) {
        this.scene.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        (burst.mesh.material as THREE.PointsMaterial).dispose();
        this.pickupBursts.splice(i, 1);
        continue;
      }
      const posAttr = burst.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const velAttr = burst.mesh.geometry.getAttribute("velocity") as THREE.BufferAttribute;
      for (let p = 0; p < posAttr.count; p += 1) {
        posAttr.setX(p, posAttr.getX(p) + velAttr.getX(p) * delta);
        posAttr.setY(p, posAttr.getY(p) + velAttr.getY(p) * delta);
        posAttr.setZ(p, posAttr.getZ(p) + velAttr.getZ(p) * delta);
        velAttr.setY(p, velAttr.getY(p) - 6 * delta);
      }
      posAttr.needsUpdate = true;
      const mat = burst.mesh.material as THREE.PointsMaterial;
      mat.opacity = 1 - t;
      mat.size = 0.14 * (1 - t * 0.5);
    }
  }

  private triggerHazard(message: string): void {
    if (performance.now() < this.hazardLockedUntil || this.isOverlayOpen()) {
      return;
    }

    this.hazardLockedUntil = performance.now() + this.hazardGraceMs;
    this.cameraShakeAmp = 0.45;
    this.audio.playHazard();

    if (DIFFICULTY_SETTINGS[this.difficulty].forgivingHits) {
      this.refreshHud();
      this.showOverlay("Try Again", `${message}\nNo life lost in Kid mode. Take a breath and keep your keys.`);
      return;
    }

    this.lives -= 1;
    this.refreshHud();

    if (this.lives <= 0) {
      this.audio.playGameOver();
      this.showOverlay("Game Over", `${message}\nTry again from the first maze.`, "alice");
      return;
    }

    this.showOverlay("Ouch!", `${message}\nYou still have ${this.lives} ${this.lives === 1 ? "life" : "lives"} left.`);
  }

  private completeLevel(): void {
    if (this.levelComplete) {
      return;
    }

    this.levelComplete = true;
    this.audio.playLevelComplete();
    if (this.levelIndex === LEVELS.length - 1) {
      this.hasWonGame = true;
      this.showOverlay(
        "You Win!",
        "You beat Alice through every maze and reached the final parmesan wedge.",
        "cheese",
      );
      return;
    }

    this.showOverlay("Cheese Reached!", "Alice is still outside. Step into the next maze.", "cheese");
  }

  private isOverlayOpen(): boolean {
    return !this.overlay.root.classList.contains("hidden") || !this.startScreen.classList.contains("hidden");
  }

  private showOverlay(title: string, body: string, icon?: "alice" | "cheese"): void {
    this.overlay.title.textContent = title;
    this.overlay.body.textContent = body;
    if (icon === "alice") {
      this.overlay.icon.src = "/src/Images/file_00000000e9d0720b907b128f233c1f66.png";
      this.overlay.icon.classList.remove("hidden");
    } else if (icon === "cheese") {
      this.overlay.icon.src = "/src/Images/cheese_circular_crop.png";
      this.overlay.icon.classList.remove("hidden");
    } else {
      this.overlay.icon.classList.add("hidden");
    }
    this.overlay.root.classList.remove("hidden");
  }

  private advanceOverlayFlow(): void {
    if (!this.startScreen.classList.contains("hidden")) {
      return;
    }

    if (this.overlay.root.classList.contains("hidden")) {
      return;
    }

    if (this.hasWonGame || this.lives <= 0) {
      this.overlay.root.classList.add("hidden");
      this.startRun(false);
      return;
    }

    if (this.levelComplete) {
      this.overlay.root.classList.add("hidden");
      this.levelIndex += 1;
      this.loadLevel(this.levelIndex);
      return;
    }

    this.overlay.root.classList.add("hidden");
    this.resetActors();
  }

  private getIntroTip(): string {
    if (this.difficulty === "easy") {
      return "Kid mode keeps every maze playful: only 1 key is required, bumps do not cost lives, crumbs give lives faster, and Alice takes her time.";
    }

    if (this.difficulty === "medium") {
      return "Medium mode asks for 2 keys per maze, gives 4 lives, and keeps the chase gentler than Hard.";
    }

    return "Hard mode is the full challenge with every key required and no free bumps.";
  }

  private showIntro(): void {
    if (this.hasSeenIntro) {
      return;
    }

    this.hasSeenIntro = true;
    this.showOverlay(
      `${DIFFICULTY_SETTINGS[this.difficulty].label} Race To The Cheese`,
      `${this.getIntroTip()} Use the maze paths in real 3D space. Grab crumbs, collect green crumbs to reveal a trail, collect cheese keys, dodge traps, use paired teleport gems, watch the cat patrol, use scout peeks to zoom up when lost, and beat Alice to the wedge.`,
    );
  }

  private resetActors(): void {
    this.player.position.copy(this.maze.startPoint);
    this.cat.position.copy(this.maze.catPoint);
    this.catPatrolIndex = 0;
    this.aliceElapsedMs = 0;
    this.gemCooldownUntil = 0;
    this.cheeseLockHintUntil = 0;
    this.catChasing = false;
    this.hud.vignette.classList.remove("active");
    this.playerHeading = this.headingFromTo(this.maze.startPoint, this.maze.cheesePoint);
    this.cameraYaw = this.playerHeading;
    this.player.rotation.y = this.playerHeading;
    this.cameraInitialized = false;
    this.currentSpeed = 0;
    this.targetSpeed = 0;
    this.turnRate = 0;
    this.bankAngle = 0;
    this.pitchAngle = 0;
    this.footstepAccum = 0;
    this.player.position.y = 0.3;
    this.updatePlaytestState();
  }

  private refreshHud(): void {
    const level = LEVELS[this.levelIndex];
    const diff = DIFFICULTY_SETTINGS[this.difficulty];
    const maxLives = diff.startingLives;
    const hearts = "♥".repeat(Math.max(0, this.lives)) + "♡".repeat(Math.max(0, maxLives - this.lives));
    const keysLeft = this.remainingRequiredCheeseKeys();
    const keysTotal = this.totalRequiredCheeseKeys();
    this.hud.level.textContent = `${diff.label} · L${level.id}`;
    this.hud.level.style.color = level.theme.hud;
    this.hud.status.innerHTML =
      `<span class="hearts">${hearts}</span>` +
      `<span class="sep">·</span>` +
      `<span>🧀 ${this.crumbs}</span>` +
      (keysTotal > 0 ? `<span class="sep">·</span><span>🔑 ${keysLeft}/${keysTotal}</span>` : "");
    this.hud.status.style.color = level.theme.hud;
    this.refreshScoutButton();
    this.updateGuidanceHud();
  }

  private togglePause(): void {
    if (!this.startScreen.classList.contains("hidden")) return;
    if (!this.overlay.root.classList.contains("hidden")) return;
    this.paused = !this.paused;
    if (this.paused) {
      window.clearTimeout(this.currentHintTimeout);
      this.hud.toast.textContent = "Paused — Esc to resume";
      this.hud.toast.classList.remove("alert");
      this.hud.toast.classList.remove("hidden");
    } else {
      this.hud.toast.classList.add("hidden");
    }
  }

  private flashHint(text: string, alert = false): void {
    this.hud.toast.textContent = text;
    this.hud.toast.classList.toggle("alert", alert);
    this.hud.toast.classList.remove("hidden");
    window.clearTimeout(this.currentHintTimeout);
    this.currentHintTimeout = window.setTimeout(() => {
      this.hud.toast.classList.add("hidden");
    }, 1600);
  }

  private updateTheme(level: LevelDefinition): void {
    this.host.style.background = `linear-gradient(180deg, ${level.theme.skyTop} 0%, ${level.theme.skyBottom} 100%)`;
    (this.scene.fog as THREE.Fog).color.set(level.theme.fog);
    this.scene.background = new THREE.Color(level.theme.skyBottom);
    this.renderer.toneMappingExposure = level.theme.exposure ?? 1.05;

    const lighting = level.theme.lighting;
    const sky = lighting?.sky ?? 0xfff6d9;
    const ground = lighting?.ground ?? 0x6e4421;
    this.sceneLighting.hemi.color.setHex(sky);
    this.sceneLighting.hemi.groundColor.setHex(ground);
    this.sceneLighting.hemi.intensity = lighting?.hemisphere ?? 1.1;

    this.sceneLighting.sun.color.setHex(lighting?.sun ?? 0xfff1c7);
    this.sceneLighting.sun.intensity = lighting?.sunIntensity ?? 2.1;
    this.sceneLighting.rim.color.setHex(lighting?.rim ?? 0xffd7a0);
    this.sceneLighting.rim.intensity = lighting?.rimIntensity ?? 0.55;
    this.sceneLighting.ambient.color.setHex(lighting?.ambient ?? 0xffe6bd);
    this.sceneLighting.ambient.intensity = lighting?.ambientIntensity ?? 0.18;

    this.sceneLighting.floorGlow.material.color.setHex(lighting?.floorGlow ?? 0xffefbe);
    this.sceneLighting.floorGlow.material.opacity = lighting?.floorGlowOpacity ?? 0.35;
    this.sceneLighting.island.material.color.setHex(lighting?.island ?? 0xf3d68f);
    this.sceneLighting.playerLight.color.setHex(lighting?.playerLight ?? 0xfff0c0);
    this.sceneLighting.playerLight.intensity = lighting?.playerLightIntensity ?? 0;
  }

  private updatePlayerLight(): void {
    if (!this.player) {
      return;
    }

    this.sceneLighting.playerLight.position.set(
      this.player.position.x,
      this.player.position.y + 2.15,
      this.player.position.z,
    );
  }

  private updateGuidanceHud(): void {
    if (!this.cheese || !this.player) {
      return;
    }

    const toCheese = this.cheese.position.clone().sub(this.player.position);
    toCheese.y = 0;
    const distance = toCheese.length();
    const angle = Math.atan2(-toCheese.x, -toCheese.z) - this.playerHeading;
    const normalized = Math.atan2(Math.sin(angle), Math.cos(angle));

    let label = "Straight ahead";
    if (normalized > Math.PI / 3) label = "Turn left";
    else if (normalized > Math.PI / 9) label = "Veer left";
    else if (normalized < -Math.PI / 3) label = "Turn right";
    else if (normalized < -Math.PI / 9) label = "Veer right";

    this.lastGuideLabel = label;
    this.lastDistanceText = distance.toFixed(1);
  }

  private getStateSnapshot(): Record<string, unknown> {
    const level = LEVELS[this.levelIndex];
    const aliceProgress = level ? Math.min(1, this.aliceElapsedMs / this.getAliceTimeMs(level)) : 0;
    return {
      level: this.levelIndex + 1,
      title: level?.title ?? "n/a",
      difficulty: this.difficulty,
      difficultyLabel: DIFFICULTY_SETTINGS[this.difficulty].label,
      aliceTimeMs: level ? this.getAliceTimeMs(level) : 0,
      catSpeed: level ? this.getCatSpeed(level) : 0,
      lives: this.lives,
      crumbs: this.crumbs,
      extraLifeIn: DIFFICULTY_SETTINGS[this.difficulty].extraLifeCrumbs - this.extraLifeBank,
      overlayOpen: this.isOverlayOpen(),
      levelComplete: this.levelComplete,
      won: this.hasWonGame,
      player: {
        x: Number(this.player.position.x.toFixed(2)),
        z: Number(this.player.position.z.toFixed(2)),
        headingDeg: Number(THREE.MathUtils.radToDeg(this.playerHeading).toFixed(1)),
      },
      camera: {
        x: Number(this.camera.position.x.toFixed(2)),
        y: Number(this.camera.position.y.toFixed(2)),
        z: Number(this.camera.position.z.toFixed(2)),
        fov: Number(this.camera.fov.toFixed(1)),
      },
      cat: {
        x: Number(this.cat.position.x.toFixed(2)),
        z: Number(this.cat.position.z.toFixed(2)),
      },
      cheese: {
        x: Number(this.cheese.position.x.toFixed(2)),
        z: Number(this.cheese.position.z.toFixed(2)),
      },
      remainingCrumbs: this.maze?.crumbs.filter((item) => item.active).length ?? 0,
      remainingGreenCrumbs: this.maze?.crumbs.filter((item) => item.active && item.guideCrumb).length ?? 0,
      remainingGems: this.maze?.gems.filter((item) => item.active).length ?? 0,
      remainingCheeseKeys: this.maze?.cheeseKeys.filter((item) => item.active).length ?? 0,
      requiredCheeseKeysLeft: this.maze ? this.remainingRequiredCheeseKeys() : 0,
      scoutPeeks: this.scoutPeeks,
      scoutCrumbsUntilNext: Math.max(0, SCOUT_CRUMBS_PER_CHARGE - this.scoutCrumbBank),
      scoutActive: this.isScoutPeekActive(),
      scoutPinsVisible: this.scoutPins.filter((pin) => !pin.element.hidden).length,
      guideTrailActive: Boolean(this.guideTrail),
      guideTrailTarget: this.guideTrailTarget,
      gemPairs: this.maze?.gems.map((gem, index) => `${index}->${gem.pairIndex ?? "none"}`) ?? [],
      aliceProgress: Number(aliceProgress.toFixed(2)),
      cameraYawDeg: Number(THREE.MathUtils.radToDeg(this.cameraYaw).toFixed(1)),
      catMode: this.catChasing ? "chasing" : "patrolling",
      guide: `${this.lastGuideLabel} · ${this.lastDistanceText}m`,
      toast: this.hud.toast.classList.contains("hidden") ? "" : this.hud.toast.textContent,
    };
  }

  private updatePlaytestState(): void {
    this.playtest.state.textContent = JSON.stringify(this.getStateSnapshot(), null, 2);
    (window as Window & { render_game_to_text?: () => string }).render_game_to_text = () =>
      JSON.stringify(this.getStateSnapshot());
  }

  private resize = (): void => {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };
}
