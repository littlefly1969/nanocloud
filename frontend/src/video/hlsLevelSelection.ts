// Adaptive-playback startup policy, as pure functions.
//
// The ladder this talks to is small and fixed: ffmpeg emits a "high" rendition
// (the source, capped at 1080 on its SHORT side) and a "low" one (480 short
// side), and drops the low rung entirely when the source is already at or below
// it. So a video has one or two levels, never a deep ladder.
//
// Two things this exists to get right:
//
//  1. PLAYLIST ORDER MEANS NOTHING. The generator's -var_stream_map is
//     "v:0,a:0,name:high v:1,a:1,name:low", so the master playlist lists the
//     HIGHEST rendition first — verified against a real ffmpeg run. Anything
//     that assumed index 0 was the low rung would start at 1080p on a phone on
//     3G. Everything here sorts by pixel count and never trusts the order.
//
//  2. A LEVEL IS ONLY USEFUL UP TO THE PIXELS THAT REACH THE SCREEN. The video
//     is letterboxed into its box, so the useful resolution is what the fitted
//     rectangle needs, scaled by device pixel ratio — not the box's raw size
//     and not the level's raw size.
//
// Nothing here locks playback: the result is a START level. ABR owns every
// switch after the first fragment.

/** The subset of an hls.js `Level` this policy reads. */
export interface LevelLike {
  width: number;
  height: number;
  bitrate: number;
}

export interface PlaybackDisplayContext {
  /** The rendered video box, in CSS px. */
  playerWidth: number;
  playerHeight: number;
  /**
   * The viewport the player will occupy in fullscreen, in CSS px.
   *
   * Included because this player requests wrapper fullscreen on the `play`
   * event, so a windowed box is almost never the size the video is watched at.
   * Sizing for the box alone would start a 2560px display at 480p and only
   * climb after fullscreen — exactly the delay this policy removes.
   */
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /** navigator.connection.saveData, where the Network Information API exists. */
  saveData: boolean;
  /** navigator.connection.effectiveType, where it exists. */
  effectiveType?: string | null;
}

/**
 * Device-pixel-ratio cap.
 *
 * A 3x phone screen showing a 1080p rendition in a 400px box would "need"
 * 1200 lines by a naive calculation, so it would demand the top rung for a
 * picture nobody can resolve. 2x is the point past which more source pixels
 * stop being visible on video content.
 */
export const MAX_USEFUL_DPR = 2;

/** Effective connection types where the top rung is a bad first guess. */
const SLOW_CONNECTIONS: ReadonlySet<string> = new Set(['slow-2g', '2g', '3g']);

/** Whether the connection argues for starting at the bottom of the ladder. */
export function prefersLowestLevel(ctx: PlaybackDisplayContext): boolean {
  if (ctx.saveData) return true;
  // A MISSING Network Information API is not evidence of a slow link — most
  // browsers do not ship it. Unknown means "assume normal".
  return ctx.effectiveType != null && SLOW_CONNECTIONS.has(ctx.effectiveType);
}

/** Level indices ordered smallest-to-largest, independent of playlist order. */
export function levelsBySize(levels: readonly LevelLike[]): number[] {
  return levels
    .map((level, index) => ({ level, index }))
    .sort((a, b) => {
      const pixels = a.level.width * a.level.height - b.level.width * b.level.height;
      return pixels !== 0 ? pixels : a.level.bitrate - b.level.bitrate;
    })
    .map((entry) => entry.index);
}

/**
 * The vertical resolution a level must carry to look sharp in `box`.
 *
 * The element renders the video letterboxed, so the picture is as large as its
 * aspect ratio allows inside the box; that fitted height, times the (capped)
 * device pixel ratio, is the number of source lines that actually reach the
 * panel. Portrait media falls out of this for free — a 1080x1920 level has an
 * aspect below 1 and fits by width in a landscape box.
 */
function requiredHeightFor(
  level: LevelLike,
  boxWidth: number,
  boxHeight: number,
  dpr: number,
): number {
  if (level.width <= 0 || level.height <= 0) return 0;
  const aspect = level.width / level.height;
  const fittedHeight = Math.min(boxHeight, boxWidth / aspect);
  return fittedHeight * dpr;
}

/**
 * The level to load the FIRST fragment at, as an index into `levels`.
 *
 * Returns -1 when there is nothing to choose from, which is hls.js's own
 * "decide automatically" value.
 */
export function selectInitialLevel(
  levels: readonly LevelLike[],
  ctx: PlaybackDisplayContext,
): number {
  if (levels.length === 0) return -1;

  const ascending = levelsBySize(levels);
  if (prefersLowestLevel(ctx)) return ascending[0];

  // The larger of the windowed box and the fullscreen viewport: the player
  // goes fullscreen on play, so that is the size to be ready for.
  const windowedArea = ctx.playerWidth * ctx.playerHeight;
  const fullscreenArea = ctx.viewportWidth * ctx.viewportHeight;
  const [boxWidth, boxHeight] = fullscreenArea > windowedArea
    ? [ctx.viewportWidth, ctx.viewportHeight]
    : [ctx.playerWidth, ctx.playerHeight];

  // A zero-sized box (element not laid out yet) carries no information; let
  // hls.js pick rather than inventing a target from nothing.
  if (boxWidth <= 0 || boxHeight <= 0) return -1;

  const dpr = Math.min(
    Number.isFinite(ctx.devicePixelRatio) && ctx.devicePixelRatio > 0 ? ctx.devicePixelRatio : 1,
    MAX_USEFUL_DPR,
  );

  for (const index of ascending) {
    const level = levels[index];
    if (level.height >= requiredHeightFor(level, boxWidth, boxHeight, dpr)) {
      return index;
    }
  }
  // Nothing covers the display: the best available is the closest we get.
  return ascending[ascending.length - 1];
}

/** The display context of the running browser, for `selectInitialLevel`. */
export function readDisplayContext(element: HTMLVideoElement | null): PlaybackDisplayContext {
  const rect = element?.getBoundingClientRect();
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return {
    playerWidth: rect?.width ?? 0,
    playerHeight: rect?.height ?? 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
  };
}
