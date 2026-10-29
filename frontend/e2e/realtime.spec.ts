import { expect, test, type Page } from '@playwright/test'
import { expectOnline } from './helpers'

// Заглушка системных уведомлений: считаем вызовы в каждой вкладке
const stubNotification = () => {
  const calls: string[] = []
  ;(window as unknown as { __notifications: string[] }).__notifications = calls
  class FakeNotification {
    static permission = 'granted'
    static requestPermission = async () => 'granted'
    constructor(title: string) { calls.push(title) }
  }
  ;(window as unknown as { Notification: unknown }).Notification = FakeNotification
}

const notifCount = (p: Page) => p.evaluate(() => (window as unknown as { __notifications: string[] }).__notifications.length)

test('two tabs: data sync, one reminder shown in both tabs, single system notification, read state syncs', async ({ context, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty', email: 'me@example.com' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'e2e-rt' } })).json()
  await context.addInitScript(stubNotification)

  const tab1 = await context.newPage()
  const tab2 = await context.newPage()
  await tab1.goto('/notes')
  await tab2.goto('/notes')
  await expectOnline(tab1)
  await expectOnline(tab2)

  // Создание во вкладке 1 появляется во вкладке 2 без перезагрузки
  await tab1.getByRole('button', { name: 'Новая заметка' }).click()
  await tab1.getByRole('dialog').getByLabel('Заголовок').fill('Синхронизация вкладок')
  await tab1.getByRole('dialog').getByRole('button', { name: 'e2e-rt' }).click()
  await tab1.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()
  await expect(tab2.getByTestId('note-card').filter({ hasText: 'Синхронизация вкладок' })).toBeVisible()

  // Заметка через 10 минут + 4 секунды с напоминанием «за 10 минут» → сработает через ~4 с
  const start = new Date(Date.now() + 10 * 60_000 + 4_000)
  start.setMilliseconds(0)
  await request.post('/api/notes', { data: {
    title: 'Напомни мне', start_at: start.toISOString(), tag_ids: [tag.id], reminders: [10],
  } })

  const toast1 = tab1.getByTestId('reminder-toast').filter({ hasText: 'Напомни мне' })
  const toast2 = tab2.getByTestId('reminder-toast').filter({ hasText: 'Напомни мне' })
  await expect(toast1).toBeVisible({ timeout: 15_000 })
  await expect(toast2).toBeVisible()
  await tab1.waitForTimeout(1500) // даём второй вкладке шанс (ошибочно) показать уведомление
  expect((await notifCount(tab1)) + (await notifCount(tab2))).toBe(1)

  // Требование: однажды показанное не всплывает снова после обновления страницы
  await tab2.reload()
  await expectOnline(tab2)
  await tab2.waitForTimeout(1500)
  await expect(toast2).toHaveCount(0)
  expect(await notifCount(tab2)).toBe(0) // и системное уведомление после перезагрузки не повторяется

  await toast1.getByRole('button', { name: 'Прочитано' }).click()
  await expect(toast1).toBeHidden()

  // Новая вкладка, открытая после прочтения, уведомление не показывает (прочитано на сервере)
  const tab3 = await context.newPage()
  await tab3.goto('/notes')
  await expectOnline(tab3)
  await expect(tab3.getByTestId('reminder-toast')).toHaveCount(0)
})

test('upcoming: a note moves to overdue without page reload', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'e2e-up' } })).json()
  await page.clock.install()
  const start = new Date(Date.now() + 60_000)
  await request.post('/api/notes', { data: { title: 'Скоро начнётся', start_at: start.toISOString(), tag_ids: [tag.id] } })
  await page.goto('/')
  const today = page.getByTestId('section-Сегодня')
  const overdue = page.getByTestId('section-Прошедшие активные')
  await expect(today.getByText('Скоро начнётся')).toBeVisible()
  await expect(overdue.getByText('Скоро начнётся')).toHaveCount(0)
  await page.clock.fastForward('01:30') // клиентские часы +90 с; страница не перезагружается
  await expect(overdue.getByText('Скоро начнётся')).toBeVisible()
  await expect(today.getByText('Скоро начнётся')).toHaveCount(0)
})

test('calendar and upcoming in another tab update without reload', async ({ context, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  const tag = await (await request.post('/api/tags', { data: { name: 'e2e-sync-views' } })).json()
  const cal = await context.newPage()
  const up = await context.newPage()
  const start = new Date(Date.now() + 3 * 3600e3)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(start) // yyyy-mm-dd
  await cal.goto(`/calendar?view=day&date=${day}`)
  await up.goto('/')
  await expectOnline(cal)
  await expectOnline(up)
  // Изменение «из другого клиента» (через API) — обе вкладки обновляются по WebSocket
  await request.post('/api/notes', { data: { title: 'Синхронизация видов', start_at: start.toISOString(), tag_ids: [tag.id] } })
  await expect(cal.locator('.cal-item', { hasText: 'Синхронизация видов' })).toBeVisible()
  await expect(up.getByText('Синхронизация видов')).toBeVisible()
})

test('many reminders: at most three cards, the rest behind "more", page stays usable', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { timezone: 'Asia/Almaty' } })
  // Непрочитанные напоминания предыдущих сценариев не мешают подсчёту
  const old = await (await request.get('/api/notifications')).json()
  if (old.length) await request.post('/api/notifications/read', { data: { ids: old.map((n: { id: number }) => n.id) } })

  await page.goto('/notes')
  await expectOnline(page)
  const start = new Date(Date.now() + 10 * 60_000 + 4_000)
  start.setMilliseconds(0)
  for (let i = 1; i <= 5; i++) {
    await request.post('/api/notes', { data: { title: `Стопка ${i}`, start_at: start.toISOString(), reminders: [10] } })
  }

  const more = page.getByTestId('reminder-toasts-more')
  await expect(more).toHaveText('Ещё 2', { timeout: 15_000 })
  await expect(page.getByTestId('reminder-toast')).toHaveCount(3)
  // Текст — реальный остаток до начала (меньше 10 минут), а не интервал напоминания
  await expect(page.getByTestId('reminder-toast').first()).toContainText(/через \d+ минут|меньше чем через минуту/)
  // Карточки не перекрывают кнопку создания заметки
  await page.getByRole('button', { name: 'Новая заметка' }).click({ trial: true, timeout: 2_000 })

  await more.click()
  await expect(page.getByTestId('reminder-toast')).toHaveCount(5)
  await page.getByRole('button', { name: 'Скрыть все (5)' }).click()
  await expect(page.getByTestId('reminder-toast')).toHaveCount(0)
})
