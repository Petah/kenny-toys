/** Shape of games/<id>/game.json. Read by the launcher and the build's asset copier. */
export interface GameManifest {
  title: string;
  description: string;
  /** Kenney-relative path of the image shown on the launcher card. */
  thumbnail?: string;
  /** Kenney-relative globs of every file the game loads. Only these ship in the build. */
  assets: string[];
}
