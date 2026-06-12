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