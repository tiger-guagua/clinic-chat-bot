import type { BusyInterval } from '../domain/types';

const MS_PER_MINUTE = 60_000;

export interface FreeStartsInput {
  openTime: Date;
  closeTime: Date;
  slotIntervalMinutes: number;
  serviceDurationMinutes: number;
  busyIntervals: readonly BusyInterval[];
  earliestStart?: Date;
}

export function overlaps(
  start: Date,
  end: Date,
  busyInterval: BusyInterval,
): boolean {
  return (
    start.getTime() < busyInterval.end.getTime() &&
    end.getTime() > busyInterval.start.getTime()
  );
}

export function isSlotFree(
  start: Date,
  end: Date,
  busyIntervals: readonly BusyInterval[],
): boolean {
  return !busyIntervals.some((busyInterval) => overlaps(start, end, busyInterval));
}

/**
 * Returns every candidate start time (ascending) at which the full service
 * duration fits as one continuous free window inside clinic hours.
 */
export function calculateFreeStarts(input: FreeStartsInput): Date[] {
  const durationMs = input.serviceDurationMinutes * MS_PER_MINUTE;
  const intervalMs = input.slotIntervalMinutes * MS_PER_MINUTE;
  const closeMs = input.closeTime.getTime();

  const freeStarts: Date[] = [];

  for (
    let startMs = input.openTime.getTime();
    startMs < closeMs;
    startMs += intervalMs
  ) {
    const endMs = startMs + durationMs;
    if (endMs > closeMs) {
      break;
    }
    if (input.earliestStart && startMs < input.earliestStart.getTime()) {
      continue;
    }

    const start = new Date(startMs);
    const end = new Date(endMs);
    if (isSlotFree(start, end, input.busyIntervals)) {
      freeStarts.push(start);
    }
  }

  return freeStarts;
}
