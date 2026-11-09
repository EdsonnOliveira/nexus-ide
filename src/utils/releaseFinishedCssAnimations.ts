const RELEASE_ANIMATION_NAMES = new Set([
  'app-button-in',
  'app-button-out',
  'home-dashboard-compact-chrome-in',
]);

function readAnimationName(animation: Animation): string | null {
  if ('animationName' in animation && typeof animation.animationName === 'string') {
    return animation.animationName;
  }

  return null;
}

export function releaseFinishedCssAnimations(): number {
  let released = 0;
  const animations =
    typeof document.getAnimations === 'function' ? document.getAnimations() : [];

  for (const animation of animations) {
    if (animation.playState !== 'finished') {
      continue;
    }

    const name = readAnimationName(animation);

    if (name && !RELEASE_ANIMATION_NAMES.has(name)) {
      continue;
    }

    animation.cancel();
    released += 1;
  }

  return released;
}

export function startFinishedCssAnimationWatch(): () => void {
  const onAnimationEnd = (event: AnimationEvent) => {
    if (!RELEASE_ANIMATION_NAMES.has(event.animationName)) {
      return;
    }

    const target = event.target;

    if (!(target instanceof Element) || typeof target.getAnimations !== 'function') {
      return;
    }

    for (const animation of target.getAnimations()) {
      if (animation.playState === 'finished') {
        animation.cancel();
      }
    }
  };

  document.addEventListener('animationend', onAnimationEnd, true);
  const intervalId = window.setInterval(() => {
    releaseFinishedCssAnimations();
  }, 15_000);

  releaseFinishedCssAnimations();

  return () => {
    document.removeEventListener('animationend', onAnimationEnd, true);
    window.clearInterval(intervalId);
  };
}
