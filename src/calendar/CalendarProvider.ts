import type { BusyInterval } from '../domain/types';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
}

export interface CalendarProvider {
  getBusyIntervals(input: {
    calendarId: string;
    from: Date;
    to: Date;
  }): Promise<BusyInterval[]>;

  createEvent(input: {
    calendarId: string;
    title: string;
    start: Date;
    end: Date;
    description?: string;
  }): Promise<CalendarEvent>;
}
