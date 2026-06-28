/** Persisted JPEG snapshots — one HD capture reused across gallery, timeline, and detail. */
export const THUMB_CAPTURE_SIZE = 512;
export const THUMB_TIME = 1.25;
export const THUMB_QUALITY = 0.88;

/** Bump when capture format/size changes — triggers one-time gallery re-backfill. */
export const THUMB_CAPTURE_VERSION = 2;

/** Older 96px captures are tiny on disk; upgrade when detail view opens. */
export const THUMB_LEGACY_MAX_CHARS = 32000;

export function galleryThumbMigrationKey() {
  return `shadermind_thumb_v${THUMB_CAPTURE_VERSION}`;
}