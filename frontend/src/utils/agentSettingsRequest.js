import { API_BASE, fetchWithAuth } from '../context/AuthContext';

// Settings operations must finish or report an error, including JSON decoding.
export async function agentSettingsRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/agent${path}`, {
      ...options, signal: controller.signal,
    });
    const data = await response.json().catch(() => {
      if (response.ok) throw new Error('The server returned an invalid response. Please retry.');
      return {};
    });
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : '';
      throw new Error(detail || `Request failed (${response.status}). Please retry.`);
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Request timed out. Check the connection and retry.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
