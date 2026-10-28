import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { keys, useSettings } from '../api/hooks'
import type { UserSettings } from '../api/types'
import { useToast } from '../components/ui/feedback'
import { Icon, type IconName } from '../components/ui/Icon'
import { ErrorState, SkeletonList, Spinner } from '../components/ui/states'

export function SettingsPage() {
  const { data, error, refetch } = useSettings()
  return (
    <>
      <div className="page-head"><div><h1>Настройки</h1><p className="lead">Email для напоминаний и часовой пояс отображения.</p></div></div>
      {error && !data ? <div className="card"><ErrorState error={error} onRetry={() => refetch()} /></div>
        // Форма создаётся один раз после загрузки, чтобы сообщение о сохранении не пропадало
        : data ? <SettingsForm initial={data} /> : <SkeletonList rows={3} height={140} />}
    </>
  )
}

function Section({ icon, title, desc, children }: { icon: IconName; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="card settings-section" aria-label={title}>
      <header>
        <span className="icon-box"><Icon name={icon} /></span>
        <div><h2>{title}</h2><p>{desc}</p></div>
      </header>
      {children}
    </section>
  )
}

function SettingsForm({ initial }: { initial: UserSettings }) {
  const qc = useQueryClient()
  const toast = useToast()
  const listId = useId()
  const { data: zones = [] } = useQuery({ queryKey: ['timezones'], queryFn: () => api<string[]>('/timezones'), staleTime: Infinity })
  const [email, setEmail] = useState(initial.email ?? '')
  const [tz, setTz] = useState(initial.timezone)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: (v: Partial<UserSettings>) => api<UserSettings>('/settings', { method: 'PATCH', body: JSON.stringify(v) }),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data)
      qc.invalidateQueries({ queryKey: keys.notes })
    },
  })
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzValid = zones.length === 0 || zones.includes(tz)
  const dirty = email !== (initial.email ?? '') || tz !== initial.timezone

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    if (!tzValid) { setError('Выберите часовой пояс из списка, например Europe/Moscow'); return }
    setError(null)
    try {
      await save.mutateAsync({ email, timezone: tz })
      setSaved(true)
      toast('Настройки сохранены')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const now = DateTime.now()
  return (
    <form className="settings-grid" onSubmit={submit} noValidate>
      <Section icon="mail" title="Напоминания по email" desc="Письма приходят за 10 минут, 1 час или 1 день до активной заметки.">
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" autoComplete="email" value={email} placeholder="you@example.com"
            onChange={(e) => { setEmail(e.target.value); setSaved(false) }} />
          <span className="field-hint">Оставьте пустым, чтобы получать только уведомления в приложении.</span>
        </label>
        <NotificationPermission />
      </Section>

      <Section icon="globe" title="Часовой пояс" desc="Влияет только на отображение. Моменты заметок и уже запланированных напоминаний не сдвигаются.">
        <label className="field">
          <span className="field-label">Часовой пояс</span>
          <input className="input" list={listId} value={tz} aria-invalid={!tzValid} placeholder="Начните вводить, например Moscow"
            onChange={(e) => { setTz(e.target.value); setSaved(false) }} aria-label="Часовой пояс" />
          <datalist id={listId}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
          {!tzValid && <span className="field-error">Такого часового пояса нет в списке</span>}
        </label>
        {tzValid && (
          <div className="tz-preview">
            Сейчас в этом поясе: <strong>{now.setZone(tz).setLocale('ru').toFormat('d MMMM, HH:mm')}</strong>
            {' '}(UTC{now.setZone(tz).toFormat('ZZ')})
          </div>
        )}
        {browserTz !== tz && (
          <div><button type="button" className="btn btn-sm" onClick={() => setTz(browserTz)}>Использовать пояс устройства ({browserTz})</button></div>
        )}
      </Section>

      <Section icon="trash" title="Корзина" desc={`Удалённые заметки хранятся ${initial.trash_retention_days ?? 30} дней, затем удаляются навсегда автоматически.`}>
        <div><Link to="/trash" className="btn btn-sm">Открыть корзину</Link></div>
      </Section>

      {error && <div className="banner banner-error" role="alert"><Icon name="alert" /><div>{error}</div></div>}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={save.isPending || !dirty}>
          {save.isPending && <Spinner label="Сохранение" />}Сохранить
        </button>
        {saved && !dirty && <span className="row small" style={{ color: 'var(--success)' }} role="status"><Icon name="check" />Сохранено</span>}
      </div>
    </form>
  )
}

function NotificationPermission() {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied')
  if (!supported) return <p className="field-hint">Браузер не поддерживает системные уведомления; напоминания будут видны внутри приложения.</p>
  const text = perm === 'granted' ? 'разрешены' : perm === 'denied' ? 'запрещены в настройках браузера' : 'не запрошены'
  return (
    <div className="row wrap small">
      <span>Уведомления браузера: <strong>{text}</strong></span>
      {perm === 'default' && (
        <button type="button" className="btn btn-sm" onClick={() => Notification.requestPermission().then(setPerm)}>Разрешить</button>
      )}
    </div>
  )
}
