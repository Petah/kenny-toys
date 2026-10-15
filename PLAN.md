# What we're doing

We're making a collection of small, fun browser games and toys, each built around one Kenney asset pack. The question for each pack is: what's the *ideal* little game for this specific set? The games are short. They should be fun within 10 seconds, with no deep progression. Think fairground stall, desk toy, or a one-more-go arcade loop.

The asset bundle lives next to this repo at `../Kenney Game Assets All-in-1 3.7.0` (about 91k files, never committed). It's all CC0. See `README.md` for how the build serves and copies it.

## Principles

- **One pack, one idea.** Start from what the pack already gives you (its HUD text, sounds, sample image) and build the game it was obviously drawn for. Audio, font and UI packs can be mixed in freely.
- **Small and polished beats big.** Each game should have juice: pop-in tweens, screen shake, sounds on every action, and a satisfying "game over / again?" loop.
- **Libraries over hand-rolling.** Use Phaser 4 for 2D and three.js for 3D kits (the `.glb` models). Reach for an established library before writing an engine piece yourself, and drop in physics libraries where they're needed.
- **Shared pipeline.** Each game is a folder in `games/` with a `game.json`. The launcher, build entries and asset copying all come from that. Anything a second game would need goes in `shared/` (helpers, theme, sound, storage), not copy-pasted.
- **Works everywhere.** Mouse, touch and keyboard where it makes sense, at desktop and phone sizes.

## Conventions

- TypeScript strict. `npm run build` (typecheck + build) must pass before committing.
- Load every bundle file through `kenney('<path>')` and declare it in `game.json` `assets`. If dev prints an "undeclared" warning, fix it.
- Prefer atlases (`Spritesheet/*.xml`, loaded with `load.atlasXML`) over individual PNGs.
- Per-viewer state like high scores uses `shared/storage.ts`, which tolerates blocked storage.
- In dev builds, games expose their main scene on `window` for debugging and automated checks.
- Verify by actually playing: run `npm run dev` and drive it with Playwright (headless Chrome is available), take screenshots and check the console for errors.
- One commit per game or meaningful step.

## Adding a game (checklist)

1. Look at the pack's `Preview.png` / `Sample.png` and list its frames (`Spritesheet/*.xml`).
2. Write a one-line pitch plus "the fun part" in the backlog below.
3. Create `games/<id>/` with `game.json`, `index.html` and `src/main.ts`, calling `setupGamePage()` and `createGame()`.
4. Build the core loop first, then add juice and sound, then the start/end screens and high score.
5. Play-test with Playwright at 1280×800 and 390×760, then commit.

## Backlog

`CATALOG.md` has a one-line game idea for every pack in the bundle. This backlog is the shortlist being worked through.

Status: ✅ done · 🚧 in progress · ⬜ idea

### 2D

| Status | Game | Packs | Pitch |
|---|---|---|---|
| ✅ | Monster Maker | Monster Builder, Googly Eyes | Build a monster from parts. Googly eyes follow the cursor, plus randomise, dance and PNG export. |
| ✅ | Duck Shoot | Shooting Gallery, Voiceover, Desert Shooter sounds | Fairground gallery: ducks and targets glide on rows, 60s timer, ammo and reload, ring scoring. |
| ✅ | Donut Splat | Donuts, Splat Pack | Fruit Ninja with donuts. Swipes leave paint splats. |
| ✅ | Tappy Plane | Tappy Plane, Foley + Retro sounds, Voiceover | Flappy Bird through rock spikes: random plane and terrain each round, puff trails, medals on the GAME OVER card. |
| ✅ | Topple | Physics Assets, Explosion Pack, Impact Sounds | Angry Birds-style slingshot: 8 levels of wood, glass, stone and TNT towers with aliens to knock off, stars per level. |
| ✅ | Tilt Maze | Rolling Ball Assets | Tilt a board (phone tilt, arrows or drag) to roll a ball home: 10 levels of holes, keys and locked blocks, spinners and lasers, 3 stars each. Portrait screens play each level mirrored on its diagonal. `games/tilt-maze/scripts/check-levels.ts` checks every level can be finished. |
| ✅ | Fish Frenzy | Fish Pack, Interface + Retro sounds, Steeldrum jingles, Voiceover | Eat smaller fish to grow through four sizes (pink, green, blue, red), each unlocking the next fish as food. Bigger fish chase you, pufferfish puff up and eels dash in after a warning. Three lives, combos for quick bites, and a full growth bar clears the wave and shrinks you back for a busier one. |
| ✅ | Abduction | Alien UFO Pack, Animal Pack Remastered, Background Elements Remastered, Sci-Fi + Digital sounds | A 60s round over a farm at night: hold to beam animals up (Matter physics; heavy ones rise slower, and they scatter from the beam). A WANTED list adds time when filled, a little less each order. Beaming the bull gets the ship rammed: dents and -5s. |
| ✅ | Slingshot | Planets, Space Shooter Extension + Remastered, Explosion Pack, Sci-Fi + Digital sounds | Drag back to fling a probe; planets pull it round (a fixed-step sim in `sim.ts`, so the aiming dots are the true path). 10 levels of slingshots, gaps, asteroid belts, orbiting moons and a moving station, 3 stars each and fewest launches as the best. Portrait plays each level mirrored on its diagonal. `games/slingshot/scripts/check-levels.ts` flies every launch on a grid and checks each level has enough three-star shots; `--suggest N` finds a curvy path to put stars on. |
| ✅ | Downhill | Tiny Ski, Impact + Retro sounds, Voiceover | SkiFree-style endless slope in the pack's pixel art at whole-number zoom: steer at the pointer or with the arrow keys, crash into trees, rocks and snowmen, jump ramps, and chain slalom gates for style. White pistes wind through slow, tree-filled deep snow, tiled with the pack's terrain pieces the way its sample TMX joins them. Pistes narrow, obstacles creep onto them, gates tighten and speed rises over the first 2500m. Chairlifts cross every 150m. The slope is made in seeded chunks (`world.ts`) as you go; from 600m the yeti chases, a leash keeps him just off screen, and a crash or two lets him catch up. HUD and titles use the pack's own pixel font. |
| ⬜ | Domino Chain | Domino Pack | Place dominoes, tip the first, watch the chain. |
| ⬜ | Word Drop | Letter Tiles Redux | Falling letters, spell words to clear them. |
| ✅ | Sokoban | Sokoban Pack | Push crates onto targets: 12 levels, colour-matched crates, undo, tap-to-walk, coins for matching par. Levels come from `games/sokoban/scripts/generate.ts`; `check-levels.ts` solves them and checks each par. |
| ⬜ | Emote Match | Emote Pack, Smilies | Match-3 with emotes. |
| ⬜ | Blackjack | Playing Cards, Casino Audio | Quick card table. |
| ⬜ | Mini Shmup | Pixel Shmup | Vertical shooter waves. |

### 3D (three.js + `.glb`)

| Status | Game | Kit | Pitch |
|---|---|---|---|
| ✅ | Marble Run | Marble Kit | Snap pieces onto the end of the run from a palette (each piece's ports are found from its mesh in `ports.ts`), then drop marbles. Sandbox with Undo, Clear and Surprise me; the run is saved. `scripts/check-pieces.ts` prints what each palette item does; `scripts/check-runs.ts` rolls marbles down random runs and fails under 90% reaching the end. |
| ✅ | Minigolf | Minigolf Kit | 9 holes floating on a pond: drag back to putt (or arrow keys and space), splash penalties, scorecard and best round. The first 3D game: `shared/three.ts` and `shared/audio.ts` are the base for the rest. Holes are tile grids checked by `games/minigolf/scripts/check-holes.ts`, which plays them with the game's own Rapier physics to confirm each can be sunk within par. |
| ⬜ | Coaster Builder | Coaster Kit | Lay track, then ride it first-person. |
| ⬜ | Pet Stack | Cube Pets | Drop cube animals onto a wobbling tower. |
| ⬜ | Bedroom RC | Toy Car Kit | Drift a toy car around a block-built track. |
| ⬜ | Train Switcher | Train Kit | Flip switches to route trains to matching stations. |
| ⬜ | Burger Stack | Food Kit | Catch falling ingredients in order-ticket order. |
| ⬜ | Blaster Range | Blaster Kit | First-person toy blaster gallery. |
