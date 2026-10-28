import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { keys, useSettings } from '../api/hooks'
import type { UserSettings } from '../api/types'

export function SettingsPage() {
  const { data } = useSettings()
  return data ? <SettingsForm key={JSON.stringify(data)} initial={data} /> : <p>Загрузка…</p>
}

function SettingsForm({ initial }: { initial: UserSettings }) {
  const qc = useQueryClient()
  const { data: zones = [] } = useQuery({ queryKey: ['timezones'], queryFn: () => api<string[]>('/timezones'), staleTime: Infinity })
  const [email, setEmail] = useState(initial.email ?? '')
  const [tz, setTz] = useState(initial.timezone)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const save = useMutation({
    mutationFn: (v: Partial<UserSettings>) => api<UserSettings>('/settings', { method: 'PATCH', body: JSON.stringify(v) }),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data)
      qc.invalidateQueries({ queryKey: keys.notes })
    },
  })
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await save.mutateAsync({ email, timezone: tz })
      setMsg({ ok: true, text: 'Сохранено' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
  }

  return (
    <section>
      <h1>Настройки</h1>
      <form className="form narrow" onSubmit={submit}>
        <label>Email для напоминаний<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>
          Часовой пояс
          <select value={tz} onChange={(e) => setTz(e.target.value)}>
            {(zones.length ? zones : [tz]).map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        {browserTz !== tz && <button type="button" onClick={() => setTz(browserTz)}>Использовать пояс браузера ({browserTz})</button>}
        <p className="muted small">
          Смена пояса меняет только отображение времени. Моменты заметок и уже запланированных напоминаний не сдвигаются.
        </p>
        <NotificationPermission />
        {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}
        <div className="actions"><button className="primary" type="submit">Сохранить</button></div>
      </form>
    </section>
  )
}

function NotificationPermission() {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied')
  if (!supported) return <p className="muted small">Браузер не поддерживает системные уведомления; напоминания будут видны внутри приложения.</p>
  return (
    <div className="field">
      <span>Уведомления браузера: <strong>{perm === 'granted' ? 'разрешены' : perm === 'denied' ? 'запрещены' : 'не запрошены'}</strong></span>
      {perm === 'default' && (
        <button type="button" onClick={() => Notification.requestPermission().then(setPerm)}>Разрешить уведомления</button>
      )}
    </div>
  )
}
