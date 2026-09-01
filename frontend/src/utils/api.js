/**
 * Reading a response, without assuming it is what was asked for.
 *
 * On the desktop a request to /api/... reaches the backend. Inside the Android
 * shell there is no backend at the app's own origin, and Capacitor's local
 * server answers any path whose last segment has no dot with index.html and
 * status 200. So the app asked for its message list and was handed its own
 * HTML page, with res.ok true. Parsing that produced an object, the object was
 * put into state that the render maps over, and the whole app died on
 * "d.map is not a function" before anything was drawn.
 *
 * Two things follow from that, and both are here:
 *
 *   * a 200 is not a promise that the body is JSON, so say so when it is not;
 *   * a list must stay a list, whatever came back.
 */

const looksLikeHtml = (text) => /^\s*(<!doctype|<html)/i.test(text);

export const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      detail: looksLikeHtml(text)
        // Worth naming exactly: this is the app's own page coming back, which
        // means nothing is serving the API at this address.
        ? 'No SMARAN.AI backend answered at this address.'
        : 'The server returned an invalid response.',
      not_json: true,
    };
  }
};

/**
 * Whatever came back, as a list.
 *
 * For state the interface renders with .map(). An error body, a null, or a
 * page of HTML all become an empty list rather than a crash that replaces the
 * entire app with an error screen.
 */
export const asList = (value) => (Array.isArray(value) ? value : []);

export const getApiUrl = (path) => `${import.meta.env.VITE_API_BASE_URL || ''}${path}`;
