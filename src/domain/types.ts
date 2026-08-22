export type ServiceId = 'A' | 'B' | 'C' | 'D' | 'E';

export type ProfessionalId = 'junior' | 'senior1' | 'senior2';

export type CalendarProviderId = 'google' | 'outlook';

export interface Service {
  id: ServiceId;
  name: string;
  durationMinutes: number;
  professionals: readonly ProfessionalId[];
}

export interface Professional {
  id: ProfessionalId;
  displayName: string;
  calendarProviderId: CalendarProviderId;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface Slot {
  professionalId: ProfessionalId;
  professionalName: string;
  start: Date;
  end: Date;
}
