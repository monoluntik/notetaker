import { expect, type Page } from '@playwright/test'

/** Вкладка подключена к WebSocket (статус в боковой или верхней панели — что видно на этой ширине). */
export async function expectOnline(page: Page) {
  await expect(page.locator('[data-testid="connection"][data-online="true"]:visible')).toBeVisible()
}

/** Заполнить дату/время в форме заметки (поля в поясе пользователя). */
export async function fillWhen(page: Page, date: string, time: string) {
  const d = page.getByRole('dialog')
  await d.getByLabel('Дата', { exact: true }).fill(date)
  await d.getByLabel(/^Время/).fill(time)
}
