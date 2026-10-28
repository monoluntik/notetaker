import type { Tag } from '../api/types'

export function TagChip({ tag, selected, onClick }: { tag: Tag; selected?: boolean; onClick?: () => void }) {
  const style = selected === false
    ? { borderColor: tag.color, color: tag.color, background: 'transparent' }
    : { background: tag.color, borderColor: tag.color, color: '#fff' }
  return onClick ? (
    <button type="button" className="chip" style={style} onClick={onClick} aria-pressed={selected}>
      {tag.name}
    </button>
  ) : (
    <span className="chip" style={style}>{tag.name}</span>
  )
}
