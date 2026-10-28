import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api/client'
import { useUserTz } from './api/hooks'
import { NoteEditorProvider } from './components/NoteEditor'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { TagsPage } from './pages/TagsPage'
import { TrashPage } from './pages/TrashPage'

function HealthBadge() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string }>('/health'),
    refetchInterval: 30_000,
  })
  const ok = data?.status === 'ok' && !isError
  return <span className={`badge ${ok ? 'ok' : 'err'}`}>{ok ? 'сервер доступен' : 'нет связи с сервером'}</span>
}

export default function App() {
  const tz = useUserTz()
  return (
    <NoteEditorProvider>
      <div className="layout">
        <header className="topbar">
          <strong>Notetaker</strong>
          <nav>
            <NavLink to="/" end>Предстоящие</NavLink>
            <NavLink to="/notes">Заметки</NavLink>
            <NavLink to="/calendar">Календарь</NavLink>
            <NavLink to="/tags">Теги</NavLink>
            <NavLink to="/trash">Корзина</NavLink>
            <NavLink to="/settings">Настройки</NavLink>
          </nav>
          <span className="muted small">{tz}</span>
          <HealthBadge />
        </header>
        <main>
          <Routes>
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/" element={<Navigate to="/notes" replace />} />
            <Route path="*" element={<p>Раздел в разработке.</p>} />
          </Routes>
        </main>
      </div>
    </NoteEditorProvider>
  )
}
