/**
 * What a game's phone controller (`games/<id>/src/controller.ts`) exports for the join page.
 * The join page owns the connection; the controller owns the screen while it's mounted.
 */
export interface ControllerContext {
  /** The name this phone joined with. */
  name: string;
  /** Sends a message to the game on the TV. */
  send(data: Record<string, unknown>): void;
}

export interface Controller {
  /** A message from the game on the TV. */
  message(data: Record<string, unknown>): void;
  destroy?(): void;
}

export interface ControllerModule {
  mount(root: HTMLElement, ctx: ControllerContext): Controller;
}
