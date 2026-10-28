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

test('two independent browsers: stale occurrence edit and stale calendar drag are both rejected', async ({ browser, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'e2e-two-browsers' } })).json()
  const s = await (await request.post('/api/notes', { data: {
    title: 'Еженедельная встреча', start_at: '2026-12-07T04:00:00Z', timezone: 'Asia/Almaty', tag_ids: [tag.id],
    recurrence: { freq: 'weekly', until: '2026-12-28' } } })).json()
  // Два отдельных контекста = два разных браузера (без общего localStorage, cookies и WebSocket)
  const ctxA = await browser.newContext({ timezoneId: 'Asia/Almaty' })
  const ctxB = await browser.newContext({ timezoneId: 'Asia/Almaty' })
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  for (const p of [a, b]) {
    await p.goto('/calendar?view=month&date=2026-12-14')
    await expectOnline(p)
    await p.locator('[data-date="2026-12-14"] .cal-item').click()
    await p.getByRole('button', { name: /Только это вхождение/ }).click()
  }
  await a.getByRole('dialog').getByLabel('Заголовок').fill('Встреча перенесена (A)')
  await a.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(a.getByRole('dialog')).toBeHidden()

  const dB = b.getByRole('dialog')
  await expect(dB.getByTestId('conflict-banner')).toBeVisible() // B узнал об изменении без перезагрузки
  await dB.getByLabel('Текст').fill('Заметка из B')
  await dB.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dB.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  let occ = await (await request.get(`/api/notes/${s.id}/occurrences/2026-12-14T04:00:00Z`)).json()
  expect([occ.title, occ.body]).toEqual(['Встреча перенесена (A)', '']) // изменения A не перезаписаны
  await dB.getByRole('button', { name: 'Перенести мои правки на актуальную версию' }).click()
  await expect(dB.getByLabel('Заголовок')).toHaveValue('Встреча перенесена (A)')
  await dB.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dB).toBeHidden()
  occ = await (await request.get(`/api/notes/${s.id}/occurrences/2026-12-14T04:00:00Z`)).json()
  expect([occ.title, occ.body]).toEqual(['Встреча перенесена (A)', 'Заметка из B'])

  // Гонка: A меняет серию в тот момент, когда B перетаскивает вхождение по старым данным.
  // Чтобы гонка была воспроизводимой, B продолжает получать снимок календаря до изменения A.
  await b.goto('/calendar?view=month&date=2026-12-14')
  await expect(b.locator('[data-date="2026-12-21"] .cal-item')).toHaveCount(1)
  const staleSnapshot = await b.evaluate(async () => (await fetch(
    '/api/occurrences?from=2026-11-29T19:00:00Z&to=2027-01-10T19:00:00Z')).text())
  await b.route('**/api/occurrences?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: staleSnapshot }))
  const v = (await (await request.get(`/api/notes/${s.id}`)).json()).version
  await request.patch(`/api/notes/${s.id}`, { data: { body: 'изменено в браузере A', version: v } })
  await b.locator('[data-date="2026-12-21"] .cal-item').dragTo(b.locator('[data-date="2026-12-23"]'))
  await expect(b.getByTestId('toasts')).toContainText('изменили в другой вкладке')
  const occs = await (await request.get('/api/occurrences', { params: { from: '2026-12-20T00:00:00Z', to: '2026-12-25T00:00:00Z' } })).json()
  expect(occs.map((o: { start_at: string }) => o.start_at)).toEqual(['2026-12-21T04:00:00Z']) // перенос не применён
  await ctxA.close(); await ctxB.close()
})
