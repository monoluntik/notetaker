import { expect, test } from '@playwright/test'
import { expectOnline } from './helpers'

const WIDTHS = [360, 390, 768, 1024, 1440]
const PAGES = ['/', '/notes', '/calendar?view=month', '/calendar?view=week', '/calendar?view=day', '/tags', '/trash', '/settings']

test.beforeAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'Адаптивность-и-очень-длинное-название-тега', color: '#db2777' } })).json()
  const now = Date.now()
  for (let i = 0; i < 6; i++) {
    await request.post('/api/notes', { data: {
      title: `Очень длинный заголовок заметки номер ${i}, который не должен ломать вёрстку на узких экранах`,
      body: 'Длинный текст '.repeat(40), start_at: new Date(now + (i - 2) * 5 * 3600e3).toISOString(), tag_ids: [tag.id],
    } })
  }
})

for (const width of WIDTHS) {
  test(`no horizontal page scroll at ${width}px on any screen`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, timezoneId: 'Asia/Almaty', isMobile: width < 768, hasTouch: width < 768 })
    const page = await ctx.newPage()
    for (const url of PAGES) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${url} at ${width}px`).toBeLessThanOrEqual(0)
    }
    // Открытый редактор тоже помещается
    await page.goto('/notes')
    await page.getByRole('button', { name: /Новая/ }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    const box = await page.getByRole('dialog').boundingBox()
    expect(box!.width).toBeLessThanOrEqual(width)
    await ctx.close()
  })
}

test('phone: bottom navigation and creating a note with keyboard only', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Almaty', isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/notes')
  const bottom = page.locator('nav.bottom-nav')
  await expect(bottom).toBeVisible()
  await bottom.getByRole('link', { name: 'Календарь' }).click()
  await expect(page).toHaveURL(/\/calendar/)
  // Мобильный месяц: сетка с точками + повестка выбранного дня, а не уменьшенная десктопная сетка
  await expect(page.locator('.mcal-grid')).toBeVisible()
  await expect(page.locator('.cal-month')).toHaveCount(0)

  await page.getByRole('button', { name: 'Новая заметка', exact: true }).focus() // плавающая кнопка
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Заголовок')).toBeFocused()
  await page.keyboard.type('Создано с клавиатуры')
  await dialog.getByRole('button', { name: 'Адаптивность-и-очень-длинное-название-тега' }).press('Enter')
  await page.keyboard.press('Control+Enter') // сохранить
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('toasts')).toContainText('Заметка создана')
  // Фокус вернулся на кнопку, открывшую диалог
  await expect(page.getByRole('button', { name: 'Новая заметка', exact: true })).toBeFocused()
  await ctx.close()
})

test('dialog traps focus, Esc asks before discarding unsaved changes', async ({ page }) => {
  await page.goto('/notes')
  await expectOnline(page)
  await page.getByRole('button', { name: 'Новая заметка' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Заголовок').fill('Черновик')
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab')
  // После 40 нажатий Tab фокус всё ещё внутри диалога
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
  await page.keyboard.press('Escape')
  const confirm = page.getByRole('dialog', { name: 'Закрыть без сохранения?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(dialog.first().getByLabel('Заголовок')).toHaveValue('Черновик')
})

test('network error keeps the typed text and shows no fake success', async ({ page, request }) => {
  const tag = await (await request.post('/api/tags', { data: { name: 'Сеть' } })).json()
  const note = await (await request.post('/api/notes', { data: { title: 'Сетевая проверка', start_at: '2026-12-05T05:00:00Z', tag_ids: [tag.id] } })).json()
  await page.goto('/notes?q=Сетевая')
  await page.getByRole('button', { name: /Сетевая проверка/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Текст').fill('Важный текст, который нельзя потерять')
  await page.route(`**/api/notes/${note.id}`, (route) => route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue())
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Нет связи с сервером')
  await expect(dialog.getByLabel('Текст')).toHaveValue('Важный текст, который нельзя потерять')
  await expect(page.getByTestId('toasts')).not.toContainText('сохранена')
  // Связь вернулась — повторное сохранение проходит
  await page.unroute(`**/api/notes/${note.id}`)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('toasts')).toContainText('Заметка сохранена')
  expect((await (await request.get(`/api/notes/${note.id}`)).json()).body).toBe('Важный текст, который нельзя потерять')
})
