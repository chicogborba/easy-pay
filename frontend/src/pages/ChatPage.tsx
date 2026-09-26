import { useEffect, useRef, useState } from 'react'
import { Check, Mic, Pencil, RotateCcw, SendHorizontal, Square } from 'lucide-react'
import { api, type ChatMsg, type Draft, type Link } from '../lib/api'
import { useApp } from '../lib/app'
import { blobToWavBase64, browserSpeech, Recorder } from '../lib/audio'
import { Receipt } from '../components/Receipt'
import { ShareActions } from '../components/ShareActions'
import { Arrow, Button, Card, cx, Spinner } from '../components/ui'

type Entry =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string }
  | { kind: 'draft'; draft: Draft; state: 'open' | 'done' }
  | { kind: 'link'; link: Link }

const STORE = 'ep.chat'
const MAX_RECORD_MS = 60_000

function loadEntries(): Entry[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '[]')
  } catch {
    return []
  }
}

/** Only the conversation since the last created link is sent to the AI. */
function toHistory(entries: Entry[]): ChatMsg[] {
  const lastLink = entries.map((e) => e.kind).lastIndexOf('link')
  return entries.slice(lastLink + 1).flatMap<ChatMsg>((e) =>
    e.kind === 'text'
      ? [{ role: e.role, content: e.text }]
      : e.kind === 'draft'
        ? [{ role: 'assistant', content: `Current draft: ${JSON.stringify(e.draft)}` }]
        : [],
  )
}

export default function ChatPage() {
  const { t, settings, server, toast } = useApp()
  const [entries, setEntries] = useState<Entry[]>(loadEntries)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<null | 'thinking' | 'creating'>(null)
  const [voice, setVoice] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const recorder = useRef<Recorder | null>(null)
  const speech = useRef<any>(null)
  const stopTimer = useRef<number>()
  // Voice callbacks fire later, so they read the latest entries through a ref.
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(() => {
    sessionStorage.setItem(STORE, JSON.stringify(entries))
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, busy, voice])

  useEffect(() => () => recorder.current?.cancel(), [])

  useEffect(() => {
    if (voice !== 'recording') return
    setSeconds(0)
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [voice])

  const send = async (raw: string) => {
    const msg = raw.trim()
    if (!msg || busy) return
    setText('')
    // Any open draft is superseded by the new message.
    const next: Entry[] = [
      ...entriesRef.current.map((e) => (e.kind === 'draft' && e.state === 'open' ? { ...e, state: 'done' as const } : e)),
      { kind: 'text', role: 'user', text: msg },
    ]
    setEntries(next)
    setBusy('thinking')
    try {
      const res = await api.chat(toHistory(next), settings.lang, settings.currency)
      setEntries((cur) => [
        ...cur,
        ...(res.reply ? [{ kind: 'text', role: 'assistant', text: res.reply } as Entry] : []),
        ...(res.draft ? [{ kind: 'draft', draft: res.draft, state: 'open' } as Entry] : []),
      ])
    } catch {
      setEntries((cur) => [...cur, { kind: 'text', role: 'assistant', text: t('errorGeneric') }])
    } finally {
      setBusy(null)
    }
  }

  const accept = async (index: number, draft: Draft) => {
    setBusy('creating')
    try {
      const link = await api.createLink(draft, settings.business)
      setEntries((cur) => [
        ...cur.map((e, i) => (i === index && e.kind === 'draft' ? { ...e, state: 'done' as const } : e)),
        { kind: 'link', link },
      ])
    } catch {
      toast(t('errorGeneric'))
    } finally {
      setBusy(null)
    }
  }

  const change = (index: number) => {
    setEntries((cur) => cur.map((e, i) => (i === index && e.kind === 'draft' ? { ...e, state: 'done' as const } : e)))
    inputRef.current?.focus()
  }

  /* ---------- voice ---------- */

  const startVoice = async () => {
    if (server.voice && Recorder.supported()) {
      try {
        recorder.current = new Recorder()
        await recorder.current.start()
        setVoice('recording')
        stopTimer.current = window.setTimeout(stopVoice, MAX_RECORD_MS)
      } catch {
        toast(t('micDenied'))
      }
      return
    }
    // No server transcription: try the browser's built-in speech recognition.
    const sr = browserSpeech()
    if (!sr) return toast(t('voiceOff'))
    speech.current = sr
    let finalText = ''
    sr.lang = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-SA', fr: 'fr-FR' }[settings.lang]
    sr.interimResults = false
    sr.continuous = true
    sr.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '
    }
    sr.onerror = (e: any) => e.error === 'not-allowed' && toast(t('micDenied'))
    sr.onend = () => {
      setVoice('idle')
      if (finalText.trim()) send(finalText)
    }
    sr.start()
    setVoice('recording')
  }

  const stopVoice = async () => {
    clearTimeout(stopTimer.current)
    if (speech.current) {
      speech.current.stop()
      speech.current = null
      return
    }
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    setVoice('transcribing')
    try {
      const blob = await rec.stop()
      const wav = await blobToWavBase64(blob)
      const { text } = await api.transcribe(wav, settings.lang)
      setVoice('idle')
      if (text.trim()) send(text)
    } catch {
      setVoice('idle')
      toast(t('errorGeneric'))
    }
  }

  const reset = () => {
    setEntries([])
    setText('')
  }

  const empty = entries.length === 0
  const lastIsLink = entries[entries.length - 1]?.kind === 'link'

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 pt-3">
        <Bubble role="assistant">{t('chatWelcome')}</Bubble>

        {empty && (
          <div className="relative pt-2">
            <Arrow className="absolute -top-4 end-4 h-12 w-14 rotate-12 text-pen" />
            <p className="mb-3 font-heading text-lg font-bold text-pen">{t('tryTapping')}</p>
            <div className="flex flex-col items-start gap-3">
              {[t('example1'), t('example2')].map((ex, i) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className={cx(
                    'rounded-wobblySm border-2 border-dashed border-pencil bg-white px-4 py-2 text-start text-lg transition-transform duration-100 hover:rotate-1 hover:border-solid active:scale-95',
                    i % 2 ? 'rotate-1' : '-rotate-1',
                  )}
                >
                  “{ex}”
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e, i) => {
          if (e.kind === 'text') return <Bubble key={i} role={e.role}>{e.text}</Bubble>
          if (e.kind === 'draft')
            return (
              <Card key={i} decoration="tape" tilt={-0.6} className={cx('animate-pop', e.state === 'done' && 'opacity-60')}>
                <Receipt items={e.draft.items} currency={e.draft.currency} note={e.draft.note} />
                {e.state === 'open' && (
                  <div className="mt-5 space-y-3">
                    <Button
                      variant="accent"
                      size="lg"
                      block
                      disabled={!!busy}
                      onClick={() => accept(i, e.draft)}
                      icon={busy === 'creating' ? <Spinner className="border-white border-t-transparent" /> : <Check strokeWidth={3} />}
                    >
                      {t('yesCreate')}
                    </Button>
                    <Button variant="ghost" block onClick={() => change(i)} icon={<Pencil strokeWidth={2.5} className="h-5 w-5" />}>
                      {t('changeSomething')}
                    </Button>
                  </div>
                )}
              </Card>
            )
          return (
            <Card key={i} tone="postit" tilt={0.8} decoration="tack" className="animate-pop !p-6">
              <h2 className="text-center font-heading text-3xl font-bold">🎉 {t('linkReady')}</h2>
              <p className="mb-4 text-center text-xl text-pencil/70">{t('linkReadySub')}</p>
              <ShareActions link={e.link} />
            </Card>
          )
        })}

        {busy === 'thinking' && (
          <Bubble role="assistant">
            <span className="inline-flex items-center gap-2">
              <Spinner /> {t('thinking')}
            </span>
          </Bubble>
        )}
        {voice === 'transcribing' && (
          <Bubble role="user">
            <span className="inline-flex items-center gap-2">
              <Spinner className="border-white border-t-transparent" /> {t('transcribing')}
            </span>
          </Bubble>
        )}
        {lastIsLink && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={reset} icon={<RotateCcw strokeWidth={2.5} />}>
              {t('newLink')}
            </Button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer: mic when empty (like WhatsApp), send arrow when there's text. */}
      <form
        className="flex items-center gap-3 border-t-2 border-dashed border-pencil/40 bg-paper/90 px-4 py-3"
        onSubmit={(ev) => {
          ev.preventDefault()
          send(text)
        }}
      >
        {voice === 'recording' ? (
          <button
            type="button"
            onClick={stopVoice}
            className="flex min-h-[56px] flex-1 items-center gap-3 rounded-wobbly border-[3px] border-pencil bg-white px-4 text-xl"
          >
            <span className="h-4 w-4 animate-pulse rounded-full bg-marker" />
            <span className="flex-1 text-start">{t('listening')}</span>
            <span className="tabular-nums text-pencil/60">0:{String(seconds).padStart(2, '0')}</span>
          </button>
        ) : (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={entries.some((e) => e.kind === 'draft') && !lastIsLink ? t('changeHint') : t('typeHere')}
            disabled={voice !== 'idle'}
            enterKeyHint="send"
            className="min-h-[56px] min-w-0 flex-1 rounded-wobbly border-[3px] border-pencil bg-white px-5 text-xl placeholder:text-pencil/40 focus:border-pen focus:outline-none focus:ring-4 focus:ring-pen/20"
          />
        )}

        {text.trim() && voice === 'idle' ? (
          <RoundButton type="submit" label={t('send')} disabled={!!busy} tone="pen">
            <SendHorizontal strokeWidth={2.5} className="h-7 w-7 rtl:-scale-x-100" />
          </RoundButton>
        ) : voice === 'recording' ? (
          <RoundButton type="button" label={t('listening')} onClick={stopVoice} tone="marker" pulse>
            <Square strokeWidth={3} className="h-6 w-6 fill-white" />
          </RoundButton>
        ) : (
          <RoundButton type="button" label={t('speak')} onClick={startVoice} disabled={!!busy || voice !== 'idle'} tone="marker">
            <Mic strokeWidth={2.5} className="h-7 w-7" />
          </RoundButton>
        )}
      </form>
    </div>
  )
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const mine = role === 'user'
  return (
    <div className={cx('flex animate-pop', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'relative max-w-[85%] border-2 border-pencil px-4 py-3 text-xl leading-snug shadow-hardSm',
          mine ? 'tail-right rotate-1 rounded-wobblySm bg-pen text-white' : 'tail-left -rotate-1 rounded-wobblyMd bg-white',
        )}
      >
        {children}
      </div>
    </div>
  )
}

function RoundButton({
  children,
  label,
  tone,
  pulse,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone: 'pen' | 'marker'; pulse?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'flex h-16 w-16 shrink-0 items-center justify-center rounded-blob border-[3px] border-pencil text-white shadow-hard transition-all duration-100',
        'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-hardSm active:translate-x-[4px] active:translate-y-[4px] active:shadow-none',
        'disabled:opacity-50',
        tone === 'pen' ? 'bg-pen' : 'bg-marker',
        pulse && 'animate-pulseRing',
      )}
    >
      {children}
    </button>
  )
}
