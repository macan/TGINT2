/**
 * Runtime API Backend Capability Probe
 *
 * Uses a single safe GET request (/api/gemini/status) to detect whether a live
 * server/edge API backend (Node Express or Cloudflare Pages/Worker route) is
 * mounted, avoiding POST 405 Method Not Allowed errors on static deployments
 * such as Cloudflare Workers Static Assets.
 */

export interface ApiBackendCapabilities {
  hasApiBackend: boolean;
  serverHasGeminiKey: boolean;
  defaultModel?: string;
}

let cachedCapabilities: ApiBackendCapabilities | null = null;
let inFlightProbe: Promise<ApiBackendCapabilities> | null = null;

export async function probeApiBackend(forceRefresh = false): Promise<ApiBackendCapabilities> {
  if (!forceRefresh && cachedCapabilities) {
    return cachedCapabilities;
  }
  if (!forceRefresh && inFlightProbe) {
    return inFlightProbe;
  }

  inFlightProbe = (async (): Promise<ApiBackendCapabilities> => {
    try {
      const res = await fetch('/api/gemini/status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || !contentType.includes('application/json')) {
        // Static SPA rewrites return 200 text/html (index.html), or static hosts return 404/405
        const result: ApiBackendCapabilities = {
          hasApiBackend: false,
          serverHasGeminiKey: false,
        };
        cachedCapabilities = result;
        return result;
      }

      const data = await res.json().catch(() => null);
      if (!data || typeof data.available !== 'boolean') {
        const result: ApiBackendCapabilities = {
          hasApiBackend: false,
          serverHasGeminiKey: false,
        };
        cachedCapabilities = result;
        return result;
      }

      const result: ApiBackendCapabilities = {
        hasApiBackend: true,
        serverHasGeminiKey: Boolean(data.available),
        defaultModel: typeof data.defaultModel === 'string' ? data.defaultModel : undefined,
      };
      cachedCapabilities = result;
      return result;
    } catch {
      const result: ApiBackendCapabilities = {
        hasApiBackend: false,
        serverHasGeminiKey: false,
      };
      cachedCapabilities = result;
      return result;
    } finally {
      inFlightProbe = null;
    }
  })();

  return inFlightProbe;
}

export function resetApiBackendProbeCache(): void {
  cachedCapabilities = null;
  inFlightProbe = null;
}
