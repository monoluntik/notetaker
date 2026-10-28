import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useUserTz } from './api/hooks'
import { NoteEditorProvider, useOpenEditor } from './components/NoteEditor'
import { Realtime, useConnection } from './components/Realtime'
import { FeedbackProvider } from './components/ui/feedback'
import { Icon, type IconName } from './components/ui/Icon'
import { CalendarPage } from './pages/CalendarPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { TagsPage } from './pages/TagsPage'
import { TrashPage } from './pages/TrashPage'
import { UpcomingPage } from './pages/UpcomingPage'

const NAV: [string, string, IconName][] = [
  ['/', 'Предстоящие', 'sun'],
  ['/notes', 'Заметки', 'list'],
  ['/calendar', 'Календарь', 'calendar'],
  ['/tags', 'Теги', 'tag'],
  ['/trash', 'Корзина', 'trash'],
  ['/settings', 'Настройки', 'settings'],
]
// На телефоне 5 вкладок: корзина доступна со страницы «Заметки» и из настроек
const MOBILE_NAV = NAV.filter(([to]) => to !== '/trash')

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="Notetaker — на главную">
      <span className="brand-mark"><Icon name="note" /></span> Notetaker
    </NavLink>
  )
}

function Shell() {
  const tz = useUserTz()
  const open = useOpenEditor()
  const { online } = useConnection()
  const { pathname } = useLocation()
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setBrowserOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="app">
      <a href="#main" className="sr-only">Перейти к содержимому</a>
      <aside className="sidebar" aria-label="Основная навигация">
        <Brand />
        <button className="btn btn-primary btn-block" onClick={() => open({ kind: 'new' })}>
          <Icon name="plus" /> Новая заметка
        </button>
        <nav className="nav">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}><Icon name={icon} />{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="row" data-testid="connection" data-online={online}><span className={`status-dot ${online ? '' : 'off'}`} />{online ? 'Синхронизация включена' : 'Нет связи с сервером'}</span>
          <span className="row"><Icon name="globe" className="icon" />{tz}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Brand />
          <nav className="topbar-nav" aria-label="Основная навигация">
            {NAV.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/'} title={label}><Icon name={icon} /><span className="nav-label">{label}</span></NavLink>
            ))}
          </nav>
          <span className={`badge ${online ? 'badge-ok' : 'badge-err'}`} title={tz} data-testid="connection" data-online={online}>
            <span className={`status-dot ${online ? '' : 'off'}`} />{online ? 'онлайн' : 'офлайн'}
          </span>
          <button className="btn btn-primary btn-sm hide-mobile" onClick={() => open({ kind: 'new' })}><Icon name="plus" />Новая</button>
        </header>

        {(!browserOnline || !online) && (
          <div className="banner banner-warn offline-banner" role="status" style={{ borderRadius: 0 }}>
            <Icon name="wifiOff" />
            <div>Нет связи с сервером. Просмотр работает по последним загруженным данным; изменения сохранятся, когда связь восстановится — повторите действие.</div>
          </div>
        )}

        <main id="main" className="content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<UpcomingPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<p>Страница не найдена. <NavLink to="/">На главную</NavLink></p>} />
          </Routes>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Основная навигация">
        {MOBILE_NAV.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'}><Icon name={icon} />{label}</NavLink>
        ))}
      </nav>
      <button className="fab" aria-label="Новая заметка" onClick={() => open({ kind: 'new' })}><Icon name="plus" /></button>
    </div>
  )
}

export default function App() {
  return (
    <FeedbackProvider>
      <NoteEditorProvider>
        <Realtime>
          <Shell />
        </Realtime>
      </NoteEditorProvider>
    </FeedbackProvider>
  )
}
