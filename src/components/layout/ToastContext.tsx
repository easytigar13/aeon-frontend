'use client'
import React, { createContext, useContext, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2, ExternalLink, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'pending'

export interface ToastItem {
  id: string
  type: ToastType
  title: string
  message?: string
  txHash?: string
  duration?: number
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>) => string
  dismissToast: (id: string) => void
  updateToast: (id: string, update: Partial<Omit<ToastItem, 'id'>>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const updateToast = useCallback((id: string, update: Partial<Omit<ToastItem, 'id'>>) => {
    setToasts(prev =>
      prev.map(t => {
        if (t.id !== id) return t
        const updated = { ...t, ...update }
        if (update.type && update.type !== 'pending' && !update.duration) {
          // Auto dismiss after 6 seconds when updated to finished state
          setTimeout(() => {
            setToasts(current => current.filter(item => item.id !== id))
          }, 6000)
        }
        return updated
      })
    )
  }, [])

  const showToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newItem: ToastItem = { ...toast, id }
    
    setToasts(prev => [...prev.slice(-4), newItem]) // Keep maximum 5 toasts

    const autoDuration = toast.duration ?? (toast.type === 'pending' ? 0 : 5000)
    if (autoDuration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, autoDuration)
    }

    return id
  }, [])

  return (
    <ToastContext.Provider value={{ showToast, dismissToast, updateToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
              layout
              className="pointer-events-auto bg-[#0E131F]/95 backdrop-blur-md border border-[#1E293B] shadow-[0_10px_35px_-5px_rgba(0,0,0,0.8)] rounded-xl p-3.5 text-white flex items-start gap-3 relative overflow-hidden"
              style={{
                borderColor:
                  toast.type === 'success'
                    ? 'rgba(16,185,129,0.4)'
                    : toast.type === 'error'
                    ? 'rgba(239,68,68,0.4)'
                    : toast.type === 'pending'
                    ? 'rgba(56,189,248,0.4)'
                    : 'rgba(255,184,0,0.4)',
              }}
            >
              {/* Glow indicator line */}
              <div
                className="absolute top-0 left-0 bottom-0 w-1"
                style={{
                  backgroundColor:
                    toast.type === 'success'
                      ? '#10B981'
                      : toast.type === 'error'
                      ? '#EF4444'
                      : toast.type === 'pending'
                      ? '#38BDF8'
                      : '#FFB800',
                }}
              />

              {/* Icon */}
              <div className="shrink-0 mt-0.5">
                {toast.type === 'pending' && <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />}
                {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {toast.type === 'error' && <XCircle className="w-5 h-5 text-red-400" />}
                {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                {toast.type === 'info' && <Info className="w-5 h-5 text-sky-400" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pr-2">
                <div className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                  {toast.title}
                </div>
                {toast.message && (
                  <p className="text-xs text-slate-400 mt-0.5 break-words leading-relaxed">
                    {toast.message}
                  </p>
                )}
                {toast.txHash && (
                  <a
                    href={`https://explorer.robinhood.com/tx/${toast.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-2xs font-mono text-sky-400 hover:text-sky-300 mt-1.5 group underline decoration-sky-400/40"
                  >
                    <span>View on Explorer</span>
                    <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                )}
              </div>

              {/* Dismiss button */}
              <button
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 text-slate-500 hover:text-slate-300 p-1 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
