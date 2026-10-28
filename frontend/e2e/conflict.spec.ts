import { expect, test } from '@playwright/test'
import { expectOnline } from './helpers'

test('editing the same note in two tabs: the later stale save is rejected with a clear message', async ({ context, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'e2e-conflict' } })).json()
  const note = await (await request.post('/api/notes', { data: {
    title: 'Общая заметка', start_at: '2026-12-01T05:00:00Z', tag_ids: [tag.id] } })).json()

  const a = await context.newPage()
  const b = await context.newPage()
  for (const p of [a, b]) {
    await p.goto('/notes?q=Общая')
    await expectOnline(p)
    await p.getByTestId('note-card').filter({ hasText: 'Общая заметка' }).getByRole('button', { name: /Общая заметка/ }).click()
  }
  await a.getByRole('dialog').getByLabel('Заголовок').fill('Правка из A')
  await a.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(a.getByRole('dialog')).toBeHidden()

  // Вкладка B узнаёт об изменении по WebSocket ещё до сохранения
  const bDialog = b.getByRole('dialog')
  await expect(bDialog.getByTestId('conflict-banner')).toContainText('изменили в другой вкладке')
  // B правит текст (A менял заголовок) и пытается сохранить устаревшую версию
  await bDialog.getByLabel('Текст').fill('Текст из B')
  await bDialog.getByRole('button', { name: 'Сохранить' }).click() // кнопка доступна: проверяем отказ сервера
  await expect(bDialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled() // сервер ответил 409
  await expect(bDialog).toContainText('Ваше сохранение не применено')
  expect((await (await request.get(`/api/notes/${note.id}`)).json()).title).toBe('Правка из A')

  // Правки B не потеряны: переносим их на актуальную версию
  await bDialog.getByRole('button', { name: 'Перенести мои правки на актуальную версию' }).click()
  await expect(bDialog.getByLabel('Заголовок')).toHaveValue('Правка из A')
  await expect(bDialog.getByLabel('Текст')).toHaveValue('Текст из B')
  await expect(bDialog.getByTestId('conflict-banner')).toHaveCount(0)
  await bDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(bDialog).toBeHidden()
  const final = await (await request.get(`/api/notes/${note.id}`)).json()
  expect([final.title, final.body]).toEqual(['Правка из A', 'Текст из B']) // обе правки сохранены
})

test('empty states distinguish "no notes" from "nothing found"', async ({ page }) => {
  await page.goto('/notes?q=такого-точно-нет-xyz')
  await expect(page.getByTestId('notes-empty')).toContainText('Ничего не найдено')
  await page.getByTestId('notes-empty').getByRole('button', { name: 'Сбросить фильтры' }).click()
  await expect(page.getByLabel('Поиск')).toHaveValue('')
})
