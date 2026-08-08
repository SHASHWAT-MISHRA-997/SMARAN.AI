export const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { detail: 'The server returned an invalid response.' };
  }
};

export const getApiUrl = (path) => `${import.meta.env.VITE_API_BASE_URL || ''}${path}`;
