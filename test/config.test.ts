import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.clinicTimezone).toBe('Asia/Taipei');
    expect(config.clinicOpenHour).toBe('09:00');
    expect(config.clinicCloseHour).toBe('18:00');
    expect(config.slotIntervalMinutes).toBe(30);
    expect(config.clinicClosedWeekdays).toEqual(['sunday']);
  });

  it('reads explicit values', () => {
    const config = loadConfig({
      PORT: '8080',
      CLINIC_TIMEZONE: 'Asia/Singapore',
      CLINIC_OPEN_HOUR: '08:30',
      CLINIC_CLOSE_HOUR: '17:00',
      SLOT_INTERVAL_MINUTES: '15',
      CLINIC_CLOSED_WEEKDAYS: 'sunday, Monday',
    });

    expect(config.port).toBe(8080);
    expect(config.clinicTimezone).toBe('Asia/Singapore');
    expect(config.clinicOpenHour).toBe('08:30');
    expect(config.clinicCloseHour).toBe('17:00');
    expect(config.slotIntervalMinutes).toBe(15);
    expect(config.clinicClosedWeekdays).toEqual(['sunday', 'monday']);
  });

  it('treats an empty closed-weekdays value as open every day', () => {
    const config = loadConfig({ CLINIC_CLOSED_WEEKDAYS: '' });

    expect(config.clinicClosedWeekdays).toEqual([]);
  });

  it('rejects a malformed open hour', () => {
    expect(() => loadConfig({ CLINIC_OPEN_HOUR: '9am' })).toThrow(ConfigError);
  });

  it('rejects an open hour that is not earlier than the close hour', () => {
    expect(() =>
      loadConfig({ CLINIC_OPEN_HOUR: '18:00', CLINIC_CLOSE_HOUR: '09:00' }),
    ).toThrow(ConfigError);
  });

  it('rejects an unknown closed weekday', () => {
    expect(() => loadConfig({ CLINIC_CLOSED_WEEKDAYS: 'funday' })).toThrow(
      ConfigError,
    );
  });

  it('rejects an invalid timezone', () => {
    expect(() => loadConfig({ CLINIC_TIMEZONE: 'Mars/Olympus' })).toThrow(
      ConfigError,
    );
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
  });
});
