import type { Professional, ProfessionalId, Service, ServiceId } from './types';

export const SERVICES: Record<ServiceId, Service> = {
  A: {
    id: 'A',
    name: 'Service A',
    durationMinutes: 60,
    professionals: ['junior', 'senior1', 'senior2'],
  },
  B: {
    id: 'B',
    name: 'Service B',
    durationMinutes: 60,
    professionals: ['junior', 'senior1', 'senior2'],
  },
  C: {
    id: 'C',
    name: 'Service C',
    durationMinutes: 150,
    professionals: ['senior1', 'senior2'],
  },
  D: {
    id: 'D',
    name: 'Service D',
    durationMinutes: 120,
    professionals: ['senior1', 'senior2'],
  },
  E: {
    id: 'E',
    name: 'Service E',
    durationMinutes: 360,
    professionals: ['senior1', 'senior2'],
  },
};

export const PROFESSIONALS: Record<ProfessionalId, Professional> = {
  junior: {
    id: 'junior',
    displayName: 'Junior',
    calendarProviderId: 'google',
  },
  senior1: {
    id: 'senior1',
    displayName: 'Senior 1',
    calendarProviderId: 'google',
  },
  senior2: {
    id: 'senior2',
    displayName: 'Senior 2',
    calendarProviderId: 'outlook',
  },
};

// IDs arrive from the LLM, which mixes case ("Junior", "c"); normalize before lookup.
export function getService(serviceId: string): Service | undefined {
  return (SERVICES as Record<string, Service | undefined>)[serviceId.trim().toUpperCase()];
}

export function getProfessional(professionalId: string): Professional | undefined {
  return (PROFESSIONALS as Record<string, Professional | undefined>)[professionalId.trim().toLowerCase()];
}

export function isEligible(service: Service, professionalId: ProfessionalId): boolean {
  return service.professionals.includes(professionalId);
}

export function getEligibleProfessionals(service: Service): Professional[] {
  return service.professionals.map((professionalId) => PROFESSIONALS[professionalId]);
}
