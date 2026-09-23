import type { ModelInput } from './types';

export const SAMPLE_MULTI: ModelInput = {
  recorders: [
    { id: 1, reference: true },
    { id: 2, offsetMin: -10, offsetMax: 10 },
    { id: 3, offsetMin: -10, offsetMax: 10 },
  ],
  events: [
    { id: 10, recorder: 1, localTime: 0 },
    { id: 11, recorder: 2, localTime: 5 },
    { id: 12, recorder: 3, localTime: 6 },
  ],
  observations: [
    { id: 100, send: 10, receive: 11, delayMin: 0, delayMax: 10 },
    { id: 101, send: 10, receive: 12, delayMin: 0, delayMax: 10 },
  ],
};

export const SAMPLE_UNIQUE: ModelInput = {
  recorders: [
    { id: 1, reference: true },
    { id: 2, offsetMin: -50, offsetMax: 50 },
    { id: 3, offsetMin: -50, offsetMax: 50 },
  ],
  events: [
    { id: 201, recorder: 1, localTime: 1000 },
    { id: 202, recorder: 2, localTime: 1030 },
    { id: 203, recorder: 3, localTime: 1070 },
    { id: 204, recorder: 1, localTime: 1200 },
  ],
  observations: [
    { id: 501, send: 201, receive: 202, delayMin: 30, delayMax: 30 },
    { id: 502, send: 202, receive: 203, delayMin: 40, delayMax: 40 },
    { id: 503, send: 203, receive: 204, delayMin: 130, delayMax: 130 },
  ],
};

export const SAMPLE_INFEASIBLE: ModelInput = {
  recorders: [
    { id: 1, reference: true },
    { id: 2, offsetMin: -10, offsetMax: 10 },
    { id: 3, offsetMin: -10, offsetMax: 10 },
  ],
  events: [
    { id: 301, recorder: 1, localTime: 0 },
    { id: 302, recorder: 2, localTime: 0 },
    { id: 303, recorder: 3, localTime: 0 },
    { id: 304, recorder: 1, localTime: 5 },
  ],
  observations: [
    { id: 601, send: 301, receive: 302, delayMin: 0, delayMax: 0 },
    { id: 602, send: 302, receive: 303, delayMin: 0, delayMax: 0 },
    { id: 603, send: 303, receive: 304, delayMin: 0, delayMax: 3 },
  ],
};

export const SAMPLE_INVALID: unknown = {
  recorders: [
    { id: 1, offsetMin: 5, offsetMax: 1 },
    { id: 1, offsetMin: 0, offsetMax: 0 },
  ],
  events: [
    { id: 10, recorder: 1, localTime: 0 },
    { id: 10, recorder: 9, localTime: 0 },
    { id: 11, recorder: 1, localTime: 0 },
  ],
  observations: [
    { id: 100, send: 10, receive: 11, delayMin: 3, delayMax: 2 },
    { id: 101, send: 10, receive: 999 },
  ],
};

export const EMPTY_MODEL: ModelInput = {
  recorders: [
    { id: 1, reference: true },
    { id: 2, offsetMin: -1000000000, offsetMax: 1000000000 },
  ],
  events: [
    { id: 10, recorder: 1, localTime: 0 },
    { id: 11, recorder: 2, localTime: 0 },
  ],
  observations: [{ id: 100, send: 10, receive: 11, delayMin: 0, delayMax: 1000000000 }],
};
