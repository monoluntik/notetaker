import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

/* ---------- Подтверждения (вместо window.confirm) ---------- */
interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<ConfirmFn>(async () => false)
// eslint-disable-next-line react-refresh/only-export-components
export const useConfirm = () => useContext(ConfirmContext)

/* ---------- Тосты ---------- */
interface Toast { id: number; text: string; kind: 'success' | 'error'; action?: { label: string; run: () => void } }
type ToastFn = (text: string, kind?: Toast['kind'], action?: Toast['action']) => void
const ToastContext = createContext<ToastFn>(() => {})
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setConfirmState({ ...o, resolve })), [])
  const close = (v: boolean) => { confirmState?.resolve(v); setConfirmState(null) }

  const toast = useCallback<ToastFn>((text, kind = 'success', action) => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, text, kind, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      <ToastContext.Provider value={toast}>
        {children}
        {confirmState && (
          <Dialog size="sm" title={confirmState.title} onClose={() => close(false)} initialFocus="[data-autofocus]"
            footer={<>
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => close(false)} data-autofocus>{confirmState.cancelLabel ?? 'Отмена'}</button>
              <button type="button" className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
                {confirmState.confirmLabel ?? 'Подтвердить'}
              </button>
            </>}>
            {confirmState.message && <div className="muted">{confirmState.message}</div>}
          </Dialog>
        )}
        <div className="toasts" aria-live="polite" role="status" data-testid="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}>
              <Icon name={t.kind === 'error' ? 'alert' : 'check'} />
              <span className="spacer">{t.text}</span>
              {t.action && <button className="btn btn-ghost btn-sm" onClick={t.action.run}>{t.action.label}</button>}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </ConfirmContext.Provider>
  )
}
