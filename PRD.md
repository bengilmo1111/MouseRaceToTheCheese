# Race to the cheese is a 3d 3/4 view kids game. 

## game 
- game is fun and suitable for primary age children
- You are a mouse.
- You have to race through a maze to get a wedge of parmesan cheese
- There is a baby called Alice. She is crawling to the cheese from outside the maze. If she gets there first, you lose. She acts as the timer.
- You pick up little crumbs of cheese. Getting 3 gets you another life.
- There are mouse traps in the game. Get caught, lose a life.
- There is a cat in the maze. Get caught, lose a life.
- You start with 3 lives. Lose them all, and it is game over.
- There are teleportation gems that move you around the maze
- there is more than 1 maze. You unlock them as you go. Each should have a different theme.
- The game should be browser based and mobile and desktop friendly
- Game will be deployed via vercel


## Build reqs
- build as if you there are other agents working on this project. Clear plans, clear progress markers and well documented changes and commits.

## Progress
- [x] Basic game loop and mechanics (lives, crumbs, traps, gems, cat, timer)
- [x] 3D Renderer setup with lighting and shadows
- [x] Background music added and looping correctly
- [x] Playtesting UI included for quick debugging and testing
- [x] Level 1: Cheese Wedge shaped maze implemented
- [x] Level 2: Sweetheart (heart-shaped) maze implemented
- [x] Level 3: Midnight Octagon maze implemented
- [x] Implemented Web Audio API for interactive SFX (pickups, damage, teleports)
- [x] Added visual "juice" (camera shake on damage, hover animations for pickups, waddle animations for characters)
- [x] Kid-friendly pass: glowing compass arrow in Kid mode (points to next key/cheese), confetti celebration on level complete, short encouraging emoji messages, longer toast read time
- [x] Simple control scheme (default): press the direction you want to go (camera-relative with yaw latching); touch uses a single 4-way D-pad; old tank controls kept as "Classic" via start-screen picker
- [x] Performance pass: batch all maze walls into one merged mesh per material (hundreds of draw calls → ~2 per level); spatial wall grid so collision/camera checks scan only nearby cells; mobile pixel-ratio cap (1.5x) and smaller shadow map (1024) on touch devices; debug-state JSON only serialized when the playtest panel is visible; full geometry/material disposal on level unload
- [x] Portrait fix: D-pad centered along the bottom and camera lifted on tall screens so touch controls no longer cover the mouse
- [x] Progression pass (PRD: "you unlock them as you go"): mazes now unlock by grabbing the cheese in the previous one, persisted in localStorage with per-maze best times; picker shows 🔒 locked state (with shake + hint on tap) and ⭐ best-time chips; completion overlay reports race time, new-best 🏆, and unlock announcements; 🏠 HUD button returns to the menu; playtest hooks `completeLevel`/`resetProgress`/`unlockAll`/`returnToMenu`
- [x] Character-life pass: stride-driven paw patter for mouse and cat (feet match ground speed, rest when standing); cat overhaul — paws added, tail rebuilt on a swishing pivot, ears flatten back and slit pupils go round in hunt mode; mouse "happy nibble" (ear splay + double-time tail wag) on crumb/key pickups; pulsing cheese goal ring and beacon; `warpNearCat` playtest hook to observe chases without triggering the catch
- [x] Mousiness pass: rebuilt the mouse with big round upright ears, haunches, a longer pointier snout with buck teeth, readable cylinder whiskers, and a long trailing tail with a lifted tip that wags into view on turns; nose-sniff and speed-scaled tail-slither animations; "GO!" kickoff toast + chirp on race/level start; darting start-screen mascot; difficulty icons (🐣⭐🔥); bouncing celebration titles
- [x] UI/UX polish pass: animated start-screen mascots + tagline, screen/card entrance animations with blurred backdrop, context-aware overlay buttons ("Let's Go!", "Next Maze ➜", "Try Again"…), HUD counter bump/shake feedback, pulsing timer alarm when Alice nears the cheese, hover/press/focus states on all buttons, sticky Start button on small portrait screens, and prefers-reduced-motion support