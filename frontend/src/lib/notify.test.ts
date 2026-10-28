import { describe, expect, it } from 'vitest'
import { claimOnceFallback, electLeader, pruneClaims } from './notify'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.get(k) ?? null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

/** Упрощённый LockManager: эксклюзивная блокировка с очередью, как в браузере. */
function fakeLocks(): LockManager {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    request: (_name: string, cb: () => Promise<unknown>) => {
      const run = tail.then(() => cb())
      tail = run.catch(() => {})
      return run
    },
  } as unknown as LockManager
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('leader election across tabs', () => {
  it('exactly one tab is leader; leadership passes on when the leader closes', async () => {
    const locks = fakeLocks()
    const tabs = [electLeader(locks), electLeader(locks), electLeader(locks)]
    await tick()
    expect(tabs.map((t) => t.isLeader())).toEqual([true, false, false])

    tabs[0].release() // первая вкладка закрыта
    await tick()
    await tick()
    expect(tabs.map((t) => t.isLeader())).toEqual([false, true, false])
  })

  it('without Web Locks nobody is leader (fallback is used instead)', () => {
    expect(electLeader(undefined).isLeader()).toBe(false)
  })
})

describe('fallback claim and pruning', () => {
  it('claims an id once', () => {
    const s = new MemStorage()
    expect([claimOnceFallback(1, s), claimOnceFallback(1, s), claimOnceFallback(2, s)]).toEqual([true, false, true])
  })

  it('prunes old claims', () => {
    const s = new MemStorage()
    s.setItem('notetaker:notified:1', String(Date.now() - 10 * 24 * 3600_000))
    s.setItem('notetaker:notified:2', String(Date.now()))
    pruneClaims(s)
    expect(s.getItem('notetaker:notified:1')).toBeNull()
    expect(s.getItem('notetaker:notified:2')).not.toBeNull()
  })
})
