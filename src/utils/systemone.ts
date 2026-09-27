export type SystemOneState = Record<string, any> | any[] | string;
export type SystemOneQuestions = Record<string, any>;

export interface SystemOnePayload {
  state: SystemOneState;
  model: 'kev-latest';
  questions: SystemOneQuestions;
}

export interface SystemOneOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SystemOneParams {
  state: SystemOneState;
  questions: SystemOneQuestions;
  model?: string;
}

/**
 * Wraps the Kev SystemOne HTTP API endpoint.
 *
 * Endpoint: POST https://kev.gogingko.net/v1/systemone
 * Payload schema:
 *   - state: dict, list, or string representing input info that needs to decide
 *   - model: always string 'kev-latest'
 *   - questions: dict of questions
 *
 * Supports both call styles:
 *   1. callSystemOne(state, questions, options?)
 *   2. callSystemOne({ state, questions }, options?)
 *
 * @param stateOrParams Either the `state` value, or a `{ state, questions }` parameters object
 * @param questionsArg The questions dictionary (when using positional arguments)
 * @param optionsArg Additional request options (headers, abort signal, timeout in ms)
 * @returns Promise resolving to the parsed JSON response
 */
export async function callSystemOne<T = any>(
  stateOrParams: SystemOneState | SystemOneParams,
  questionsArg?: SystemOneQuestions | SystemOneOptions,
  optionsArg?: SystemOneOptions
): Promise<T> {
  let state: SystemOneState;
  let questions: SystemOneQuestions;
  let options: SystemOneOptions | undefined;

  // Detect whether first argument is a parameter object { state, questions }
  if (
    stateOrParams !== null &&
    typeof stateOrParams === 'object' &&
    !Array.isArray(stateOrParams) &&
    'state' in stateOrParams &&
    'questions' in stateOrParams
  ) {
    const params = stateOrParams as SystemOneParams;
    state = params.state;
    questions = params.questions;
    options = questionsArg as SystemOneOptions | undefined;
  } else {
    state = stateOrParams as SystemOneState;
    questions = (questionsArg as SystemOneQuestions) || {};
    options = optionsArg;
  }

  const endpointUrl = 'https://kev.gogingko.net/v1/systemone';
  const payload: SystemOnePayload = {
    state,
    model: 'kev-latest',
    questions: questions || {}
  };

  const timeoutMs = options?.timeoutMs ?? 150000;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const signal = options?.signal || controller?.signal;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  if (controller && timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options?.headers || {})
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      let errText = '';
      try {
        errText = await response.text();
      } catch {
        // ignore body read error
      }
      throw new Error(
        `SystemOne API request failed with status ${response.status}: ${errText || response.statusText}`
      );
    }

    return (await response.json()) as T;
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }
}

/**
 * Convenient alias for callSystemOne
 */
export const querySystemOne = callSystemOne;
