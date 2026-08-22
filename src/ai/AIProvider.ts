export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as produced by the model; always revalidated before use. */
  arguments: string;
}

export type ConversationMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface AssistantTurn {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface AudioInput {
  data: Buffer;
  mimeType: string;
  filename: string;
}

export interface AIProvider {
  chat(messages: ConversationMessage[], tools: ToolDefinition[]): Promise<AssistantTurn>;
  transcribe(audio: AudioInput): Promise<string>;
  speak(text: string): Promise<Buffer>;
}
