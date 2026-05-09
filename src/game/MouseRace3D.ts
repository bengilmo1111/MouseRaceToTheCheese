import * as THREE from "three";
import { LEVELS, LevelDefinition } from "./levels";

type ControlKey = "up" | "down" | "left" | "right";

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
};

type MazeHazard = {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
};

type MazeState = {
  walls: WallRect[];
  crumbs: MazePickup[];
  traps: MazeHazard[];
  gems: MazePickup[];
  pathMarkers: THREE.Mesh[];
  patrol: THREE.Vector3[];
  levelGroup: THREE.Group;
  startPoint: THREE.Vector3;
  cheesePoint: THREE.Vector3;
  catPoint: THREE.Vector3;
  mazeCenter: THREE.Vector3;
  mazeWidth: number;
  mazeDepth: number;
};

const PLAYER_RADIUS = 0.42;
const CAT_RADIUS = 0.5;

export class MouseRace3D {
  private readonly host: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly clock = new THREE.Clock();
  private readonly tileSize = 2.6;
  private readonly moveSpeed = 6.0;
  private readonly accel = 18;
  private readonly decel = 12;
  private readonly turnSpeed = 3.0;
  private readonly hazardGraceMs = 1300;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly movementDelta = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private currentSpeed = 0;
  private targetSpeed = 0;
  private bankAngle = 0;
  private pitchAngle = 0;
  private turnRate = 0;
  private cameraShakeAmp = 0;
  private readonly controls: Record<ControlKey, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  private levelIndex = 0;
  private lives = 3;
  private crumbs = 0;
  private extraLifeBank = 0;
  private hasSeenIntro = false;
  private levelComplete = false;
  private hasWonGame = false;
  private gemCooldownUntil = 0;
  private hazardLockedUntil = 0;
  private aliceElapsedMs = 0;
  private currentHintTimeout = 0;
  private catPatrolIndex = 0;
  private playtestTick = 0;
  private playerHeading = 0;
  private cameraYaw = 0;
  private cameraInitialized = false;
  private catChasing = false;

  private maze!: MazeState;
  private player!: THREE.Group;
  private cat!: THREE.Group;
  private cheese!: THREE.Group;
  private alice!: THREE.Group;

  private readonly hud = {
    root: this.must<HTMLDivElement>("hud"),
    status: this.must<HTMLDivElement>("hud-status"),
    toast: this.must<HTMLDivElement>("hud-toast"),
    timerFill: this.must<HTMLDivElement>("timer-fill"),
  };
  private lastGuideLabel = "";
  private lastDistanceText = "";
  private readonly pickupBursts: { mesh: THREE.Points; ageMs: number; lifeMs: number }[] = [];

  private readonly startScreen = this.must<HTMLDivElement>("start-screen");
  private readonly overlay = {
    root: this.must<HTMLDivElement>("overlay"),
    title: this.must<HTMLHeadingElement>("overlay-title"),
    body: this.must<HTMLParagraphElement>("overlay-body"),
    button: this.must<HTMLButtonElement>("overlay-btn"),
  };
  private readonly playtest = {
    state: this.must<HTMLPreElement>("playtest-state"),
  };

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.host.appendChild(this.renderer.domElement);

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

    this.player = this.buildMouse();
    this.cat = this.buildCat();
    this.cheese = this.buildCheese();
    this.alice = this.buildAlice();

    this.scene.add(this.player, this.cat, this.cheese, this.alice);
  }

  private bindUi(): void {
    this.must<HTMLButtonElement>("start-btn").addEventListener("click", () => {
      this.startRun(true);
    });

    this.overlay.button.addEventListener("click", () => this.advanceOverlayFlow());
    this.must<HTMLButtonElement>("fullscreen-btn").addEventListener("click", () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void this.host.requestFullscreen();
      }
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

    Object.entries(touchMap).forEach(([id, key]) => {
      const element = this.must<HTMLButtonElement>(id);
      const activate = (value: boolean) => {
        this.controls[key] = value;
        element.classList.toggle("active", value);
      };

      element.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        activate(true);
      });
      ["pointerup", "pointercancel", "pointerleave", "pointerout"].forEach((type) => {
        element.addEventListener(type, (event) => {
          event.preventDefault();
          activate(false);
        });
      });
    });
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
      warpGem: () => this.warpToPickup("gem"),
      warpTrap: () => this.warpToHazard("trap"),
      warpCheese: () => this.warpToCheese(),
      warpCat: () => this.warpToCat(),
      forceHit: () => this.triggerHazard("Forced agent hit."),
      setAliceProgress: (ratio: number) => {
        this.aliceElapsedMs = LEVELS[this.levelIndex].aliceTimeMs * Math.max(0, Math.min(1, ratio));
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
    this.must<HTMLButtonElement>("ptest-gem").addEventListener("click", () => this.warpToPickup("gem"));
    this.must<HTMLButtonElement>("ptest-trap").addEventListener("click", () => this.warpToHazard("trap"));
    this.must<HTMLButtonElement>("ptest-cheese").addEventListener("click", () => this.warpToCheese());
    this.must<HTMLButtonElement>("ptest-cat").addEventListener("click", () => this.warpToCat());
    this.must<HTMLButtonElement>("ptest-alice").addEventListener("click", () => {
      this.aliceElapsedMs = LEVELS[this.levelIndex].aliceTimeMs * 0.95;
      this.updatePlaytestState();
    });
    this.must<HTMLButtonElement>("ptest-hit").addEventListener("click", () => this.triggerHazard("Forced playtest hit."));
  }

  private startRun(fromStartScreen: boolean): void {
    if (fromStartScreen) {
      this.startScreen.classList.add("hidden");
    }

    this.hud.root.classList.remove("hidden");
    this.levelIndex = 0;
    this.lives = 3;
    this.crumbs = 0;
    this.extraLifeBank = 0;
    this.hasWonGame = false;
    this.hasSeenIntro = false;
    this.loadLevel(0);
    this.showIntro();
  }

  private loadLevel(index: number): void {
    this.levelComplete = false;
    this.aliceElapsedMs = 0;
    this.gemCooldownUntil = 0;
    this.hazardLockedUntil = 0;
    this.catPatrolIndex = 0;

    if (this.maze) {
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
    this.catChasing = false;
    this.updateAlicePosition(0);
    this.updateTheme(LEVELS[index]);
    this.refreshHud();
  }

  private buildLevel(level: LevelDefinition): MazeState {
    const group = new THREE.Group();
    const walls: WallRect[] = [];
    const crumbs: MazePickup[] = [];
    const traps: MazeHazard[] = [];
    const gems: MazePickup[] = [];
    const pathMarkers: THREE.Mesh[] = [];
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

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(width + 2.4, 0.5, depth + 2.4),
      new THREE.MeshStandardMaterial({ color: level.theme.floor, roughness: 0.96 }),
    );
    floor.position.set(0, -0.28, 0);
    floor.receiveShadow = true;
    group.add(floor);

    const wallTopMaterial = new THREE.MeshStandardMaterial({ color: level.theme.wallTop, roughness: 0.72 });
    const wallSideMaterial = new THREE.MeshStandardMaterial({ color: level.theme.wallSide, roughness: 0.88 });

    level.map.forEach((line, row) => {
      [...line].forEach((cell, col) => {
        const x = originX + col * this.tileSize;
        const z = originZ + row * this.tileSize;

        if (cell === "#") {
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(this.tileSize * 0.94, 2.4, this.tileSize * 0.94),
            [wallSideMaterial, wallSideMaterial, wallTopMaterial, wallSideMaterial, wallSideMaterial, wallSideMaterial],
          );
          wall.position.set(x, 1.18, z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          group.add(wall);
          walls.push({
            minX: x - this.tileSize * 0.47,
            maxX: x + this.tileSize * 0.47,
            minZ: z - this.tileSize * 0.47,
            maxZ: z + this.tileSize * 0.47,
          });
          return;
        }

        if (cell === ".") {
          const crumbMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 12, 12),
            new THREE.MeshStandardMaterial({
              color: 0xffef91,
              emissive: 0xffc84e,
              emissiveIntensity: 0.6,
            }),
          );
          crumbMesh.position.set(x, 0.34, z);
          group.add(crumbMesh);
          crumbs.push({ mesh: crumbMesh, position: crumbMesh.position.clone(), active: true });
          return;
        }

        if (cell === "T") {
          const trap = new THREE.Group();
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.58, 0.58, 0.16, 18),
            new THREE.MeshStandardMaterial({ color: 0x8d6a48, roughness: 0.82 }),
          );
          base.receiveShadow = true;
          trap.add(base);
          for (let indexTooth = 0; indexTooth < 8; indexTooth += 1) {
            const tooth = new THREE.Mesh(
              new THREE.ConeGeometry(0.1, 0.42, 4),
              new THREE.MeshStandardMaterial({ color: 0xd5d9de, metalness: 0.4, roughness: 0.35 }),
            );
            const angle = (Math.PI * 2 * indexTooth) / 8;
            tooth.position.set(Math.cos(angle) * 0.44, 0.22, Math.sin(angle) * 0.44);
            tooth.rotation.z = Math.PI;
            trap.add(tooth);
          }
          trap.position.set(x, 0.08, z);
          trap.add(this.createWorldMarker("TRAP", 0xff8b73, 0xc94f3e, 0.95));
          group.add(trap);
          traps.push({ mesh: trap, position: trap.position.clone() });
          return;
        }

        if (cell === "G") {
          const gem = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.36, 0),
            new THREE.MeshStandardMaterial({
              color: level.theme.accent,
              emissive: level.theme.accent,
              emissiveIntensity: 0.55,
              roughness: 0.2,
              metalness: 0.2,
            }),
          );
          gem.position.set(x, 0.55, z);
          gem.castShadow = true;
          gem.add(this.createWorldMarker("ZIP", level.theme.accent, 0xffffff, 1.05));
          group.add(gem);
          gems.push({ mesh: gem, position: gem.position.clone(), active: true });
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

    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(width, depth) * 0.56, 0.5, 12, 48),
      new THREE.MeshStandardMaterial({
        color: level.theme.trim,
        transparent: true,
        opacity: 0.35,
        roughness: 0.85,
      }),
    );
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = -0.1;
    group.add(outerRing);

    const aliceLane = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(width, depth) * 0.57, 0.12, 10, 72),
      new THREE.MeshStandardMaterial({
        color: level.theme.accent,
        emissive: level.theme.accent,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.45,
      }),
    );
    aliceLane.rotation.x = Math.PI / 2;
    aliceLane.position.y = 0.02;
    group.add(aliceLane);

    for (let indexMarker = 1; indexMarker <= 5; indexMarker += 1) {
      const marker = new THREE.Mesh(
        new THREE.CircleGeometry(0.36, 20),
        new THREE.MeshStandardMaterial({
          color: level.theme.accent,
          emissive: level.theme.accent,
          emissiveIntensity: 0.35,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.05;
      group.add(marker);
      pathMarkers.push(marker);
    }

    return {
      walls,
      crumbs,
      traps,
      gems,
      pathMarkers,
      patrol: patrol.length > 1 ? patrol : [catPoint.clone(), startPoint.clone()],
      levelGroup: group,
      startPoint,
      cheesePoint,
      catPoint,
      mazeCenter: new THREE.Vector3(0, 0, 0),
      mazeWidth: width,
      mazeDepth: depth,
    };
  }

  private buildMouse(): THREE.Group {
    const group = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xb9b3c0, roughness: 0.78, metalness: 0.02 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xefe7ec, roughness: 0.85 });
    const earOuter = new THREE.MeshStandardMaterial({ color: 0xb9b3c0, roughness: 0.78 });
    const earInner = new THREE.MeshStandardMaterial({ color: 0xf6b9cf, roughness: 0.55 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x121012, roughness: 0.25 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xff7aa0, roughness: 0.35, emissive: 0x661022, emissiveIntensity: 0.3 });
    const pawMat = new THREE.MeshStandardMaterial({ color: 0xf3a8c0, roughness: 0.6 });
    const whiskerMat = new THREE.LineBasicMaterial({ color: 0x2a2530, transparent: true, opacity: 0.55 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 22, 22), fur);
    body.scale.set(1.05, 0.86, 1.55);
    body.position.y = 0.04;
    body.castShadow = true;
    group.add(body);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 18), bellyMat);
    belly.scale.set(0.9, 0.7, 1.4);
    belly.position.set(0, -0.1, 0);
    group.add(belly);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 18), fur);
    head.position.set(0, 0.16, -0.5);
    head.scale.set(1, 0.95, 1.05);
    head.castShadow = true;
    group.add(head);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), bellyMat);
    snout.scale.set(0.9, 0.7, 1.1);
    snout.position.set(0, 0.07, -0.74);
    group.add(snout);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), noseMat);
    nose.position.set(0, 0.07, -0.86);
    group.add(nose);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), eyeMat);
      eye.position.set(side * 0.12, 0.21, -0.66);
      group.add(eye);

      const earBase = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), earOuter);
      earBase.scale.set(1, 0.35, 1);
      earBase.position.set(side * 0.18, 0.42, -0.46);
      earBase.rotation.set(0, 0, side * 0.2);
      earBase.castShadow = true;
      group.add(earBase);

      const earInside = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 14), earInner);
      earInside.scale.set(1, 0.28, 1);
      earInside.position.set(side * 0.18, 0.46, -0.45);
      earInside.rotation.set(0, 0, side * 0.2);
      group.add(earInside);

      const frontPaw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), pawMat);
      frontPaw.scale.set(1, 0.6, 1.2);
      frontPaw.position.set(side * 0.18, -0.2, -0.32);
      group.add(frontPaw);

      const backPaw = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), pawMat);
      backPaw.scale.set(1, 0.6, 1.3);
      backPaw.position.set(side * 0.22, -0.22, 0.28);
      group.add(backPaw);

      const whiskerGeom = new THREE.BufferGeometry();
      const wx = side * 0.13;
      const verts: number[] = [];
      for (let row = 0; row < 3; row += 1) {
        const angle = (row - 1) * 0.18;
        verts.push(wx, 0.06 + (row - 1) * 0.04, -0.78);
        verts.push(side * (0.13 + 0.36 * Math.cos(angle)), 0.06 + (row - 1) * 0.05, -0.78 - 0.32 * Math.sin(angle) - 0.05);
      }
      whiskerGeom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const whiskers = new THREE.LineSegments(whiskerGeom, whiskerMat);
      group.add(whiskers);
    }

    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.04, 0.5),
      new THREE.Vector3(0.05, 0.05, 0.78),
      new THREE.Vector3(-0.05, 0.18, 1.0),
      new THREE.Vector3(0.04, 0.32, 1.18),
    ]);
    const tail = new THREE.Mesh(
      new THREE.TubeGeometry(tailCurve, 24, 0.045, 8, false),
      new THREE.MeshStandardMaterial({ color: 0xeea3b8, roughness: 0.5 }),
    );
    tail.castShadow = true;
    group.add(tail);

    return group;
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

    return group;
  }

  private buildAlice(): THREE.Group {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xffdfd8, roughness: 0.75 });
    const onesie = new THREE.MeshStandardMaterial({ color: 0xff8aaa, roughness: 0.62 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 14), onesie);
    body.scale.set(1.35, 0.8, 1.1);
    body.position.y = 0.18;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), skin);
    head.position.set(0, 0.38, -0.16);
    head.castShadow = true;
    group.add(head);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.34, 10), skin);
      arm.position.set(side * 0.28, 0.1, 0.2);
      arm.rotation.z = side * (Math.PI / 2.7);
      arm.castShadow = true;
      group.add(arm);
    }

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

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);

    if (!this.isOverlayOpen() && this.maze) {
      this.updatePlayer(delta);
      this.updateCat(delta);
      this.updatePickups(delta);
      this.updateAlice(delta);
      this.updateCamera(delta);
    } else if (this.player) {
      this.updateCamera(delta);
    }

    this.updatePickupBursts(delta);

    this.playtestTick += 1;
    if (this.playtestTick % 5 === 0) {
      this.updatePlaytestState();
      this.updateGuidanceHud();
      this.updatePathMarkers();
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
    this.updatePickups(0);
    this.updatePlaytestState();
  }

  private warpToPickup(kind: "crumb" | "gem"): void {
    if (!this.maze) {
      return;
    }

    const pool = kind === "crumb" ? this.maze.crumbs : this.maze.gems;
    const target = pool.find((item) => item.active);
    if (!target) {
      this.flashHint(`No active ${kind} found.`);
      return;
    }

    this.player.position.set(target.position.x, 0.3, target.position.z);
    this.updatePickups(0);
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
    this.updatePickups(0);
    this.updatePlaytestState();
  }

  private warpToCheese(): void {
    if (!this.maze) {
      return;
    }

    this.player.position.set(this.cheese.position.x, 0.3, this.cheese.position.z);
    this.updatePickups(0);
    this.updatePlaytestState();
  }

  private warpToCat(): void {
    this.player.position.set(this.cat.position.x, 0.3, this.cat.position.z);
    this.updateCat(0);
    this.updatePlaytestState();
  }

  private updatePlayer(delta: number): void {
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
    }

    const targetBank = THREE.MathUtils.clamp(-this.turnRate * 0.25, -0.35, 0.35);
    this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, targetBank, Math.min(1, delta * 8));
    const speedFraction = this.currentSpeed / this.moveSpeed;
    const targetPitch = THREE.MathUtils.clamp(speedFraction * 0.18, -0.18, 0.18);
    this.pitchAngle = THREE.MathUtils.lerp(this.pitchAngle, targetPitch, Math.min(1, delta * 6));

    this.player.rotation.set(this.pitchAngle, this.playerHeading, this.bankAngle);

    const moving = Math.abs(this.currentSpeed) > 0.2;
    const bob = moving ? Math.sin(performance.now() * 0.018) * 0.05 * Math.abs(speedFraction) : 0;
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

  private updateCat(delta: number): void {
    const patrol = this.maze.patrol;
    if (patrol.length === 0) {
      return;
    }

    const playerVector = this.player.position.clone().sub(this.cat.position);
    playerVector.y = 0;
    const playerDistance = playerVector.length();
    const shouldChase = playerDistance < 6.4;

    if (shouldChase !== this.catChasing) {
      this.catChasing = shouldChase;
      this.flashHint(shouldChase ? "Cat spotted you!" : "Cat lost you.", shouldChase);
    }

    const target = shouldChase ? this.player.position : patrol[this.catPatrolIndex];
    const vector = target.clone().sub(this.cat.position);
    vector.y = 0;
    const distance = vector.length();

    if (!shouldChase && distance < 0.15) {
      this.catPatrolIndex = (this.catPatrolIndex + 1) % patrol.length;
      return;
    }

    const speedScale = shouldChase ? 1.38 : 1;
    vector.normalize().multiplyScalar((LEVELS[this.levelIndex].catSpeed / 24) * speedScale * delta);
    this.moveWithCollisions(this.cat.position, CAT_RADIUS, vector);
    this.cat.rotation.y = Math.atan2(-vector.x, -vector.z);
    this.cat.position.y = 0.34 + Math.sin(performance.now() * 0.008) * 0.04;

    if (this.player.position.distanceToSquared(this.cat.position) < 1.1 * 1.1) {
      this.triggerHazard("The cat caught you!");
    }
  }

  private updatePickups(_delta: number): void {
    for (const crumb of this.maze.crumbs) {
      if (!crumb.active) continue;
      crumb.mesh.rotation.y += 0.03;
      if (this.player.position.distanceToSquared(crumb.position) < 0.7 * 0.7) {
        crumb.active = false;
        crumb.mesh.visible = false;
        this.crumbs += 1;
        this.extraLifeBank += 1;
        if (this.extraLifeBank >= 3) {
          this.extraLifeBank = 0;
          this.lives += 1;
          this.flashHint("+1 life");
        }
        this.spawnPickupBurst(crumb.position, 0xffe084);
        this.refreshHud();
      }
    }

    for (const trap of this.maze.traps) {
      trap.mesh.rotation.y += 0.02;
      if (this.player.position.distanceToSquared(trap.position) < 0.72 * 0.72) {
        this.triggerHazard("A mousetrap snapped shut!");
      }
    }

    for (const gem of this.maze.gems) {
      if (!gem.active) continue;
      gem.mesh.rotation.y += 0.04;
      gem.mesh.position.y = 0.55 + Math.sin(performance.now() * 0.004 + gem.position.x) * 0.08;
      if (this.player.position.distanceToSquared(gem.position) < 0.86 * 0.86) {
        this.teleportFromGem(gem);
      }
    }

    this.cheese.rotation.y += 0.02;
    if (this.player.position.distanceToSquared(this.cheese.position) < 0.9 * 0.9) {
      this.completeLevel();
    }
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
    this.flashHint("Teleported!");
  }

  private updateAlice(delta: number): void {
    const level = LEVELS[this.levelIndex];
    this.aliceElapsedMs += delta * 1000;
    const progress = THREE.MathUtils.clamp(this.aliceElapsedMs / level.aliceTimeMs, 0, 1);
    this.updateAlicePosition(progress);
    this.hud.timerFill.style.transform = `scaleX(${1 - progress})`;

    if (progress > 0.8) {
      this.hud.timerFill.style.background = "linear-gradient(90deg, #ff9252 0%, #e85452 100%)";
    } else if (progress > 0.55) {
      this.hud.timerFill.style.background = "linear-gradient(90deg, #ffbd47 0%, #ff8e57 100%)";
    } else {
      this.hud.timerFill.style.background = "linear-gradient(90deg, #ffd251 0%, #ffb04d 100%)";
    }

    if (progress >= 1) {
      this.aliceElapsedMs = 0;
      this.triggerHazard("Alice reached the parmesan first!");
    }
  }

  private updateAlicePosition(progress: number): void {
    const angle = progress * Math.PI * 2 + Math.PI * 0.22;
    const radiusX = this.maze.mazeWidth * 0.58;
    const radiusZ = this.maze.mazeDepth * 0.58;
    const x = Math.cos(angle) * radiusX;
    const z = Math.sin(angle) * radiusZ;
    this.alice.position.set(x, 0.18 + Math.sin(progress * Math.PI * 20) * 0.03, z);
    this.alice.lookAt(this.cheese.position.x, 0.2, this.cheese.position.z);
  }

  private updateCamera(_delta: number): void {
    this.cameraYaw = this.playerHeading;
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
    this.lives -= 1;
    this.cameraShakeAmp = 0.45;
    this.refreshHud();

    if (this.lives <= 0) {
      this.showOverlay("Game Over", `${message}\nAlice wins this race. Try again from the first maze.`);
      return;
    }

    this.showOverlay("Ouch", `${message}\nYou still have ${this.lives} lives left.`);
  }

  private completeLevel(): void {
    if (this.levelComplete) {
      return;
    }

    this.levelComplete = true;
    if (this.levelIndex === LEVELS.length - 1) {
      this.hasWonGame = true;
      this.showOverlay(
        "You Win",
        "You beat Alice through every maze and reached the final parmesan wedge.",
      );
      return;
    }

    this.showOverlay("Cheese Reached", "Alice is still outside. Step into the next maze.");
  }

  private isOverlayOpen(): boolean {
    return !this.overlay.root.classList.contains("hidden") || !this.startScreen.classList.contains("hidden");
  }

  private showOverlay(title: string, body: string): void {
    this.overlay.title.textContent = title;
    this.overlay.body.textContent = body;
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

  private showIntro(): void {
    if (this.hasSeenIntro) {
      return;
    }

    this.hasSeenIntro = true;
    this.showOverlay(
      "Race To The Cheese",
      "Use the maze paths in real 3D space. Grab crumbs, dodge traps, watch the cat patrol, and beat Alice to the wedge.",
    );
  }

  private resetActors(): void {
    this.player.position.copy(this.maze.startPoint);
    this.cat.position.copy(this.maze.catPoint);
    this.catPatrolIndex = 0;
    this.aliceElapsedMs = 0;
    this.gemCooldownUntil = 0;
    this.catChasing = false;
    this.playerHeading = this.headingFromTo(this.maze.startPoint, this.maze.cheesePoint);
    this.cameraYaw = this.playerHeading;
    this.player.rotation.y = this.playerHeading;
    this.cameraInitialized = false;
    this.currentSpeed = 0;
    this.targetSpeed = 0;
    this.turnRate = 0;
    this.bankAngle = 0;
    this.pitchAngle = 0;
    this.player.position.y = 0.3;
    this.updatePlaytestState();
  }

  private refreshHud(): void {
    const level = LEVELS[this.levelIndex];
    const hearts = "♥".repeat(Math.max(0, this.lives)) + "♡".repeat(Math.max(0, 3 - this.lives));
    this.hud.status.innerHTML =
      `<span class="level">L${level.id} · ${level.title}</span>` +
      `<span class="sep">·</span>` +
      `<span class="hearts">${hearts}</span>` +
      `<span class="sep">·</span>` +
      `<span>🧀 ${this.crumbs}</span>`;
    this.hud.status.style.color = level.theme.hud;
    this.updateGuidanceHud();
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

  private updatePathMarkers(): void {
    if (!this.maze?.pathMarkers.length) {
      return;
    }

    const route = this.cheese.position.clone().sub(this.player.position);
    route.y = 0;
    const totalDistance = route.length();
    if (totalDistance < 0.01) {
      this.maze.pathMarkers.forEach((marker) => {
        marker.visible = false;
      });
      return;
    }

    route.normalize();
    const lateral = new THREE.Vector3(-route.z, 0, route.x);

    this.maze.pathMarkers.forEach((marker, indexMarker) => {
      const segment = Math.min(totalDistance - 0.8, 1.8 + indexMarker * 2.1);
      if (segment <= 0.4) {
        marker.visible = false;
        return;
      }

      const sway = ((indexMarker % 2 === 0 ? -1 : 1) * 0.35) + Math.sin(performance.now() * 0.002 + indexMarker) * 0.08;
      marker.visible = true;
      marker.position.set(
        this.player.position.x + route.x * segment + lateral.x * sway,
        0.05,
        this.player.position.z + route.z * segment + lateral.z * sway,
      );
      (marker.material as THREE.MeshStandardMaterial).opacity = Math.max(0.2, 0.62 - indexMarker * 0.08);
    });
  }

  private getStateSnapshot(): Record<string, unknown> {
    const level = LEVELS[this.levelIndex];
    const aliceProgress = level ? Math.min(1, this.aliceElapsedMs / level.aliceTimeMs) : 0;
    return {
      level: this.levelIndex + 1,
      title: level?.title ?? "n/a",
      lives: this.lives,
      crumbs: this.crumbs,
      extraLifeIn: 3 - this.extraLifeBank,
      overlayOpen: this.isOverlayOpen(),
      levelComplete: this.levelComplete,
      won: this.hasWonGame,
      player: {
        x: Number(this.player.position.x.toFixed(2)),
        z: Number(this.player.position.z.toFixed(2)),
        headingDeg: Number(THREE.MathUtils.radToDeg(this.playerHeading).toFixed(1)),
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
      remainingGems: this.maze?.gems.filter((item) => item.active).length ?? 0,
      visibleTrailMarkers: this.maze?.pathMarkers.filter((marker) => marker.visible).length ?? 0,
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
