const MAX_ACTIVE = 6;
let active = 0;
const waiters = [];

function release() {
  active = Math.max(0, active - 1);
  if (waiters.length && active < MAX_ACTIVE) {
    const next = waiters.shift();
    next();
  }
}

export function acquireWebGLSlot() {
  return new Promise((resolve) => {
    const grant = () => {
      active += 1;
      resolve(release);
    };
    if (active < MAX_ACTIVE) grant();
    else waiters.push(grant);
  });
}

export function getActiveWebGLCount() {
  return active;
}