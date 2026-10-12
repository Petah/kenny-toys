/**
 * URL for a file in the Kenney bundle, e.g. kenney('2D assets/Googly Eyes/PNG/googly-a.png').
 * The file must also be covered by an "assets" glob in the game's game.json to ship in the build.
 */
export function kenney(relPath: string): string {
  return `${import.meta.env.BASE_URL}kenney/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}
