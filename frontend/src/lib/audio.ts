/**
 * Voice capture. The browser records in whatever format it likes (webm/mp4),
 * then we decode it and re-encode as 16 kHz mono WAV, which every
 * transcription model accepts.
 */
export class Recorder {
  private rec?: MediaRecorder
  private chunks: Blob[] = []
  private stream?: MediaStream

  static supported() {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []
    this.rec = new MediaRecorder(this.stream)
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.start()
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec
      if (!rec) return resolve(new Blob())
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop())
        resolve(new Blob(this.chunks, { type: rec.mimeType }))
      }
      rec.stop()
    })
  }

  cancel() {
    this.rec?.state === 'recording' && this.rec.stop()
    this.stream?.getTracks().forEach((t) => t.stop())
  }
}

export async function blobToWavBase64(blob: Blob, rate = 16000): Promise<string> {
  const buf = await blob.arrayBuffer()
  const AC = window.AudioContext || (window as any).webkitAudioContext
  const ctx: AudioContext = new AC()
  const decoded = await ctx.decodeAudioData(buf)
  ctx.close()

  const length = Math.max(1, Math.ceil(decoded.duration * rate))
  const off = new OfflineAudioContext(1, length, rate)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const pcm = (await off.startRendering()).getChannelData(0)

  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  const bytes = new Uint8Array(view.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Browser speech recognition, used only when the server has no AI key. */
export function browserSpeech(): any {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  return SR ? new SR() : null
}
