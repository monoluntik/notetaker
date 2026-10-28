import { expect, test } from '@playwright/test'

test('changing user timezone changes displayed time but not the stored instant', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'e2e-tz' } })).json()
  const note = await (await request.post('/api/notes', { data: {
    title: 'Полночь UTC', start_at: '2026-11-20T23:30:00Z', tag_ids: [tag.id], reminders: [60],
  } })).json()

  await page.goto('/notes?q=Полночь')
  await expect(page.getByRole('button', { name: /Полночь UTC, 21 ноября 2026, 04:30/ })).toBeVisible() // UTC+5 — уже следующий день

  await page.goto('/settings')
  await page.getByRole('combobox', { name: 'Часовой пояс' }).fill('America/New_York')
  await expect(page.getByText(/Сейчас в этом поясе/)).toContainText('UTC-')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible()
  await expect(page.locator('.sidebar')).toContainText('America/New_York')

  await page.goto('/notes?q=Полночь')
  await expect(page.getByRole('button', { name: /Полночь UTC, 20 ноября 2026, 18:30/ })).toBeVisible() // UTC-5

  await page.goto('/calendar?view=month&date=2026-11-20')
  await expect(page.locator('[data-date="2026-11-20"] .cal-item')).toContainText('18:30')

  const after = await (await request.get(`/api/notes/${note.id}`)).json()
  expect(after.start_at).toBe('2026-11-20T23:30:00Z')
  expect(after.timezone).toBe('Asia/Almaty') // пояс серии не меняется от настроек пользователя
})
