/**
 * Touch swipe that toggles the narrow-frame sidebar drawer. Once a touch
 * travels far enough horizontally toward the opposite state, the swipe calls
 * `onToggle` the same way the reopen control or a mask tap does, and the
 * drawer plays its regular open or close transition (AppFrame.module.css).
 * The drawer does not follow the finger: per-frame transform writes during a
 * drag made iOS Safari present an earlier drawer position for one frame after
 * release.
 */

/** Horizontal travel in px that recognizes a swipe; smaller travel is left to taps and scrolling. */
const SWIPE_DISTANCE = 24

/** Surface and state for one attached drawer swipe. */
export interface DrawerSwipeOptions {
  /** Element whose touches are recognized. */
  surface: HTMLElement
  /**
   * Prevent the default action of every touch that starts on `surface`, which
   * makes its `touchstart` listener non-passive. This withholds those touches
   * from platform edge navigation and suppresses their emulated clicks.
   */
  claimTouchStart: boolean
  /** Drawer state while attached: an open drawer recognizes leftward swipes, a closed one rightward. */
  open: boolean
  /** Called once per recognized swipe. Its update replaces this attachment. */
  onToggle: () => void
}

/**
 * Attach the drawer swipe to `surface`. Only a single-finger touch is
 * recognized; mostly vertical travel leaves the touch to scrolling.
 * @param options - gesture surface, attached state, and the toggle callback.
 * @returns the disposer, which removes the listeners.
 */
export function attachDrawerSwipe(options: DrawerSwipeOptions): () => void {
  const { surface, claimTouchStart, open } = options
  let touch: { id: number; x: number; y: number } | null = null

  const onTouchStart = (event: TouchEvent): void => {
    if (claimTouchStart && event.cancelable) event.preventDefault()
    const touches = Array.from(event.touches)
    const started = touches.length === 1 ? touches[0] : undefined
    touch = started === undefined ? null : { id: started.identifier, x: started.clientX, y: started.clientY }
  }

  const onTouchMove = (event: TouchEvent): void => {
    const current = Array.from(event.changedTouches).find(candidate => candidate.identifier === touch?.id)
    if (touch === null || current === undefined) return
    const dx = current.clientX - touch.x
    const dy = current.clientY - touch.y
    // Vertical travel is scrolling; a swipe heads toward the opposite state.
    if (Math.abs(dy) > Math.abs(dx) || (dx > 0) === open) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_DISTANCE) touch = null
      return
    }
    if (Math.abs(dx) < SWIPE_DISTANCE) return
    touch = null
    options.onToggle()
  }

  const onTouchEnd = (): void => { touch = null }

  surface.addEventListener('touchstart', onTouchStart, { passive: !claimTouchStart })
  surface.addEventListener('touchmove', onTouchMove, { passive: true })
  surface.addEventListener('touchend', onTouchEnd)
  surface.addEventListener('touchcancel', onTouchEnd)
  return () => {
    surface.removeEventListener('touchstart', onTouchStart)
    surface.removeEventListener('touchmove', onTouchMove)
    surface.removeEventListener('touchend', onTouchEnd)
    surface.removeEventListener('touchcancel', onTouchEnd)
  }
}
