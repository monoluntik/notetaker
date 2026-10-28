import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, isEditConflict, isNetworkError } from './client'

describe('api client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('formats FastAPI validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: [{ loc: ['body', 'title'], msg: 'Field required' }] }),
      { status: 422 },
    )))
    await expect(api('/notes')).rejects.toMatchObject({ status: 422, message: 'Заголовок: Field required' })
    await expect(api('/notes')).rejects.toBeInstanceOf(ApiError)
  })

  it('turns a failed fetch into a network ApiError (status 0) instead of a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const err = (await api('/notes').catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(isNetworkError(err)).toBe(true)
    expect(err.message).toMatch(/не сохранены/)
  })

  it('recognises an edit conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Заметку уже изменили в другой вкладке' }), { status: 409 })))
    const err = await api('/notes/1').catch((e: ApiError) => e)
    expect(isEditConflict(err)).toBe(true)
  })
})
