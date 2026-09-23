// 领域模型：记录器、事件、观测

export interface RecorderInput {
  id: number;
  reference?: boolean;
  offsetMin?: number | string;
  offsetMax?: number | string;
}

export interface EventInput {
  id: number;
  recorder: number;
  localTime: number | string;
}

export interface ObservationInput {
  id: number;
  send: number;
  receive: number;
  delayMin?: number | string;
  delayMax?: number | string;
}

export interface ModelInput {
  recorders: RecorderInput[];
  events: EventInput[];
  observations: ObservationInput[];
}

export interface Recorder {
  id: number;
  reference: boolean;
  offsetMin: number;
  offsetMax: number;
}

export interface PulseEvent {
  id: number;
  recorder: number;
  localTime: number;
}

export interface Observation {
  id: number;
  send: number;
  receive: number;
  delayMin: number;
  delayMax: number;
}

export interface Model {
  recorders: Recorder[];
  events: PulseEvent[];
  observations: Observation[];
}

export const LIMIT = 1_000_000_000;
export const MAX_RECORDERS = 24;
export const MAX_EVENTS = 128;
export const MAX_OBSERVATIONS = 256;
