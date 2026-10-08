// @vitest-environment jsdom
/** The speech page as the Plugins page renders it: its provider line, its voice and speed controls, and the preview. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SpeechCard, type SpeechCardProps } from '../src/client/SpeechCard.tsx'
import type { SpeechCardState } from '../src/client/speech-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SpeechCardState = {
  connected: true,
  providers: [
    {
      id: 'kokoro-local', name: 'Kokoro-82M (local)',
      voices: [{ id: 'zf_001', name: '晴岚' }, { id: 'zm_009', name: '云舟' }],
      intake: null,
    },
    {
      id: 'openvoice-local', name: 'OpenVoice v2 (local)', voices: [{ id: 'demo', name: 'demo' }],
      intake: { accept: ['audio/wav', 'audio/flac'], maxBytes: 1024 },
    },
  ],
  engine: 'remote',
  providerId: 'kokoro-local',
  voiceId: 'zf_001',
  speed: 1,
  previewing: false,
  uploading: false,
  error: null,
}

function renderSpeech(state: Partial<SpeechCardState> = {}, view: 'summary' | 'page' = 'page') {
  const store = createSnapshotStore<SpeechCardState>({ ...settled, ...state })
  const bound = {
    configure: vi.fn(() => Promise.resolve()), preview: vi.fn(() => Promise.resolve()),
    upload: vi.fn(() => Promise.resolve()),
  }
  const props = { actions: bound, view, t, useSpeechCard: bindSnapshotSelector(store) } as SpeechCardProps
  render(<SpeechCard {...props} />)
  return bound
}

describe('SpeechCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderSpeech({}, 'summary')

    expect(document.body.textContent).toBe(en.description)
    expect(screen.queryByLabelText(en.voice)).toBeNull()
  })

  it('reports a dead stream and an empty catalog', () => {
    renderSpeech({ connected: false })
    expect(screen.getByText(en.disconnected)).toBeTruthy()

    cleanup()
    renderSpeech({ providers: [] })
    expect(screen.getByText(en.noProvider)).toBeTruthy()
  })

  it('shows the selected provider and its voices by display name', () => {
    renderSpeech()

    const provider = screen.getByLabelText(en.provider)
    expect(provider).toHaveProperty('value', 'kokoro-local')
    expect(screen.getByText('Kokoro-82M (local)')).toBeTruthy()
    expect(screen.getByText('OpenVoice v2 (local)')).toBeTruthy()
    const voice = screen.getByLabelText(en.voice)
    expect(voice).toHaveProperty('value', 'zf_001')
    expect(screen.getByText('晴岚（zf_001）')).toBeTruthy()
    expect(screen.getByText('云舟（zm_009）')).toBeTruthy()
    expect(screen.queryByText('demo')).toBeNull()
  })

  it('switches the provider immediately', () => {
    const bound = renderSpeech()

    fireEvent.change(screen.getByLabelText(en.provider), { target: { value: 'openvoice-local' } })

    expect(bound.configure).toHaveBeenCalledWith({ providerId: 'openvoice-local' })
  })

  it('offers the browser voice and locks the Host voice controls while it is selected', () => {
    renderSpeech({ engine: 'browser', providerId: 'openvoice-local', voiceId: 'demo' })

    expect(screen.getByLabelText(en.provider)).toHaveProperty('value', 'browser')
    expect(screen.getByRole('option', { name: en.browserVoice })).toBeTruthy()
    const voice = screen.getByLabelText(en.voice)
    expect(voice).toHaveProperty('value', 'browser')
    expect(voice).toHaveProperty('disabled', true)
    expect(screen.getByRole('option', { name: en.browserDefaultVoice })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.uploadRecording })).toBeNull()
  })

  it('switches to the browser voice through configure', () => {
    const bound = renderSpeech()

    fireEvent.change(screen.getByLabelText(en.provider), { target: { value: 'browser' } })

    expect(bound.configure).toHaveBeenCalledWith({ providerId: 'browser' })
  })

  it('keeps an uncataloged current voice selectable until the roster lists it', () => {
    renderSpeech({ providerId: 'openvoice-local', voiceId: 'my-clone' })

    expect(screen.getByLabelText(en.voice)).toHaveProperty('value', 'my-clone')
    expect(screen.getByRole('option', { name: 'my-clone' })).toBeTruthy()
    expect(screen.getByText('demo')).toBeTruthy()
  })

  it('applies a voice change immediately', () => {
    const bound = renderSpeech()

    fireEvent.change(screen.getByLabelText(en.voice), { target: { value: 'zm_009' } })

    expect(bound.configure).toHaveBeenCalledWith({ voiceId: 'zm_009' })
  })

  it('applies a speed change clamped into the accepted range', () => {
    const bound = renderSpeech()

    fireEvent.change(screen.getByLabelText(en.speed), { target: { value: '1.4' } })
    fireEvent.change(screen.getByLabelText(en.speed), { target: { value: 'abc' } })

    expect(bound.configure.mock.calls).toEqual([[{ speed: 1.4 }]])
  })

  it('previews and shows the playing state', () => {
    renderSpeech({ previewing: true })
    expect(screen.getByRole('button', { name: en.previewing })).toHaveProperty('disabled', true)

    cleanup()
    const bound = renderSpeech()
    fireEvent.click(screen.getByRole('button', { name: en.preview }))
    expect(bound.preview).toHaveBeenCalledOnce()
  })

  it('offers the recording picker only while the selected provider accepts recordings', () => {
    renderSpeech()
    expect(screen.queryByRole('button', { name: en.uploadRecording })).toBeNull()

    cleanup()
    renderSpeech({ providerId: 'openvoice-local', voiceId: 'demo' })
    expect(screen.getByRole('button', { name: en.uploadRecording })).toBeTruthy()
    expect(document.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('audio/wav,audio/flac')
  })

  it('hands a picked recording to the upload action and shows the storing state', () => {
    const bound = renderSpeech({ providerId: 'openvoice-local', voiceId: 'demo' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2])], 'demo.wav', { type: 'audio/wav' })
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)
    expect(bound.upload).toHaveBeenCalledWith(file)

    cleanup()
    renderSpeech({ providerId: 'openvoice-local', voiceId: 'demo', uploading: true })
    expect(screen.getByRole('button', { name: en.uploading })).toHaveProperty('disabled', true)
  })

  it('keeps the content and appends the failure notice', () => {
    renderSpeech({ error: 'speech provider is unavailable' })

    expect(screen.getByText('speech provider is unavailable')).toBeTruthy()
    expect(screen.getByLabelText(en.voice)).toBeTruthy()
  })
})
