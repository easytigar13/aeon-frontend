'use client'
import { useState, useEffect, useCallback } from 'react'

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

export function useSoundEffects() {
  const [muted, setMuted] = useState<boolean>(true) // default to muted for unobtrusiveness

  useEffect(() => {
    try {
      const stored = localStorage.getItem('aeon_sound_muted')
      if (stored !== null) {
        setMuted(stored === 'true')
      }
    } catch {}
  }, [])

  const toggleSound = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      try {
        localStorage.setItem('aeon_sound_muted', String(next))
      } catch {}
      if (!next) {
        // play a test chime when unmuting
        setTimeout(() => playTone(600, 'sine', 0.08, 0.05), 50)
      }
      return next
    })
  }, [])

  const playTone = (freq: number, type: OscillatorType = 'sine', duration = 0.1, gainValue = 0.05) => {
    if (muted) return
    const ctx = getAudioContext()
    if (!ctx) return

    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = type
      osc.frequency.setValueAtTime(freq, ctx.currentTime)

      gain.gain.setValueAtTime(gainValue, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start()
      osc.stop(ctx.currentTime + duration)
    } catch {}
  }

  const playClick = useCallback(() => {
    playTone(800, 'sine', 0.04, 0.03)
  }, [muted])

  const playSwitch = useCallback(() => {
    if (muted) return
    playTone(520, 'sine', 0.05, 0.04)
    setTimeout(() => playTone(780, 'sine', 0.05, 0.04), 40)
  }, [muted])

  const playSuccess = useCallback(() => {
    if (muted) return
    const ctx = getAudioContext()
    if (!ctx) return
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6 arpeggio
      notes.forEach((f, idx) => {
        setTimeout(() => {
          playTone(f, 'sine', 0.25, 0.06)
        }, idx * 70)
      })
    } catch {}
  }, [muted])

  const playError = useCallback(() => {
    if (muted) return
    playTone(220, 'triangle', 0.18, 0.06)
    setTimeout(() => playTone(180, 'triangle', 0.2, 0.06), 100)
  }, [muted])

  return {
    muted,
    toggleSound,
    playClick,
    playSwitch,
    playSuccess,
    playError,
  }
}
