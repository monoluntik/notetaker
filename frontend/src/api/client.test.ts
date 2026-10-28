import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'

describe('api client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('formats FastAPI validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: [{ loc: ['body', 'title'], msg: 'Field required' }] }),
      { status: 422 },
    )))
    await expect(api('/notes')).rejects.toMatchObject({ status: 422, message: 'title: Field required' })
    await expect(api('/notes')).rejects.toBeInstanceOf(ApiError)
  })
})
