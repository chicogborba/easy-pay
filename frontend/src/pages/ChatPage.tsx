import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, CheckCheck, Mic, Pencil, RotateCcw, SendHorizontal, Square } from 'lucide-react'
import { api, type ChatMsg, type Draft, type Link } from '../lib/api'
import { capitalize, localeOf, useApp } from '../lib/app'
import { blobToWavBase64, browserSpeech, Recorder } from '../lib/audio'
import { Receipt } from '../components/Receipt'
import { ShareActions } from '../components/ShareActions'
import { Arrow, Button, Card, cx, Spinner } from '../components/ui'
import { Confetti, TypingDots, WriteOn } from '../components/motion'

type Entry =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; choices?: string[] }
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
  // Entries restored from the session appear instantly; only new ones animate in.
  const freshFrom = useRef(entries.length)

  useEffect(() => {
    sessionStorage.setItem(STORE, JSON.stringify(entries))
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, busy, voice])

  useEffect(() => () => recorder.current?.cancel(), [])

  // "New link for Ana" from a customer's page: start the message for the owner.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const to = params.get('to')
    if (!to) return
    setText(t('linkForPrefill', { name: to }))
    setParams({}, { replace: true })
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [params, setParams, t])

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
        ...(res.reply ? [{ kind: 'text', role: 'assistant', text: res.reply, choices: res.choices } as Entry] : []),
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
    freshFrom.current = 0
    setEntries([])
    setText('')
  }

  const empty = entries.length === 0
  const lastIsLink = entries[entries.length - 1]?.kind === 'link'
  const today = capitalize(new Intl.RelativeTimeFormat(localeOf(settings.lang), { numeric: 'auto' }).format(0, 'day'))

  return (
    <div className="flex h-full flex-col">
      {/* Chat header: who you're talking to, like any messenger. */}
      <div className="flex items-center gap-3 border-b-2 border-dashed border-pencil/40 bg-paper/90 px-4 py-2.5 backdrop-blur-sm">
        <BotAvatar className="h-12 w-12" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-heading text-lg font-bold">{t('assistantName')}</p>
          <p className="flex items-center gap-1.5 text-base text-leaf">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-leaf/60" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-leaf" />
            </span>
            {busy === 'thinking' ? t('thinking') : t('assistantStatus')}
          </p>
        </div>
        {!empty && (
          <button
            onClick={reset}
            aria-label={t('newChat')}
            title={t('newChat')}
            className="group flex h-11 w-11 items-center justify-center rounded-blob border-2 border-pencil bg-white shadow-hardSm transition-all duration-100 hover:-rotate-12 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          >
            <RotateCcw strokeWidth={2.5} className="h-5 w-5 transition-transform duration-500 group-hover:-rotate-[200deg]" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4">
        <div className="flex justify-center">
          <span className="-rotate-1 rounded-wobblySm border-2 border-dashed border-pencil/40 bg-white/80 px-3 py-0.5 text-base text-pencil/60">{today}</span>
        </div>

        <Bubble role="assistant" fresh>
          {t('chatWelcome')}
        </Bubble>

        {empty && (
          <div className="relative pt-1">
            <p className="mb-3 flex items-center justify-end gap-2 font-heading text-lg font-bold text-pen">
              {t('tryTapping')}
              <Arrow className="h-10 w-12 translate-y-2 rotate-6 text-pen rtl:-scale-x-100" />
            </p>
            <div className="flex flex-col items-end gap-3">
              {[t('example1'), t('example2')].map((ex, i) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  title={t('tapToSend')}
                  style={{ animationDelay: `${500 + i * 180}ms` }}
                  className="group animate-inRight"
                >
                  <span
                    className={cx(
                      'flex max-w-[85%] items-center gap-2 rounded-wobblySm border-2 border-dashed border-pen bg-white px-4 py-2 text-start text-lg text-pen transition-all duration-150',
                      'group-hover:border-solid group-hover:bg-pen group-hover:text-white group-hover:shadow-hardSm group-active:scale-95',
                      i % 2 ? 'rotate-1' : '-rotate-1',
                    )}
                  >
                    “{ex}”
                    <SendHorizontal strokeWidth={2.5} className="h-5 w-5 shrink-0 transition-transform duration-150 group-hover:translate-x-1 rtl:-scale-x-100" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e, i) => {
          const fresh = i >= freshFrom.current
          if (e.kind === 'text')
            return (
              <div key={i}>
                <Bubble role={e.role} fresh={fresh}>
                  {e.text}
                </Bubble>
                {/* Quick answers for the AI's question: only on the latest message. */}
                {i === entries.length - 1 && !busy && voice === 'idle' && !!e.choices?.length && (
                  <div className="mt-5 flex flex-wrap justify-end gap-3 pe-1">
                    {e.choices.map((c, ci) => (
                      <button
                        key={c}
                        onClick={() => send(c)}
                        style={{ animationDelay: `${250 + ci * 110}ms` }}
                        className={cx(
                          'min-h-[48px] animate-rise rounded-wobblySm border-2 border-pencil bg-postit px-4 py-2 text-start text-xl shadow-hardSm transition-all duration-100',
                          'hover:-translate-y-0.5 hover:bg-pen hover:text-white hover:shadow-hard active:translate-y-0 active:scale-95 active:shadow-none',
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          if (e.kind === 'draft')
            return (
              <div key={i} className={cx('flex gap-2', fresh && 'animate-flipIn')}>
                <BotAvatar className="mt-1 h-9 w-9" />
                <Card decoration="tape" tilt={-0.6} className={cx('min-w-0 flex-1 transition-opacity duration-300', e.state === 'done' && 'opacity-60')}>
                  <Receipt items={e.draft.items} currency={e.draft.currency} note={e.draft.note} customer={e.draft.customer} />
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
              </div>
            )
          return (
            <div key={i} className={cx('relative', fresh && 'animate-rise')}>
              {fresh && <Confetti fire={e.link.id} count={34} spread={220} />}
              <Card tone="postit" tilt={0.8} decoration="tack" className="!p-6">
                <h2 className="text-center font-heading text-3xl font-bold">
                  <span className={cx('inline-block', fresh && 'animate-wiggle [animation-delay:.3s]')}>🎉</span> {t('linkReady')}
                </h2>
                <p className="mb-4 text-center text-xl text-pencil/70">{t('linkReadySub')}</p>
                <ShareActions link={e.link} />
              </Card>
            </div>
          )
        })}

        {busy === 'thinking' && (
          <Bubble role="assistant">
            <TypingDots className="text-pencil/70" />
            <span className="sr-only">{t('thinking')}</span>
          </Bubble>
        )}
        {voice === 'transcribing' && (
          <Bubble role="user">
            <span className="inline-flex items-center gap-2">
              <TypingDots /> {t('transcribing')}
            </span>
          </Bubble>
        )}
        {lastIsLink && (
          <div className="flex animate-rise justify-center [animation-delay:.5s]">
            <Button variant="secondary" onClick={reset} icon={<RotateCcw strokeWidth={2.5} />}>
              {t('newLink')}
            </Button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer: mic when empty (like WhatsApp), send arrow when there's text. */}
      <form
        className="flex items-center gap-3 border-t-2 border-dashed border-pencil/40 bg-paper/90 px-4 py-3 backdrop-blur-sm"
        onSubmit={(ev) => {
          ev.preventDefault()
          send(text)
        }}
      >
        {voice === 'recording' ? (
          <button
            type="button"
            onClick={stopVoice}
            className="flex min-h-[56px] flex-1 animate-pop items-center gap-3 rounded-wobbly border-[3px] border-marker bg-white px-4 text-xl"
          >
            <span className="flex h-6 items-center gap-1" aria-hidden>
              {[0, 1, 2, 3, 4].map((b) => (
                <span key={b} className="h-5 w-1.5 animate-dot rounded-full bg-marker" style={{ animationDelay: `${b * 120}ms`, animationDuration: '.8s' }} />
              ))}
            </span>
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
            className="min-h-[56px] min-w-0 flex-1 rounded-wobbly border-[3px] border-pencil bg-white px-5 text-xl shadow-hardSm transition-all duration-150 placeholder:text-pencil/40 focus:-translate-y-0.5 focus:border-pen focus:shadow-hard focus:outline-none focus:ring-4 focus:ring-pen/20"
          />
        )}

        {text.trim() && voice === 'idle' ? (
          <RoundButton key="send" type="submit" label={t('send')} disabled={!!busy} tone="pen">
            <SendHorizontal strokeWidth={2.5} className="h-7 w-7 rtl:-scale-x-100" />
          </RoundButton>
        ) : voice === 'recording' ? (
          <RoundButton key="stop" type="button" label={t('listening')} onClick={stopVoice} tone="marker" pulse>
            <Square strokeWidth={3} className="h-6 w-6 fill-white" />
          </RoundButton>
        ) : (
          <RoundButton key="mic" type="button" label={t('speak')} onClick={startVoice} disabled={!!busy || voice !== 'idle'} tone="marker">
            <Mic strokeWidth={2.5} className="h-7 w-7" />
          </RoundButton>
        )}
      </form>
    </div>
  )
}

/** The assistant's face: a rough blob with blinking eyes. */
function BotAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('relative inline-flex shrink-0 -rotate-6 items-center justify-center rounded-blob border-2 border-pencil bg-postit shadow-hardSm', className)}
    >
      <svg viewBox="0 0 40 40" className="h-[70%] w-[70%]" fill="none" stroke="#2d2d2d" strokeWidth="3" strokeLinecap="round">
        <g className="origin-center animate-blink" style={{ transformBox: 'fill-box' }}>
          <path d="M13 15 v4" />
          <path d="M26 15 v4" />
        </g>
        <path d="M11 26 Q 20 33 29 25" />
        <circle cx="33" cy="9" r="2.5" fill="#ff4d4d" stroke="none" />
      </svg>
    </span>
  )
}

function Bubble({ role, fresh, children }: { role: 'user' | 'assistant'; fresh?: boolean; children: React.ReactNode }) {
  const mine = role === 'user'
  return (
    <div className={cx('flex items-end gap-2', mine ? 'justify-end' : 'justify-start', fresh && (mine ? 'animate-inRight' : 'animate-inLeft'))}>
      {!mine && <BotAvatar className="mb-3 h-9 w-9" />}
      <div
        className={cx(
          'relative max-w-[82%] border-2 border-pencil px-4 py-3 text-xl leading-snug shadow-hardSm',
          mine ? 'tail-right rotate-1 rounded-wobblySm bg-pen text-white' : 'tail-left -rotate-1 rounded-wobblyMd bg-white',
        )}
      >
        {fresh && !mine && typeof children === 'string' ? <WriteOn text={children} /> : children}
        {mine && (
          <CheckCheck aria-hidden strokeWidth={2.5} className="-mb-1 ms-2 inline-block h-4 w-4 align-baseline text-white/70" />
        )}
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
        'flex h-16 w-16 shrink-0 animate-pop items-center justify-center rounded-blob border-[3px] border-pencil text-white shadow-hard transition-all duration-100',
        'hover:translate-x-[2px] hover:translate-y-[2px] hover:rotate-6 hover:shadow-hardSm active:translate-x-[4px] active:translate-y-[4px] active:shadow-none',
        'disabled:opacity-50',
        tone === 'pen' ? 'bg-pen' : 'bg-marker',
        pulse && 'animate-pulseRing',
      )}
    >
      {children}
    </button>
  )
}
