import { expect, test } from '@playwright/test'
import { fillWhen } from './helpers'

test.beforeEach(async ({ request }) => {
  // Пояс пользователя = поясу браузера в тестах
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty', email: null } })
})

test('create tag and note via UI, find it, see it in calendar, move it by drag and drop', async ({ page, request }) => {
  await page.goto('/tags')
  await page.getByPlaceholder('Например, «Работа»').fill('Работа')
  await page.getByRole('button', { name: 'Создать тег' }).click()
  await expect(page.getByTestId('toasts')).toContainText('Тег «Работа» создан')
  // В общей e2e-БД могут быть теги из других тестов — ищем среди всех полей названия
  await expect.poll(() => page.getByRole('textbox', { name: 'Название' })
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toContain('Работа')

  await page.goto('/notes')
  await page.getByRole('button', { name: 'Новая заметка' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Заголовок').fill('Созвон с командой')
  await dialog.getByLabel('Текст').fill('обсудить релиз')
  await fillWhen(page, '2026-11-10', '15:30')
  await dialog.getByRole('button', { name: 'Работа' }).click()
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('toasts')).toContainText('Заметка создана') // только после ответа сервера

  // Серверный поиск по тексту
  await page.getByLabel('Поиск').fill('релиз')
  const card = page.getByTestId('note-card')
  await expect(card).toHaveCount(1)
  await expect(card.getByRole('button', { name: /Созвон с командой, 10 ноября 2026, 15:30/ })).toBeVisible()

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
  await expect(page.getByTestId('toasts')).toContainText('уже есть вхождение')
})
