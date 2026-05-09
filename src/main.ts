import "./styles.css";
import { MouseRace3D } from "./game/MouseRace3D";

const gameContainer = document.getElementById("game-container");
if (!gameContainer) {
  throw new Error("Missing #game-container element.");
}

new MouseRace3D(gameContainer);
