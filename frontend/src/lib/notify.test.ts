import { describe, expect, it } from 'vitest'
import { claimOnce, pruneClaims } from './notify'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.get(k) ?? null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, v) }
}
// Хранилище общее для «вкладок» в рамках теста (как localStorage одного origin)
const localStorage = new MemStorage()

describe('claimOnce', () => {
  it('only the first of several concurrent tabs gets to show the notification', async () => {
    localStorage.clear()
    // Без Web Locks (jsdom) — проверяем саму логику метки
    const results = await Promise.all([1, 2, 3].map(() => claimOnce(42, localStorage, undefined)))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await claimOnce(43, localStorage, undefined)).toBe(true)
  })

  it('serialises through Web Locks when available', async () => {
    localStorage.clear()
    let chain = Promise.resolve<unknown>(undefined)
    const fakeLocks = {
      request: (_name: string, cb: () => Promise<boolean>) => {
        const p = chain.then(cb)
        chain = p
        return p
      },
    } as unknown as LockManager
    const results = await Promise.all([claimOnce(7, localStorage, fakeLocks), claimOnce(7, localStorage, fakeLocks)])
    expect(results).toEqual([true, false])
  })

  it('prunes old claims', () => {
    localStorage.clear()
    localStorage.setItem('notetaker:notified:1', String(Date.now() - 10 * 24 * 3600_000))
    localStorage.setItem('notetaker:notified:2', String(Date.now()))
    pruneClaims(localStorage)
    expect(localStorage.getItem('notetaker:notified:1')).toBeNull()
    expect(localStorage.getItem('notetaker:notified:2')).not.toBeNull()
  })
})
