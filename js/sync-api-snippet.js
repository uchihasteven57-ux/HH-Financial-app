  async function api(action, payload = {}) {
    if (!state.settings.syncUrl) throw Error('Add the Apps Script URL first.');

    // text/plain avoids the browser CORS preflight that Apps Script web apps do not handle.
    const response = await fetch(state.settings.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, payload))
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw Error(result.error || `Sync failed (${response.status})`);
    return result.data || result;
  }
