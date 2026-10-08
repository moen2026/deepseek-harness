/** Browser Chat target plugin. */
export { apply, inject } from './apply.ts'
export type { ReadAloudEngine } from './chat/read-aloud.ts'
export type { TtsReadiness } from './chat/tts-readiness.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReadAloudEngine } from './chat/read-aloud.ts'
import type { TtsReadiness } from './chat/tts-readiness.ts'

/** The read-aloud runtime one Chat plugin owns, shared with settings pages. */
export interface ReadAloudService {
  /** Live synthesis readiness mirror; a dead stream keeps the last catalog. */
  readonly readiness: SnapshotStore<TtsReadiness>
  /** Accepted playback engine; `browser` routes every new reading to the browser engine. */
  readonly engine: SnapshotStore<ReadAloudEngine>
  /**
   * Synthesize one text with the current Host selection and play the WAV.
   * @param text - plain text to read.
   * @param onEnd - called once playback completes or is cancelled.
   * @returns cancel callback which stops playback and settles the reading.
   * @throws when no remote runtime is bound or synthesis fails.
   */
  speak(text: string, onEnd: () => void): Promise<() => void>
  /**
   * Speak one text through the browser engine instead of Host synthesis.
   * @param text - plain text to read.
   * @param onEnd - called once the reading completes, fails, or is cancelled.
   * @returns stop callback which cancels the reading and settles it.
   */
  speakBrowser(text: string, onEnd: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-aloud runtime provided by the Chat plugin. */
    readAloud: ReadAloudService
  }
}
export type {} from './conversation-nodes/assistant.ts'
export type {} from './conversation-nodes/command.ts'
export type {} from './conversation-nodes/compaction.ts'
export type {} from './conversation-nodes/fallback.ts'
export type {} from './conversation-nodes/message.ts'
export type {} from './conversation-nodes/request-prompt.ts'
export type {} from './conversation-nodes/retry.ts'
export type {} from './conversation-nodes/tool.ts'
export type {} from './conversation-nodes/turn-error.ts'
export type {} from './conversation-nodes/turn-max-tokens.ts'
export type {} from './conversation-nodes/turn-process.ts'
export type {} from './conversation-nodes/turn-tail.ts'

export type {
  AssistantBlock, AssistantMessageNode, AssistantProviderMetadataView, AssistantRequestConfig,
  AssistantTiming, ChatLocationNodeIndex, ChatNodeProcessSource, ChatNodeSource, ChatNodeStore,
  ChatSnapshot, ChatTurnNavigationIndex, ChatTurnProcessPresentation,
  CommandNode, CompactionSummaryNode, ContextMessageNode, ConversationNode,
  LegacyConversationSlice, ModelRetryNode, PartialAssistant, PreparingToolCall, RunningToolCall, StartedToolCall,
  SteeringMessageNode, ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode,
  TurnNavigationItem, UnknownSurfaceNode, UserMessageNode,
} from './contract/snapshot.ts'
export type {
  AssistantChatData, ChatConversationViewNode, ChatNode, ChatNodeKind,
  FinalAssistantChatData, ManualCompactionChatData, RetryChatData, ToolChatData,
  TurnProcessChatData, TurnTailChatData,
} from './contract/chat-nodes.ts'
export type { ChatStoreState, ToolCallId, TurnProcessViewEntry } from './contract/store.ts'
export type { TranscriptViewRowInjected, TranscriptViewRowProps } from './settings/TranscriptViewRow.tsx'
export type { TranscriptViewMode } from '../chat-settings.ts'
export type { ChatPresentationPolicy } from './presentation-policy.ts'
export type {
  AssistantActionOwnerProps, ChatFileMentions, ChatNodeHookContext, ChatNodeInjected, ChatNodeOwnerProps,
  ChatNodeViewProps, ChatScrollPosition, ChatStore, ChatViewInjected, ChatViewSlotProps,
  CommandRowOwnerProps, CommandRowProps, MessageImagesProps, OpenFileOptions, PresentationInjected,
  QuotaNoticeCode, QuotaNoticeHostProps, QuotaNoticeInjected, QuotaNoticeOwnerProps, QuotaNoticeState,
  TurnProcessOwnerProps, TurnTailOwnerProps, UseChat, UseChatNodeTurnData, UseDisclosure, UsePresentation,
} from './contract/slots.ts'
export type {
  TurnProcessSpec,
} from './contract/turn-process.ts'
export type { ChatKey } from './locale.ts'
export type { ConversationContext, ConversationContextOriginKind } from './model/conversation-context.ts'
export type {
  ContextProducerView, ContextRole, KnownContextForm,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {
  ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestView,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export { isRunningTool, isSettledTool } from './contract/chat-nodes.ts'
export { EMPTY_CHAT_SNAPSHOT } from './contract/snapshot.ts'

/** Public merge surface for Chat renderer payloads contributed by other plugins. */
export interface ChatNodeDataMap {}

type PublicChatNodeDataMap = ChatNodeDataMap

declare module './contract/chat-nodes.ts' {
  interface ChatNodeDataMap extends PublicChatNodeDataMap {}
}
export type { ProcessActivity, ProcessActivitySummary, ProcessGroupData } from './contract/process-groups.ts'
