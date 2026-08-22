import { describe, expect, it } from 'vitest';
import { calculateFreeStarts } from '../src/booking/SlotCalculator';

const DATE = '2026-09-02';

function at(time: string): Date {
  return new Date(`${DATE}T${time}:00+08:00`);
}

function baseInput(overrides: Partial<Parameters<typeof calculateFreeStarts>[0]> = {}) {
  return {
    openTime: at('09:00'),
    closeTime: at('18:00'),
    slotIntervalMinutes: 30,
    serviceDurationMinutes: 60,
    busyIntervals: [],
    ...overrides,
  };
}

describe('calculateFreeStarts', () => {
  it('offers every candidate when a 60-minute service fits a fully free day', () => {
    const starts = calculateFreeStarts(baseInput());

    expect(starts).toHaveLength(17);
    expect(starts[0]).toEqual(at('09:00'));
    expect(starts[starts.length - 1]).toEqual(at('17:00'));
  });

  it('removes candidates overlapping a busy interval', () => {
    const starts = calculateFreeStarts(
      baseInput({ busyIntervals: [{ start: at('10:00'), end: at('11:00') }] }),
    );

    expect(starts).not.toContainEqual(at('09:30'));
    expect(starts).not.toContainEqual(at('10:00'));
    expect(starts).not.toContainEqual(at('10:30'));
    expect(starts).toContainEqual(at('09:00'));
    expect(starts).toContainEqual(at('11:00'));
  });

  it('rejects candidates that would end after clinic close', () => {
    const starts = calculateFreeStarts(baseInput());

    expect(starts).not.toContainEqual(at('17:30'));
    expect(starts[starts.length - 1]).toEqual(at('17:00'));
  });

  it('requires full continuous availability for a 150-minute service', () => {
    const starts = calculateFreeStarts(
      baseInput({
        serviceDurationMinutes: 150,
        busyIntervals: [{ start: at('12:00'), end: at('12:30') }],
      }),
    );

    // 09:30 ends exactly at the busy start; 12:30 starts exactly at the busy end.
    expect(starts).toContainEqual(at('09:30'));
    expect(starts).toContainEqual(at('12:30'));
    // Anything whose 150-minute window crosses 12:00-12:30 is rejected.
    expect(starts).not.toContainEqual(at('10:00'));
    expect(starts).not.toContainEqual(at('11:00'));
    expect(starts).not.toContainEqual(at('12:00'));
  });

  it('requires a continuous 6-hour window for a 360-minute service', () => {
    const freeDay = calculateFreeStarts(baseInput({ serviceDurationMinutes: 360 }));
    expect(freeDay[0]).toEqual(at('09:00'));
    expect(freeDay[freeDay.length - 1]).toEqual(at('12:00'));

    // One 30-minute booking in the middle of the day kills every 6-hour window.
    const brokenDay = calculateFreeStarts(
      baseInput({
        serviceDurationMinutes: 360,
        busyIntervals: [{ start: at('13:00'), end: at('13:30') }],
      }),
    );
    expect(brokenDay).toHaveLength(0);
  });

  it('treats busy interval boundaries as non-overlapping', () => {
    const starts = calculateFreeStarts(
      baseInput({ busyIntervals: [{ start: at('10:00'), end: at('11:00') }] }),
    );

    // Ends exactly at busy start / starts exactly at busy end: both allowed.
    expect(starts).toContainEqual(at('09:00'));
    expect(starts).toContainEqual(at('11:00'));
  });

  it('skips candidates earlier than earliestStart', () => {
    const starts = calculateFreeStarts(baseInput({ earliestStart: at('10:15') }));

    expect(starts[0]).toEqual(at('10:30'));
  });
});
