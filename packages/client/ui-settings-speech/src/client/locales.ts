/** Locale bundles for the speech synthesis settings page. */

/** Locale keys the page renders. */
export type SpeechSettingsLocaleKey =
  | 'title' | 'description'
  | 'provider' | 'browserVoice' | 'voice' | 'browserDefaultVoice' | 'voiceHint' | 'speed' | 'speedHint'
  | 'preview' | 'previewing' | 'uploadRecording' | 'uploading'
  | 'disconnected' | 'noProvider'

/** English copy. */
export const en: Record<SpeechSettingsLocaleKey, string> = {
  title: 'Speech',
  description: 'Pick the voice and pace for read-aloud.',
  provider: 'Provider',
  browserVoice: 'Built-in browser voice (no delay)',
  voice: 'Voice',
  browserDefaultVoice: 'System default voice',
  voiceHint: 'Voices come from the selected synthesis provider.',
  speed: 'Speed',
  speedHint: 'Reading pace between 0.5 and 2.',
  preview: 'Preview',
  previewing: 'Playing…',
  uploadRecording: 'Upload recording',
  uploading: 'Uploading…',
  disconnected: 'Speech synthesis is not connected right now.',
  noProvider: 'No synthesis provider is configured in this deployment.',
}

/** Simplified Chinese copy. */
export const zh: Record<SpeechSettingsLocaleKey, string> = {
  title: '语音',
  description: '选择朗读的音色与语速。',
  provider: '提供方',
  browserVoice: '浏览器内置语音（无延时）',
  voice: '音色',
  browserDefaultVoice: '系统默认音色',
  voiceHint: '音色来自当前选择的合成提供方。',
  speed: '语速',
  speedHint: '朗读语速介于 0.5 到 2 之间。',
  preview: '试听',
  previewing: '播放中…',
  uploadRecording: '上传录音',
  uploading: '上传中…',
  disconnected: '语音合成当前未连接。',
  noProvider: '本部署未配置语音合成提供方。',
}
