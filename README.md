# Kenney Toys

Little browser games built on the Kenney All-in-1 asset bundle. One Vite + TypeScript project. Each game is its own page, and a launcher at the root links to them all.

```sh
npm install
npm run dev        # http://localhost:5173 — launcher + every game
npm run build      # typecheck, then build to dist/
npm run preview    # serve dist/
```

The assets are read straight from `../Kenney Game Assets All-in-1 3.7.0`. Set `KENNEY_ROOT` to use another location.

## Layout

```
build/            Vite-side code: the Kenney asset plugin and game discovery
shared/           Runtime code every game can use
  kenney.ts         kenney('2D assets/…/file.png') → URL for a bundle file
  shell.ts          setupGamePage(): theme, Kenney fonts, back-to-launcher link
  phaser.ts         createGame() (fills parent) / createFixedGame() (letterboxed), sfx helpers
  storage.ts        Guarded localStorage and high scores
  theme.css         Colours, buttons, fonts
launcher/         The root index page
games/<id>/       One folder per game
  game.json         Title, description, thumbnail, asset globs
  index.html        Page entry
  src/
```

## Adding a game

1. Create `games/<id>/` with `index.html`, `src/main.ts` and `game.json`.
2. In `main.ts`, call `await setupGamePage()` and then start your game, for example with `createGame()` from `@shared/phaser`.
3. Load assets with `kenney('<path inside the bundle>')`, and list every file you use as a glob in `game.json` under `"assets"`.

New games are picked up automatically by the launcher and as a build entry. You don't need to edit any config.

### Assets

During dev, any bundle file is served under `/kenney/…`. If a game loads a file that no `game.json` declares, the terminal shows a warning. The build copies only the declared files, and it fails if a glob matches nothing, so a missing declaration shows up before you ship.

Phaser is split into its own chunk, so the browser downloads it once for all games. For 3D games, add `three` and load the `.glb` models from the 3D kits the same way.
