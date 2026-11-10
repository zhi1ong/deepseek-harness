// @vitest-environment jsdom
/** Drawer swipe recognition on real DOM touch events. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachDrawerSwipe } from '../src/client/drawer-swipe.ts'

let surface: HTMLElement
let onToggle: ReturnType<typeof vi.fn<() => void>>
let dispose: (() => void) | undefined

function attach(open: boolean, claimTouchStart = false): void {
  dispose = attachDrawerSwipe({ surface, claimTouchStart, open, onToggle })
}

/** jsdom has no Touch constructor; TouchEvent keeps the supplied touch records. */
function touchEvent(
  type: string, points: { id: number; x: number; y: number }[], down: boolean, cancelable = true,
): TouchEvent {
  const touches = points.map(point => ({ identifier: point.id, clientX: point.x, clientY: point.y }) as Touch)
  const event = new TouchEvent(type, { bubbles: true, cancelable, changedTouches: touches, touches: down ? touches : [] })
  surface.dispatchEvent(event)
  return event
}

const start = (x: number, y = 100, id = 1) => touchEvent('touchstart', [{ id, x, y }], true)
const move = (x: number, y = 100, id = 1) => touchEvent('touchmove', [{ id, x, y }], true)
const end = (x: number, y = 100, id = 1) => touchEvent('touchend', [{ id, x, y }], false)

beforeEach(() => {
  surface = document.createElement('div')
  document.body.append(surface)
  onToggle = vi.fn<() => void>()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  surface.remove()
})

describe('drawer swipe', () => {
  it('toggles a closed drawer once a rightward swipe travels 24px, and only once per touch', () => {
    attach(false)
    start(5)
    move(28)
    expect(onToggle).not.toHaveBeenCalled()
    // Moves keep their default actions; the edge strip's touch-action already stops scrolling.
    expect(move(29).defaultPrevented).toBe(false)
    expect(onToggle).toHaveBeenCalledTimes(1)
    move(200)
    end(200)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('toggles an open drawer on a leftward swipe and ignores rightward travel', () => {
    attach(true)
    start(200)
    move(240)
    end(240)
    expect(onToggle).not.toHaveBeenCalled()
    start(200)
    move(176)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('leaves mostly vertical travel to scrolling for the rest of the touch', () => {
    attach(false)
    start(5, 100)
    move(20, 130)
    move(200, 130)
    end(200, 130)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('keeps tracking a touch that has not yet traveled 24px in either direction', () => {
    attach(false)
    start(30)
    move(10)
    move(55)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('stops tracking a touch that traveled 24px the wrong way', () => {
    attach(false)
    start(100)
    move(76)
    move(200)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('ignores touches that start with more than one finger, other touches, and ended touches', () => {
    attach(false)
    touchEvent('touchstart', [{ id: 1, x: 5, y: 100 }, { id: 2, x: 5, y: 300 }], true)
    move(100)
    start(5)
    move(100, 100, 2)
    end(5)
    move(100)
    start(5)
    touchEvent('touchcancel', [{ id: 1, x: 5, y: 100 }], false)
    move(100)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it.each([true, false])('prevents the default action of touch starts only when claiming them (%s)', (claim) => {
    attach(false, claim)
    expect(start(5).defaultPrevented).toBe(claim)
    expect(touchEvent('touchstart', [{ id: 2, x: 5, y: 100 }], true, false).defaultPrevented).toBe(false)
  })

  it('detaches on disposal', () => {
    attach(false)
    dispose?.()
    dispose = undefined
    start(5)
    move(100)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
