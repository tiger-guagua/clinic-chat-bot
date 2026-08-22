import { describe, expect, it } from 'vitest';
import type {
  AIProvider,
  AssistantTurn,
  ConversationMessage,
  ToolDefinition,
} from '../src/ai/AIProvider';
import { BookingService, type ProfessionalCalendar } from '../src/booking/BookingService';
import type { CalendarProvider } from '../src/calendar/CalendarProvider';
import { ConversationService } from '../src/conversation/ConversationService';
import { ToolExecutor } from '../src/conversation/ToolExecutor';
import { PROFESSIONALS } from '../src/domain/catalog';
import type { ProfessionalId } from '../src/domain/types';

const NOW = new Date('2026-09-01T08:00:00+08:00');

const CLINIC_CONFIG = {
  clinicTimezone: 'Asia/Taipei',
  clinicOpenHour: '09:00',
  clinicCloseHour: '18:00',
  slotIntervalMinutes: 30,
  clinicClosedWeekdays: ['sunday' as const],
};

class FreeCalendarProvider implements CalendarProvider {
  createdTitles: string[] = [];

  async getBusyIntervals() {
    return [];
  }

  async createEvent(input: { title: string; start: Date; end: Date }) {
    this.createdTitles.push(input.title);
    return { id: 'evt-1', title: input.title, start: input.start, end: input.end };
  }
}

class ScriptedAIProvider implements AIProvider {
  recordedRequests: ConversationMessage[][] = [];

  constructor(private readonly turns: AssistantTurn[]) {}

  async chat(
    messages: ConversationMessage[],
    _tools: ToolDefinition[],
  ): Promise<AssistantTurn> {
    this.recordedRequests.push(messages);
    const turn = this.turns.shift();
    if (!turn) {
      throw new Error('ScriptedAIProvider ran out of turns');
    }
    return turn;
  }

  async transcribe(): Promise<string> {
    throw new Error('not used');
  }

  async speak(): Promise<Buffer> {
    throw new Error('not used');
  }
}

function createConversationService(turns: AssistantTurn[]) {
  const provider = new FreeCalendarProvider();
  const calendars = new Map<ProfessionalId, ProfessionalCalendar>(
    (Object.keys(PROFESSIONALS) as ProfessionalId[]).map((professionalId) => [
      professionalId,
      {
        professional: PROFESSIONALS[professionalId],
        provider,
        calendarId: `cal-${professionalId}`,
      },
    ]),
  );

  const bookingService = new BookingService(calendars, CLINIC_CONFIG, () => NOW);
  const toolExecutor = new ToolExecutor(bookingService, CLINIC_CONFIG);
  const ai = new ScriptedAIProvider(turns);
  const service = new ConversationService(ai, toolExecutor, CLINIC_CONFIG, () => NOW);
  return { service, ai };
}

describe('ConversationService', () => {
  it('returns the assistant reply when no tools are called', async () => {
    const { service, ai } = createConversationService([
      { content: 'We offer services A to E.', toolCalls: [] },
    ]);

    const reply = await service.handleChat([{ role: 'user', content: 'What services?' }]);

    expect(reply).toBe('We offer services A to E.');
    const systemMessage = ai.recordedRequests[0]?.[0];
    expect(systemMessage?.role).toBe('system');
    if (systemMessage?.role === 'system') {
      expect(systemMessage.content).toContain('2026-09-01');
      expect(systemMessage.content).toContain('Closed on: sunday');
    }
  });

  it('executes tool calls and feeds results back to the model', async () => {
    const { service, ai } = createConversationService([
      {
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'find_slots',
            arguments: JSON.stringify({ serviceId: 'C', date: '2026-09-02' }),
          },
        ],
      },
      { content: 'Here are the C slots.', toolCalls: [] },
    ]);

    const reply = await service.handleChat([
      { role: 'user', content: 'Service C tomorrow please' },
    ]);

    expect(reply).toBe('Here are the C slots.');
    const secondRequest = ai.recordedRequests[1];
    const toolMessage = secondRequest?.[secondRequest.length - 1];
    expect(toolMessage?.role).toBe('tool');
    if (toolMessage?.role === 'tool') {
      const payload = JSON.parse(toolMessage.content);
      const professionals = new Set(
        payload.slots.map((slot: { professionalId: string }) => slot.professionalId),
      );
      expect(professionals).toEqual(new Set(['senior1', 'senior2']));
      expect(payload.slots[0].start).toContain('+08:00');
    }
  });

  it('feeds booking errors back to the model instead of throwing', async () => {
    const { service, ai } = createConversationService([
      {
        content: null,
        toolCalls: [
          {
            id: 'call-1',
            name: 'book_appointment',
            arguments: JSON.stringify({
              serviceId: 'C',
              professionalId: 'junior',
              startTime: '2026-09-02T10:00:00+08:00',
              patientName: 'John Smith',
              patientEmail: 'john@example.com',
              confirmed: true,
            }),
          },
        ],
      },
      { content: 'Junior cannot perform C.', toolCalls: [] },
    ]);

    const reply = await service.handleChat([{ role: 'user', content: 'Book it' }]);

    expect(reply).toBe('Junior cannot perform C.');
    const secondRequest = ai.recordedRequests[1];
    const toolMessage = secondRequest?.[secondRequest.length - 1];
    if (toolMessage?.role === 'tool') {
      expect(JSON.parse(toolMessage.content).error).toBe('PROFESSIONAL_NOT_ELIGIBLE');
    }
  });

  it('returns a safe fallback when the tool-iteration limit is reached', async () => {
    const loopingTurn: AssistantTurn = {
      content: null,
      toolCalls: [{ id: 'call-x', name: 'get_services', arguments: '{}' }],
    };
    const { service } = createConversationService(Array(10).fill(loopingTurn));

    const reply = await service.handleChat([{ role: 'user', content: 'loop' }]);

    expect(reply).toContain('could not complete');
  });
});

describe('ToolExecutor argument validation', () => {
  it('rejects malformed JSON arguments', async () => {
    const { service } = createConversationService([]);
    void service;

    const provider = new FreeCalendarProvider();
    const calendars = new Map<ProfessionalId, ProfessionalCalendar>([
      [
        'junior',
        { professional: PROFESSIONALS.junior, provider, calendarId: 'cal-junior' },
      ],
    ]);
    const executor = new ToolExecutor(
      new BookingService(calendars, CLINIC_CONFIG, () => NOW),
      CLINIC_CONFIG,
    );

    const result = JSON.parse(
      await executor.execute({ id: 'c1', name: 'find_slots', arguments: 'not-json' }),
    );
    expect(result.error).toBe('INVALID_ARGUMENTS');

    const missingField = JSON.parse(
      await executor.execute({
        id: 'c2',
        name: 'find_slots',
        arguments: JSON.stringify({ serviceId: 'A' }),
      }),
    );
    expect(missingField.error).toBe('INVALID_ARGUMENTS');

    const unknownTool = JSON.parse(
      await executor.execute({ id: 'c3', name: 'delete_all', arguments: '{}' }),
    );
    expect(unknownTool.error).toBe('UNKNOWN_TOOL');
  });

  it('reports a structured clinic-closed payload', async () => {
    const provider = new FreeCalendarProvider();
    const calendars = new Map<ProfessionalId, ProfessionalCalendar>(
      (Object.keys(PROFESSIONALS) as ProfessionalId[]).map((professionalId) => [
        professionalId,
        {
          professional: PROFESSIONALS[professionalId],
          provider,
          calendarId: `cal-${professionalId}`,
        },
      ]),
    );
    const executor = new ToolExecutor(
      new BookingService(calendars, CLINIC_CONFIG, () => NOW),
      CLINIC_CONFIG,
    );

    const result = JSON.parse(
      await executor.execute({
        id: 'c1',
        name: 'find_slots',
        arguments: JSON.stringify({ serviceId: 'A', date: '2026-09-06' }),
      }),
    );
    expect(result.clinicClosed).toBe(true);
    expect(result.weekday).toBe('sunday');
  });
});
