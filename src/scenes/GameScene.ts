import Phaser from "phaser";
import { LEVELS, LevelDefinition } from "../game/levels";

type ButtonState = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

export class GameScene extends Phaser.Scene {
  private readonly tileSize = 64;
  private readonly worldOffsetX = 64;
  private readonly worldOffsetY = 126;
  private readonly moveSpeed = 190;
  private readonly hazardGraceMs = 1200;

  private levelIndex = 0;
  private lives = 3;
  private crumbs = 0;
  private extraLifeBank = 0;
  private hasWonGame = false;
  private hasSeenIntro = false;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private buttons: ButtonState = { left: false, right: false, up: false, down: false };

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private crumbsGroup!: Phaser.Physics.Arcade.StaticGroup;
  private traps!: Phaser.Physics.Arcade.StaticGroup;
  private gems!: Phaser.Physics.Arcade.StaticGroup;
  private cat!: Phaser.Physics.Arcade.Sprite;
  private cheese!: Phaser.Physics.Arcade.Sprite;
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerStart!: Phaser.Math.Vector2;
  private gemCooldownUntil = 0;
  private hazardLockedUntil = 0;
  private overlay?: Phaser.GameObjects.Container;
  private overlayText?: Phaser.GameObjects.Text;
  private overlayHint?: Phaser.GameObjects.Text;
  private aliceProgress = 0;
  private aliceElapsedMs = 0;
  private levelComplete = false;
  private levelDecor?: Phaser.GameObjects.Container;

  private hudLevel!: Phaser.GameObjects.Text;
  private hudLives!: Phaser.GameObjects.Text;
  private hudCrumbs!: Phaser.GameObjects.Text;
  private hudHint!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private timerFrame!: Phaser.GameObjects.Rectangle;
  private aliceMarker!: Phaser.GameObjects.Container;
  private fullscreenButton!: Phaser.GameObjects.Container;
  private playerEars?: Phaser.GameObjects.Container;
  private catTail?: Phaser.GameObjects.Rectangle;

  private catPatrolPoints: Phaser.Math.Vector2[] = [];
  private catPatrolIndex = 0;

  constructor() {
    super("GameScene");
  }

  create(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is required for GameScene.");
    }

    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys("W,A,S,D") as Record<
      "W" | "A" | "S" | "D",
      Phaser.Input.Keyboard.Key
    >;
    keyboard.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE", "W", "A", "S", "D"]);

    this.buildBackground();
    this.buildHud();
    this.buildTouchControls();
    this.buildOverlay();
    this.loadLevel(this.levelIndex);
    this.showIntro();
  }

  update(_: number, delta: number): void {
    if (!this.player || !this.cat) {
      return;
    }

    if (this.overlay?.visible) {
      this.player.setVelocity(0, 0);
      this.cat.setVelocity(0, 0);
      return;
    }

    this.updateAliceTimer(delta);
    this.updatePlayerMovement();
    this.updateCatPatrol();
    this.syncActorDecor();
  }

  private buildBackground(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.add.rectangle(width * 0.5, height * 0.5, width, height, 0xfff3c8);
    this.add.ellipse(160, 92, 240, 120, 0xffffff, 0.3);
    this.add.ellipse(width - 180, height - 90, 320, 160, 0xf2c66f, 0.25);
  }

  private buildHud(): void {
    const fontFamily = "Trebuchet MS";
    const hudStyle = {
      fontFamily,
      color: "#3a2c12",
      fontSize: "28px",
      fontStyle: "bold",
    };

    this.hudLevel = this.add.text(42, 24, "", hudStyle);
    this.hudLives = this.add.text(42, 60, "", hudStyle);
    this.hudCrumbs = this.add.text(320, 60, "", hudStyle);
    this.hudHint = this.add.text(618, 24, "Beat Alice to the cheese!", {
      fontFamily,
      color: "#7b4d15",
      fontSize: "24px",
      fontStyle: "bold",
      align: "right",
    });
    this.hudHint.setOrigin(1, 0);
    this.hudHint.x = this.scale.width - 42;

    this.timerFrame = this.add.rectangle(this.scale.width * 0.5, 64, 356, 26, 0xffffff, 0.8);
    this.timerFrame.setStrokeStyle(4, 0xc98a2d);

    this.timerBar = this.add.rectangle(this.scale.width * 0.5 - 172, 64, 340, 16, 0xffae42);
    this.timerBar.setOrigin(0, 0.5);

    this.aliceMarker = this.add.container(this.scale.width * 0.5 - 170, 64);
    const head = this.add.circle(0, -10, 12, 0xffd6d6);
    const body = this.add.rectangle(0, 10, 20, 24, 0xff89a9, 1);
    const handLeft = this.add.rectangle(-16, 8, 10, 6, 0xffd6d6, 1);
    const handRight = this.add.rectangle(16, 8, 10, 6, 0xffd6d6, 1);
    this.aliceMarker.add([body, head, handLeft, handRight]);

    const buttonBg = this.add.rectangle(this.scale.width - 68, 64, 100, 36, 0xffffff, 0.86);
    buttonBg.setStrokeStyle(4, 0xc98a2d);
    const buttonText = this.add.text(this.scale.width - 68, 64, "FULL", {
      fontFamily: fontFamily,
      fontSize: "18px",
      color: "#7b4d15",
      fontStyle: "bold",
    });
    buttonText.setOrigin(0.5);

    this.fullscreenButton = this.add.container(0, 0, [buttonBg, buttonText]);
    this.fullscreenButton.setSize(100, 36);
    this.fullscreenButton.setInteractive(
      new Phaser.Geom.Rectangle(this.scale.width - 118, 46, 100, 36),
      Phaser.Geom.Rectangle.Contains,
    );
    this.fullscreenButton.on("pointerup", () => {
      this.scale.toggleFullscreen();
      buttonBg.setFillStyle(0xffd76c, 0.96);
      this.time.delayedCall(160, () => buttonBg.setFillStyle(0xffffff, 0.86));
    });
  }

  private buildTouchControls(): void {
    const controls = [
      { label: "LEFT", x: 116, y: 560, key: "left" as const },
      { label: "RIGHT", x: 248, y: 560, key: "right" as const },
      { label: "UP", x: 182, y: 494, key: "up" as const },
      { label: "DOWN", x: 182, y: 626, key: "down" as const },
    ];

    controls.forEach(({ label, x, y, key }) => {
      const button = this.add.circle(x, y, 42, 0xffffff, 0.85);
      button.setStrokeStyle(5, 0xd48a2b);
      button.setInteractive({ useHandCursor: true });

      const text = this.add.text(x, y, label, {
        fontFamily: "Trebuchet MS",
        fontSize: "18px",
        color: "#7b4d15",
        fontStyle: "bold",
      });
      text.setOrigin(0.5);

      const setState = (value: boolean) => {
        this.buttons[key] = value;
        button.setFillStyle(value ? 0xffd76c : 0xffffff, 0.92);
      };

      button.on("pointerdown", () => setState(true));
      button.on("pointerup", () => setState(false));
      button.on("pointerout", () => setState(false));
      button.on("pointerupoutside", () => setState(false));
    });
  }

  private buildOverlay(): void {
    const panel = this.add.rectangle(this.scale.width * 0.5, this.scale.height * 0.5, 520, 260, 0xfff9ea, 0.96);
    panel.setStrokeStyle(8, 0xd18d2d);

    this.overlayText = this.add.text(this.scale.width * 0.5, this.scale.height * 0.5 - 22, "", {
      fontFamily: "Trebuchet MS",
      fontSize: "42px",
      color: "#5a380f",
      fontStyle: "bold",
      align: "center",
      wordWrap: { width: 420 },
    });
    this.overlayText.setOrigin(0.5);

    this.overlayHint = this.add.text(this.scale.width * 0.5, this.scale.height * 0.5 + 72, "", {
      fontFamily: "Trebuchet MS",
      fontSize: "24px",
      color: "#7b4d15",
      align: "center",
      wordWrap: { width: 420 },
    });
    this.overlayHint.setOrigin(0.5);

    this.overlay = this.add.container(0, 0, [panel, this.overlayText, this.overlayHint]);
    this.overlay.setDepth(40);
    this.overlay.setVisible(false);

    const continueFlow = () => {
      if (!this.overlay?.visible) {
        return;
      }

      if (this.hasWonGame) {
        this.restartWholeGame();
        return;
      }

      if (this.levelComplete) {
        this.levelIndex += 1;
        if (this.levelIndex >= LEVELS.length) {
          this.hasWonGame = true;
          this.showOverlay("You won!", "Alice can share the parmesan now. Tap or press SPACE to play again.");
          return;
        }

        this.loadLevel(this.levelIndex);
        return;
      }

      if (this.lives <= 0) {
        this.restartWholeGame();
        return;
      }

      this.resetActorsToStart();
      this.overlay.setVisible(false);
    };

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is required for GameScene.");
    }

    keyboard.on("keydown-SPACE", continueFlow);
    this.input.on("pointerup", continueFlow);
  }

  private loadLevel(index: number): void {
    this.overlay?.setVisible(false);
    this.levelComplete = false;
    this.aliceElapsedMs = 0;
    this.aliceProgress = 0;
    this.catPatrolIndex = 0;
    this.catPatrolPoints = [];
    this.levelDecor?.destroy(true);
    this.playerEars?.destroy();
    this.playerEars = undefined;
    this.catTail?.destroy();
    this.catTail = undefined;

    this.walls?.clear(true, true);
    this.crumbsGroup?.clear(true, true);
    this.traps?.clear(true, true);
    this.gems?.clear(true, true);
    this.player?.destroy();
    this.cat?.destroy();
    this.cheese?.destroy();

    const level = LEVELS[index];
    const floorWidth = level.map[0].length * this.tileSize;
    const floorHeight = level.map.length * this.tileSize;
    const floorCenterX = this.worldOffsetX + floorWidth * 0.5;
    const floorCenterY = this.worldOffsetY + floorHeight * 0.5;

    const shadow = this.add.rectangle(
      floorCenterX,
      floorCenterY + 18,
      floorWidth + 18,
      floorHeight + 18,
      level.theme.shadow,
      0.28,
    );
    const floor = this.add.rectangle(floorCenterX, floorCenterY, floorWidth, floorHeight, level.theme.floor, 1);
    this.levelDecor = this.add.container(0, 0, [shadow, floor]);

    this.walls = this.physics.add.staticGroup();
    this.crumbsGroup = this.physics.add.staticGroup();
    this.traps = this.physics.add.staticGroup();
    this.gems = this.physics.add.staticGroup();

    const gemPoints: Phaser.Math.Vector2[] = [];

    level.map.forEach((line, row) => {
      [...line].forEach((cell, col) => {
        const x = this.worldOffsetX + col * this.tileSize + this.tileSize * 0.5;
        const y = this.worldOffsetY + row * this.tileSize + this.tileSize * 0.5;

        if (cell === "#") {
          this.createWallBlock(x, y, level);
          return;
        }

        if (cell === ".") {
          const crumb = this.add.circle(x, y + 8, 8, 0xffef88, 1);
          this.physics.add.existing(crumb, true);
          this.crumbsGroup.add(crumb);
          return;
        }

        if (cell === "T") {
          const trap = this.add.container(x, y + 6);
          trap.add([
            this.add.rectangle(0, 0, 42, 18, 0x88684d),
            this.add.triangle(-14, 0, 0, 0, 8, -18, 16, 0, 0xc5c5c5),
            this.add.triangle(0, 0, 0, 0, 8, -18, 16, 0, 0xc5c5c5),
            this.add.triangle(14, 0, 0, 0, 8, -18, 16, 0, 0xc5c5c5),
          ]);
          this.physics.add.existing(trap, true);
          this.traps.add(trap);
          return;
        }

        if (cell === "G") {
          const gem = this.add.star(x, y + 6, 6, 10, 16, level.theme.accent, 1);
          gem.setStrokeStyle(4, 0xffffff, 0.95);
          this.physics.add.existing(gem, true);
          this.gems.add(gem);
          gemPoints.push(new Phaser.Math.Vector2(x, y));
          return;
        }

        if (cell === "W") {
          this.cheese = this.physics.add.sprite(x, y + 2, "__WHITE");
          this.cheese.setDisplaySize(46, 38);
          this.cheese.setTint(0xffd34a);
          const cheeseBody = this.cheese.body as Phaser.Physics.Arcade.Body;
          cheeseBody.setAllowGravity(false);
          cheeseBody.moves = false;
          cheeseBody.setSize(44, 36);
          this.drawCheeseFace(x, y + 2);
          return;
        }

        if (cell === "P") {
          this.playerStart = new Phaser.Math.Vector2(x, y);
          this.player = this.createMouseSprite(x, y);
          return;
        }

        if (cell === "C") {
          this.cat = this.createCatSprite(x, y);
          this.catPatrolPoints.push(new Phaser.Math.Vector2(x, y));
        }

        if (cell !== "#") {
          const neighbors = [
            level.map[row]?.[col - 1],
            level.map[row]?.[col + 1],
            level.map[row - 1]?.[col],
            level.map[row + 1]?.[col],
          ].filter((value) => value && value !== "#");

          if (cell === "C" || neighbors.length >= 3) {
            this.catPatrolPoints.push(new Phaser.Math.Vector2(x, y));
          }
        }
      });
    });

    if (gemPoints.length >= 2) {
      this.gems.getChildren().forEach((entry, indexGem) => {
        entry.setData("pairIndex", (indexGem + 1) % gemPoints.length);
      });
    }

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.cat, this.walls);
    this.physics.add.overlap(
      this.player,
      this.crumbsGroup,
      (_player, crumb) => this.collectCrumb(crumb as Phaser.GameObjects.GameObject),
      undefined,
      this,
    );
    this.physics.add.overlap(this.player, this.traps, () => this.hitHazard("The trap snapped!"), undefined, this);
    this.physics.add.overlap(
      this.player,
      this.gems,
      (_player, gem) => this.teleportPlayer(gem as Phaser.GameObjects.GameObject),
      undefined,
      this,
    );
    this.physics.add.overlap(this.player, this.cat, () => this.hitHazard("The cat caught you!"), undefined, this);
    this.physics.add.overlap(this.player, this.cheese, () => this.completeLevel(), undefined, this);

    this.refreshHud(level);
  }

  private createWallBlock(x: number, y: number, level: LevelDefinition): void {
    const wall = this.add.container(x, y);
    const base = this.add.rectangle(0, 10, this.tileSize - 4, this.tileSize - 8, level.theme.wallFace, 1);
    const top = this.add.rectangle(0, -4, this.tileSize - 8, this.tileSize - 16, level.theme.wallTop, 1);
    const shine = this.add.rectangle(-10, -8, 14, 26, 0xffffff, 0.12);
    wall.add([base, top, shine]);

    this.physics.add.existing(wall, true);
    const body = wall.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(this.tileSize - 10, this.tileSize - 18);
    body.position.x = x - (this.tileSize - 10) * 0.5;
    body.position.y = y - (this.tileSize - 18) * 0.5 + 8;
    this.walls.add(wall);
  }

  private createMouseSprite(x: number, y: number): Phaser.Physics.Arcade.Sprite {
    const sprite = this.physics.add.sprite(x, y + 2, "__WHITE");
    sprite.setDisplaySize(34, 34);
    sprite.setTint(0xb7b1bf);
    sprite.setCollideWorldBounds(true);
    sprite.setDrag(800, 800);
    sprite.setMaxVelocity(this.moveSpeed, this.moveSpeed);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(16, 1, 1);

    this.playerEars = this.add.container(x, y - 12, [
      this.add.circle(-9, 0, 7, 0xd8bfd5),
      this.add.circle(9, 0, 7, 0xd8bfd5),
    ]);

    return sprite;
  }

  private createCatSprite(x: number, y: number): Phaser.Physics.Arcade.Sprite {
    const sprite = this.physics.add.sprite(x, y + 4, "__WHITE");
    sprite.setDisplaySize(42, 42);
    sprite.setTint(0xf07e45);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    sprite.setImmovable(true);
    body.setCircle(18, 3, 3);

    this.catTail = this.add.rectangle(x - 18, y + 3, 10, 26, 0xb75831, 1);
    this.catTail.setAngle(-25);

    return sprite;
  }

  private drawCheeseFace(x: number, y: number): void {
    this.add.circle(x - 8, y - 4, 4, 0xf0b100);
    this.add.circle(x + 6, y + 8, 5, 0xf0b100);
    this.add.circle(x + 10, y - 10, 3, 0xf0b100);
  }

  private updatePlayerMovement(): void {
    const left = this.cursors.left.isDown || this.wasd.A.isDown || this.buttons.left;
    const right = this.cursors.right.isDown || this.wasd.D.isDown || this.buttons.right;
    const up = this.cursors.up.isDown || this.wasd.W.isDown || this.buttons.up;
    const down = this.cursors.down.isDown || this.wasd.S.isDown || this.buttons.down;

    let velocityX = 0;
    let velocityY = 0;

    if (left) velocityX -= this.moveSpeed;
    if (right) velocityX += this.moveSpeed;
    if (up) velocityY -= this.moveSpeed;
    if (down) velocityY += this.moveSpeed;

    if (velocityX !== 0 && velocityY !== 0) {
      const diagonalScale = Math.SQRT1_2;
      velocityX *= diagonalScale;
      velocityY *= diagonalScale;
    }

    this.player.setVelocity(velocityX, velocityY);
    if (velocityX !== 0) {
      this.player.setFlipX(velocityX < 0);
    }
  }

  private updateCatPatrol(): void {
    if (this.catPatrolPoints.length < 2) {
      this.cat.setVelocity(0, 0);
      return;
    }

    const target = this.catPatrolPoints[this.catPatrolIndex];
    const distance = Phaser.Math.Distance.Between(this.cat.x, this.cat.y, target.x, target.y);

    if (distance < 8) {
      this.catPatrolIndex = (this.catPatrolIndex + 1) % this.catPatrolPoints.length;
    }

    this.physics.moveTo(this.cat, target.x, target.y, LEVELS[this.levelIndex].catSpeed);
    const body = this.cat.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.x !== 0) {
      this.cat.setFlipX(body.velocity.x < 0);
    }
  }

  private syncActorDecor(): void {
    if (this.playerEars?.active && this.player?.active) {
      this.playerEars.setPosition(this.player.x, this.player.y - 12);
      this.playerEars.setAlpha(this.player.alpha);
    }

    if (this.catTail?.active && this.cat?.active) {
      this.catTail.setPosition(this.cat.x - 18, this.cat.y + 3);
      this.catTail.angle = this.cat.flipX ? 25 : -25;
    }
  }

  private collectCrumb(crumb: Phaser.GameObjects.GameObject): void {
    crumb.destroy();
    this.crumbs += 1;
    this.extraLifeBank += 1;

    if (this.extraLifeBank >= 3) {
      this.extraLifeBank = 0;
      this.lives += 1;
      this.flashHint("Three crumbs earned an extra life!");
    } else {
      this.flashHint("Crunch! More cheese crumbs.");
    }

    this.refreshHud(LEVELS[this.levelIndex]);
  }

  private teleportPlayer(gem: Phaser.GameObjects.GameObject): void {
    if (this.time.now < this.gemCooldownUntil) {
      return;
    }

    const pairIndex = gem.getData("pairIndex");
    const gemEntries = this.gems.getChildren();
    const pair = gemEntries[pairIndex] as Phaser.GameObjects.GameObject & { x: number; y: number } | undefined;
    if (!pair) {
      return;
    }

    this.gemCooldownUntil = this.time.now + 900;
    this.player.setPosition(pair.x, pair.y);
    this.flashHint("Zip! The gem whisked you away.");
  }

  private hitHazard(message: string): void {
    if (this.time.now < this.hazardLockedUntil || this.overlay?.visible) {
      return;
    }

    this.hazardLockedUntil = this.time.now + this.hazardGraceMs;
    this.lives -= 1;
    this.refreshHud(LEVELS[this.levelIndex]);

    if (this.lives <= 0) {
      this.showOverlay("Game over", "Alice found the cheese first. Tap or press SPACE to start again.");
      return;
    }

    this.showOverlay("Ouch!", `${message}\nYou still have ${this.lives} lives left.`);
  }

  private completeLevel(): void {
    if (this.levelComplete) {
      return;
    }

    this.levelComplete = true;
    this.showOverlay("Cheese reached!", "Alice is still outside. Tap or press SPACE for the next maze.");
  }

  private updateAliceTimer(delta: number): void {
    const level = LEVELS[this.levelIndex];
    this.aliceElapsedMs += delta;
    this.aliceProgress = Phaser.Math.Clamp(this.aliceElapsedMs / level.aliceTimeMs, 0, 1);
    this.timerBar.width = 340 * (1 - this.aliceProgress);
    this.aliceMarker.x = this.scale.width * 0.5 - 170 + 340 * this.aliceProgress;

    if (this.aliceProgress < 0.55) {
      this.timerBar.setFillStyle(0xffc74d);
    } else if (this.aliceProgress < 0.8) {
      this.timerBar.setFillStyle(0xff934d);
    } else {
      this.timerBar.setFillStyle(0xff5e57);
    }

    if (this.aliceProgress >= 1) {
      this.hitHazard("Alice reached the parmesan!");
      this.aliceElapsedMs = 0;
    }
  }

  private resetActorsToStart(): void {
    this.overlay?.setVisible(false);
    this.aliceElapsedMs = 0;
    this.gemCooldownUntil = 0;
    this.player.setPosition(this.playerStart.x, this.playerStart.y);
    this.player.setVelocity(0, 0);
    this.cat.setVelocity(0, 0);
    this.catPatrolIndex = 0;
  }

  private restartWholeGame(): void {
    this.levelIndex = 0;
    this.lives = 3;
    this.crumbs = 0;
    this.extraLifeBank = 0;
    this.hasWonGame = false;
    this.loadLevel(this.levelIndex);
    this.showIntro();
  }

  private showIntro(): void {
    if (this.hasSeenIntro) {
      return;
    }

    this.hasSeenIntro = true;
    this.showOverlay(
      "Race To The Cheese",
      "You are a brave mouse.\nUse arrow keys, WASD, or the big touch buttons.\nGrab crumbs, dodge traps, beat the cat, and reach the parmesan before Alice does.\n\nTap or press SPACE to start.",
    );
  }

  private showOverlay(title: string, body: string): void {
    if (!this.overlay || !this.overlayText) {
      return;
    }

    this.overlayText.setText(title);
    this.overlayHint?.setText(body);
    this.overlay.setVisible(true);
  }

  private flashHint(text: string): void {
    this.hudHint.setText(text);
    this.time.delayedCall(1300, () => {
      if (this.hudHint.active) {
        this.hudHint.setText("Beat Alice to the cheese!");
      }
    });
  }

  private refreshHud(level: LevelDefinition): void {
    this.hudLevel.setText(`Level ${level.id}: ${level.title}`);
    this.hudLives.setText(`Lives: ${this.lives}`);
    this.hudCrumbs.setText(`Crumbs: ${this.crumbs}  Next life in: ${3 - this.extraLifeBank}`);
    this.hudLevel.setColor(level.theme.hud);
    this.hudLives.setColor(level.theme.hud);
    this.hudCrumbs.setColor(level.theme.hud);
  }
}
