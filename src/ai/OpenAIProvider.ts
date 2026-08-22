import OpenAI, { toFile } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AIConfig } from '../config';
import type {
  AIProvider,
  AssistantTurn,
  AudioInput,
  ConversationMessage,
  ToolDefinition,
} from './AIProvider';

function toOpenAIMessage(message: ConversationMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant':
      if (message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: message.content,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      return { role: 'assistant', content: message.content ?? '' };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: AIConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async chat(
    messages: ConversationMessage[],
    tools: ToolDefinition[],
  ): Promise<AssistantTurn> {
    const completion = await this.client.chat.completions.create({
      model: this.config.chatModel,
      messages: messages.map(toOpenAIMessage),
      tools: tools.map(toOpenAITool),
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error('OpenAI returned no completion choice.');
    }

    return {
      content: message.content ?? null,
      toolCalls: (message.tool_calls ?? [])
        .filter((call) => call.type === 'function')
        .map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
    };
  }

  async transcribe(audio: AudioInput): Promise<string> {
    const transcription = await this.client.audio.transcriptions.create({
      file: await toFile(audio.data, audio.filename, { type: audio.mimeType }),
      model: this.config.sttModel,
      language: 'en',
    });
    return transcription.text;
  }

  async speak(text: string): Promise<Buffer> {
    const response = await this.client.audio.speech.create({
      model: this.config.ttsModel,
      voice: 'alloy',
      input: text,
    });
    return Buffer.from(await response.arrayBuffer());
  }
}
