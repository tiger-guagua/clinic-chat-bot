import { DateTime } from 'luxon';
import type { AIProvider, ConversationMessage } from '../ai/AIProvider';
import type { ClinicConfig } from '../booking/BookingService';
import { TOOL_DEFINITIONS, type ToolExecutor } from './ToolExecutor';

const MAX_TOOL_ITERATIONS = 8;

export interface IncomingChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class ConversationService {
  constructor(
    private readonly ai: AIProvider,
    private readonly toolExecutor: ToolExecutor,
    private readonly config: ClinicConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handleChat(incoming: IncomingChatMessage[]): Promise<string> {
    const messages: ConversationMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...incoming.map((message) => ({ role: message.role, content: message.content })),
    ];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const turn = await this.ai.chat(messages, TOOL_DEFINITIONS);

      if (turn.toolCalls.length === 0) {
        return turn.content ?? '';
      }

      messages.push({
        role: 'assistant',
        content: turn.content,
        toolCalls: turn.toolCalls,
      });

      for (const call of turn.toolCalls) {
        const result = await this.toolExecutor.execute(call);
        messages.push({ role: 'tool', toolCallId: call.id, content: result });
      }
    }

    console.warn(
      JSON.stringify({ event: 'tool_iteration_limit_reached', limit: MAX_TOOL_ITERATIONS }),
    );
    return 'I could not complete that request. Please try again or rephrase.';
  }

  private buildSystemPrompt(): string {
    const now = DateTime.fromJSDate(this.now()).setZone(this.config.clinicTimezone);
    const closedDays =
      this.config.clinicClosedWeekdays.length > 0
        ? this.config.clinicClosedWeekdays.join(', ')
        : 'none';

    return `You are an English-only dental clinic scheduling assistant.

Current date and time: ${now.toISO({ suppressMilliseconds: true })} (${now.weekdayLong}), timezone ${this.config.clinicTimezone}.
Clinic hours: ${this.config.clinicOpenHour}-${this.config.clinicCloseHour}. Closed on: ${closedDays}.

You may:
- explain available service names and durations;
- check appointment availability;
- create appointments after explicit confirmation.

You may not:
- diagnose medical conditions;
- recommend medications or treatments;
- provide medical advice;
- answer unrelated questions;
- invent availability or booking results.

All service eligibility, durations, availability, and booking actions must come from tools.

Before booking:
1. collect service;
2. collect date/slot;
3. collect patient name and email;
4. summarize the appointment;
5. obtain explicit user confirmation;
6. only then call book_appointment with confirmed=true.

When listing slots, show at most 10 and offer to show more.
Always respond in English. If the user writes in another language, politely say you only support English.
If the user asks for unsupported or medical guidance, explain that you can only help with clinic scheduling and advise contacting clinic staff.`;
  }
}
