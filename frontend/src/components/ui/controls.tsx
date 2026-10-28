import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Switch({ checked, onChange, label, disabled, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
      <span className="stack" style={{ gap: 0 }}>
        <span>{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

/** Кнопка-переключатель в виде «пилюли» (теги, напоминания). */
export function TogglePill({ pressed, onClick, children, color }: {
  pressed: boolean; onClick: () => void; children: ReactNode; color?: string
}) {
  return (
    <button type="button" className="pill" aria-pressed={pressed} onClick={onClick}>
      {pressed ? <Icon name="check" /> : color ? <span className="chip-dot" style={{ background: color }} /> : null}
      <span>{children}</span>
    </button>
  )
}

export function TagBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="chip" style={{ background: `${color}1f`, color: darken(color) }} title={name}>
      <span className="chip-dot" style={{ background: color }} />
      {name}
    </span>
  )
}

/** Темнее исходного цвета — чтобы текст тега был читаем на светлом фоне. */
function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.round(v * 0.62)
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
}
