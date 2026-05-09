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
  private readonly moveSpeed = 4.8;
  private readonly hazardGraceMs = 1300;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
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
  private playerHeading = Math.PI;
  private cameraYaw = Math.PI;
  private catChasing = false;

  private maze!: MazeState;
  private player!: THREE.Group;
  private cat!: THREE.Group;
  private cheese!: THREE.Group;
  private alice!: THREE.Group;

  private readonly hud = {
    root: this.must<HTMLDivElement>("hud"),
    level: this.must<HTMLDivElement>("hud-level"),
    lives: this.must<HTMLDivElement>("hud-lives"),
    crumbs: this.must<HTMLDivElement>("hud-crumbs"),
    hint: this.must<HTMLDivElement>("hud-hint"),
    guide: this.must<HTMLDivElement>("hud-guide"),
    cat: this.must<HTMLDivElement>("hud-cat"),
    timerFill: this.must<HTMLDivElement>("timer-fill"),
  };

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
    this.scene.fog = new THREE.Fog(0xfdebc0, 15, 44);

    const hemi = new THREE.HemisphereLight(0xfff6d9, 0x946737, 1.4);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6db, 2.3);
    sun.position.set(10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    this.scene.add(sun);

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
    this.playerHeading = Math.PI;
    this.cameraYaw = Math.PI;
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

    return {
      walls,
      crumbs,
      traps,
      gems,
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
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc7c3cf, roughness: 0.62 });
    const earMaterial = new THREE.MeshStandardMaterial({ color: 0xf3c6da, roughness: 0.55 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 18), bodyMaterial);
    body.scale.set(1.25, 0.9, 1.5);
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), bodyMaterial);
    head.position.set(0, 0.12, -0.42);
    head.castShadow = true;
    group.add(head);

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), earMaterial);
      ear.position.set(side * 0.16, 0.34, -0.5);
      ear.castShadow = true;
      group.add(ear);
    }

    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.05, 0.82, 8),
      new THREE.MeshStandardMaterial({ color: 0xeea3b8, roughness: 0.5 }),
    );
    tail.rotation.z = Math.PI / 2.8;
    tail.position.set(-0.42, -0.02, 0.4);
    tail.castShadow = true;
    group.add(tail);

    return group;
  }

  private buildCat(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf18944, roughness: 0.58 });
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xae522d, roughness: 0.72 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), bodyMaterial);
    body.scale.set(1.2, 0.95, 1.5);
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), bodyMaterial);
    head.position.set(0, 0.2, -0.46);
    head.castShadow = true;
    group.add(head);

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), stripeMaterial);
      ear.position.set(side * 0.17, 0.5, -0.52);
      ear.rotation.z = side * 0.12;
      ear.castShadow = true;
      group.add(ear);
    }

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.96, 10), stripeMaterial);
    tail.position.set(-0.54, 0.16, 0.44);
    tail.rotation.z = Math.PI / 3.6;
    tail.castShadow = true;
    group.add(tail);

    return group;
  }

  private buildCheese(): THREE.Group {
    const group = new THREE.Group();
    const cheese = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.82, 0.56, 3),
      new THREE.MeshStandardMaterial({
        color: 0xffd04f,
        roughness: 0.52,
        emissive: 0xf5a623,
        emissiveIntensity: 0.18,
      }),
    );
    cheese.rotation.y = Math.PI / 6;
    cheese.rotation.x = Math.PI / 2;
    cheese.castShadow = true;
    group.add(cheese);

    for (const hole of [
      [-0.12, 0.06, -0.08, 0.12],
      [0.18, -0.04, 0.08, 0.09],
      [0.08, 0.12, -0.18, 0.07],
    ]) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(hole[3], 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xf1b92d, roughness: 0.58 }),
      );
      bubble.position.set(hole[0], hole[1], hole[2]);
      group.add(bubble);
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

    this.playtestTick += 1;
    if (this.playtestTick % 5 === 0) {
      this.updatePlaytestState();
      this.updateGuidanceHud();
    }

    this.renderer.render(this.scene, this.camera);
  };

  private stepMove(direction: ControlKey): void {
    if (!this.maze || this.isOverlayOpen()) {
      return;
    }

    const delta = new THREE.Vector3();
    if (direction === "up") delta.set(0, 0, -0.7);
    if (direction === "down") delta.set(0, 0, 0.7);
    if (direction === "left") delta.set(-0.7, 0, 0);
    if (direction === "right") delta.set(0.7, 0, 0);

    this.moveWithCollisions(this.player.position, PLAYER_RADIUS, delta);
    if (delta.lengthSq() > 0) {
      this.playerHeading = Math.atan2(delta.x, delta.z);
      this.player.rotation.y = this.playerHeading;
    }
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
    const strafeAmount = (this.controls.right ? 1 : 0) - (this.controls.left ? 1 : 0);
    const forwardAmount = (this.controls.up ? 1 : 0) - (this.controls.down ? 1 : 0);

    const cameraForward = new THREE.Vector3();
    this.camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    if (cameraForward.lengthSq() === 0) {
      cameraForward.set(0, 0, -1);
    } else {
      cameraForward.normalize();
    }

    const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();

    this.playerVelocity
      .copy(cameraForward.multiplyScalar(forwardAmount))
      .add(cameraRight.multiplyScalar(strafeAmount));

    if (this.playerVelocity.lengthSq() > 1) {
      this.playerVelocity.normalize();
    }

    this.playerVelocity.multiplyScalar(this.moveSpeed * delta);
    this.moveWithCollisions(this.player.position, PLAYER_RADIUS, this.playerVelocity);

    if (this.playerVelocity.lengthSq() > 0) {
      this.playerHeading = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
      this.player.rotation.y = this.playerHeading;
    }

    const bob = Math.sin(performance.now() * 0.01) * 0.03;
    this.player.position.y = 0.3 + bob;
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
      this.flashHint(shouldChase ? "The cat spotted you. Keep moving." : "The cat lost sight of you.");
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
    this.cat.rotation.y = Math.atan2(vector.x, vector.z);
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
          this.flashHint("Three crumbs earned another life.");
        } else {
          this.flashHint("Crunch. More crumbs for your stash.");
        }
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
    this.flashHint("Zip. The teleport gem shifted the maze under you.");
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
    this.cameraYaw = THREE.MathUtils.lerp(this.cameraYaw, this.playerHeading, 0.08);
    const offsetX = -Math.sin(this.cameraYaw) * 6.6;
    const offsetZ = -Math.cos(this.cameraYaw) * 6.6;
    this.cameraTarget.set(this.player.position.x + offsetX, this.player.position.y + 6.2, this.player.position.z + offsetZ);
    this.camera.position.lerp(this.cameraTarget, 0.12);
    const lookAheadX = this.player.position.x + Math.sin(this.playerHeading) * 1.9;
    const lookAheadZ = this.player.position.z + Math.cos(this.playerHeading) * 1.9;
    this.camera.lookAt(lookAheadX, this.player.position.y + 0.55, lookAheadZ);
  }

  private triggerHazard(message: string): void {
    if (performance.now() < this.hazardLockedUntil || this.isOverlayOpen()) {
      return;
    }

    this.hazardLockedUntil = performance.now() + this.hazardGraceMs;
    this.lives -= 1;
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
    this.playerHeading = Math.PI;
    this.updatePlaytestState();
  }

  private refreshHud(): void {
    const level = LEVELS[this.levelIndex];
    this.hud.level.textContent = `Level ${level.id}: ${level.title}`;
    this.hud.level.style.color = level.theme.hud;
    this.hud.lives.textContent = `Lives: ${this.lives}`;
    this.hud.lives.style.color = level.theme.hud;
    this.hud.crumbs.textContent = `Crumbs: ${this.crumbs}  Next life in: ${3 - this.extraLifeBank}`;
    this.hud.crumbs.style.color = level.theme.hud;
    this.updateGuidanceHud();
  }

  private flashHint(text: string): void {
    this.hud.hint.textContent = text;
    window.clearTimeout(this.currentHintTimeout);
    this.currentHintTimeout = window.setTimeout(() => {
      this.hud.hint.textContent = "Find the parmesan before Alice does.";
    }, 1400);
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
    const angle = Math.atan2(toCheese.x, toCheese.z) - this.playerHeading;
    const normalized = Math.atan2(Math.sin(angle), Math.cos(angle));

    let label = "Straight ahead";
    if (normalized > Math.PI / 3) label = "Turn left";
    else if (normalized > Math.PI / 9) label = "Veer left";
    else if (normalized < -Math.PI / 3) label = "Turn right";
    else if (normalized < -Math.PI / 9) label = "Veer right";

    this.hud.guide.textContent = `Cheese: ${label} · ${distance.toFixed(1)}m`;
    this.hud.cat.textContent = this.catChasing ? "Cat: Chasing" : "Cat: Patrolling";
    this.hud.cat.classList.toggle("alert", this.catChasing);
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
      aliceProgress: Number(aliceProgress.toFixed(2)),
      hint: this.hud.hint.textContent,
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
