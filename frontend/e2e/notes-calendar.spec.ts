import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  // Пояс пользователя = поясу браузера в тестах
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty', email: null } })
})

test('create tag and note via UI, find it, see it in calendar, move it by drag and drop', async ({ page, request }) => {
  await page.goto('/tags')
  await page.getByPlaceholder('Название тега').fill('Работа')
  await page.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.getByRole('textbox', { name: 'Название' })).toHaveValue('Работа')

  await page.goto('/notes')
  await page.getByRole('button', { name: '+ Новая заметка' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Заголовок').fill('Созвон с командой')
  await dialog.getByLabel('Текст').fill('обсудить релиз')
  await dialog.getByLabel(/Дата и время/).fill('2026-11-10T15:30')
  await dialog.getByRole('button', { name: 'Работа' }).click()
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()

  // Серверный поиск по тексту
  await page.getByLabel('Поиск').fill('релиз')
  await expect(page.locator('.note-row')).toHaveCount(1)
  await expect(page.locator('.note-row')).toContainText('10 нояб. 2026, 15:30')

  // Хранится в UTC: 15:30 Алматы (UTC+5) = 10:30Z
  const list = await (await request.get('/api/notes')).json()
  expect(list.items[0].start_at).toBe('2026-11-10T10:30:00Z')

  await page.goto('/calendar?view=month&date=2026-11-10')
  const item = page.locator('[data-date="2026-11-10"] .cal-item')
  await expect(item).toContainText('15:30')
  await item.dragTo(page.locator('[data-date="2026-11-12"]'))
  await expect(page.locator('[data-date="2026-11-12"] .cal-item')).toContainText('Созвон с командой')
  await expect(page.locator('[data-date="2026-11-10"] .cal-item')).toHaveCount(0)
  const moved = await (await request.get('/api/notes')).json()
  expect(moved.items[0].start_at).toBe('2026-11-12T10:30:00Z') // дата сменилась, время сохранилось

  // Клик открывает заметку
  await page.locator('[data-date="2026-11-12"] .cal-item').click()
  await expect(page.getByRole('dialog').getByLabel('Заголовок')).toHaveValue('Созвон с командой')
})

test('recurring occurrence: drag moves only that occurrence; drop onto a day with another occurrence is rejected', async ({ page, request }) => {
  const tag = await (await request.post('/api/tags', { data: { name: 'Серии' } })).json()
  await request.post('/api/notes', { data: {
    title: 'Зарядка', start_at: '2026-11-02T02:00:00Z', timezone: 'Asia/Almaty', tag_ids: [tag.id],
    recurrence: { freq: 'weekly', until: '2026-11-30' },
  } })
  await page.goto('/calendar?view=month&date=2026-11-10')
  await expect(page.locator('.cal-item', { hasText: 'Зарядка' })).toHaveCount(5)

  await page.locator('[data-date="2026-11-09"] .cal-item').dragTo(page.locator('[data-date="2026-11-11"]'))
  await expect(page.locator('[data-date="2026-11-11"] .cal-item')).toContainText('Зарядка')
  await expect(page.locator('.cal-item', { hasText: 'Зарядка' })).toHaveCount(5)

  await page.locator('[data-date="2026-11-11"] .cal-item').dragTo(page.locator('[data-date="2026-11-16"]'))
  await expect(page.getByRole('alert')).toContainText('уже есть вхождение')
})
