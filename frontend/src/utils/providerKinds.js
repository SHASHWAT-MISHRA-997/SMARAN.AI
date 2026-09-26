/* Providers whose key is saved like any other but which do not hold a
   conversation: Replicate makes videos, TypeSafe (Jev) returns typed
   decisions, not text. Offering their models for chat, Design or Compare -
   or trying them as a chat fallback - could only end in an error. */
export const NOT_CHAT_PROVIDERS = new Set(['replicate', 'typesafe']);

export const isChatProvider = (provider) => !NOT_CHAT_PROVIDERS.has(String(provider || '').toLowerCase());
