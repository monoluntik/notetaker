import { useQuery } from '@tanstack/react-query'
import { NavLink, Route, Routes } from 'react-router-dom'
import { api } from './api/client'

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
  return (
    <div className="layout">
      <header className="topbar">
        <strong>Notetaker</strong>
        <nav>
          <NavLink to="/">Предстоящие</NavLink>
          <NavLink to="/notes">Заметки</NavLink>
          <NavLink to="/calendar">Календарь</NavLink>
          <NavLink to="/tags">Теги</NavLink>
          <NavLink to="/trash">Корзина</NavLink>
          <NavLink to="/settings">Настройки</NavLink>
        </nav>
        <HealthBadge />
      </header>
      <main>
        <Routes>
          <Route path="*" element={<p>Раздел в разработке.</p>} />
        </Routes>
      </main>
    </div>
  )
}
