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
| ⬜ | Topple | Physics Assets | Angry Birds-style knock-the-blocks-down physics. |
| ⬜ | Tilt Maze | Rolling Ball Assets | Tilt a board (device tilt or arrows) to roll a ball to the goal. |
| ⬜ | Fish Frenzy | Fish Pack | Eat smaller fish, grow, avoid bigger ones. |
| ⬜ | Abduction | Alien UFO Pack | Tractor-beam cows before the timer ends. |
| ⬜ | Slingshot | Planets | Launch a probe around gravity wells to a target. |
| ⬜ | Downhill | Tiny Ski | SkiFree-style endless slope. |
| ⬜ | Domino Chain | Domino Pack | Place dominoes, tip the first, watch the chain. |
| ⬜ | Word Drop | Letter Tiles Redux | Falling letters, spell words to clear them. |
| ⬜ | Sokoban | Sokoban Pack | Push crates onto targets. |
| ⬜ | Emote Match | Emote Pack, Smilies | Match-3 with emotes. |
| ⬜ | Blackjack | Playing Cards, Casino Audio | Quick card table. |
| ⬜ | Mini Shmup | Pixel Shmup | Vertical shooter waves. |

### 3D (three.js + `.glb`)

| Status | Game | Kit | Pitch |
|---|---|---|---|
| ⬜ | Marble Run | Marble Kit | Snap track pieces together, drop marbles. Sandbox, no fail state. |
| ⬜ | Minigolf | Minigolf Kit | 9 holes, click-drag to putt. |
| ⬜ | Coaster Builder | Coaster Kit | Lay track, then ride it first-person. |
| ⬜ | Pet Stack | Cube Pets | Drop cube animals onto a wobbling tower. |
| ⬜ | Bedroom RC | Toy Car Kit | Drift a toy car around a block-built track. |
| ⬜ | Train Switcher | Train Kit | Flip switches to route trains to matching stations. |
| ⬜ | Burger Stack | Food Kit | Catch falling ingredients in order-ticket order. |
| ⬜ | Blaster Range | Blaster Kit | First-person toy blaster gallery. |
