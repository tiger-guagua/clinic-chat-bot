import { DateTime } from 'luxon';
import { z } from 'zod';
import type { ToolCall, ToolDefinition } from '../ai/AIProvider';
import { BookingError, BookingService, type ClinicConfig } from '../booking/BookingService';
import { SERVICES } from '../domain/catalog';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_services',
    description:
      'List the clinic services with their duration in minutes and the professionals allowed to perform each one.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_slots',
    description:
      'Find available appointment slots for one service on one date. Returns each slot with its professional.',
    parameters: {
      type: 'object',
      properties: {
        serviceId: { type: 'string', description: 'Service id, for example "C".' },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format, clinic timezone.',
        },
      },
      required: ['serviceId', 'date'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_appointment',
    description:
      'Create the appointment. Call this only after the user has explicitly confirmed the summarized appointment.',
    parameters: {
      type: 'object',
      properties: {
        serviceId: { type: 'string' },
        professionalId: { type: 'string' },
        startTime: {
          type: 'string',
          description: 'Slot start time as ISO-8601 with timezone offset.',
        },
        patientName: { type: 'string' },
        patientEmail: { type: 'string' },
        confirmed: {
          type: 'boolean',
          description: 'Must be true; set only after the user explicitly confirmed.',
        },
      },
      required: [
        'serviceId',
        'professionalId',
        'startTime',
        'patientName',
        'patientEmail',
        'confirmed',
      ],
      additionalProperties: false,
    },
  },
];

const findSlotsArgsSchema = z.object({
  serviceId: z.string(),
  date: z.string(),
});

const bookAppointmentArgsSchema = z.object({
  serviceId: z.string(),
  professionalId: z.string(),
  startTime: z.string(),
  patientName: z.string(),
  patientEmail: z.string(),
  confirmed: z.boolean(),
});

export class ToolExecutor {
  constructor(
    private readonly bookingService: BookingService,
    private readonly config: ClinicConfig,
  ) {}

  /** Executes one model tool call and returns the JSON payload for the tool message. */
  async execute(call: ToolCall): Promise<string> {
    try {
      switch (call.name) {
        case 'get_services':
          return this.getServices();
        case 'find_slots':
          return await this.findSlots(call.arguments);
        case 'book_appointment':
          return await this.bookAppointment(call.arguments);
        default:
          return JSON.stringify({ error: 'UNKNOWN_TOOL', message: `Unknown tool "${call.name}".` });
      }
    } catch (error) {
      if (error instanceof BookingError) {
        return JSON.stringify({ error: error.code, message: error.message });
      }
      console.error(
        JSON.stringify({
          event: 'tool_execution_error',
          tool: call.name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'The tool failed unexpectedly. Apologize and suggest trying again.',
      });
    }
  }

  private getServices(): string {
    return JSON.stringify({
      services: Object.values(SERVICES).map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        professionals: service.professionals,
      })),
    });
  }

  private async findSlots(rawArguments: string): Promise<string> {
    const args = this.parseArguments(findSlotsArgsSchema, rawArguments);
    if (typeof args === 'string') {
      return args;
    }

    const result = await this.bookingService.findSlots(args.serviceId, args.date);
    if (result.kind === 'clinicClosed') {
      return JSON.stringify({
        clinicClosed: true,
        date: result.date,
        weekday: result.weekday,
        message: `The clinic is closed on ${result.weekday}. Suggest another date.`,
      });
    }

    return JSON.stringify({
      date: result.date,
      slotCount: result.slots.length,
      slots: result.slots.map((slot) => ({
        professionalId: slot.professionalId,
        professionalName: slot.professionalName,
        start: this.toClinicISO(slot.start),
        end: this.toClinicISO(slot.end),
      })),
    });
  }

  private async bookAppointment(rawArguments: string): Promise<string> {
    const args = this.parseArguments(bookAppointmentArgsSchema, rawArguments);
    if (typeof args === 'string') {
      return args;
    }

    const confirmation = await this.bookingService.bookAppointment(args);
    return JSON.stringify({
      booked: true,
      eventId: confirmation.eventId,
      serviceName: confirmation.serviceName,
      professionalName: confirmation.professionalName,
      start: this.toClinicISO(confirmation.start),
      end: this.toClinicISO(confirmation.end),
    });
  }

  private parseArguments<T extends z.ZodTypeAny>(
    schema: T,
    rawArguments: string,
  ): z.infer<T> | string {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawArguments);
    } catch {
      return JSON.stringify({
        error: 'INVALID_ARGUMENTS',
        message: 'Tool arguments were not valid JSON.',
      });
    }

    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return JSON.stringify({
        error: 'INVALID_ARGUMENTS',
        message: `Invalid tool arguments: ${issues}`,
      });
    }
    return result.data as z.infer<T>;
  }

  private toClinicISO(date: Date): string {
    return (
      DateTime.fromJSDate(date)
        .setZone(this.config.clinicTimezone)
        .toISO({ suppressMilliseconds: true }) ?? date.toISOString()
    );
  }
}
