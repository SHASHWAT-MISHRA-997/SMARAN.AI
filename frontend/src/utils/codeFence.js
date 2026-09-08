const sourceLanguages = new Set(('js javascript ts typescript jsx tsx python py html htm svg xml css scss json yaml yml toml sql sh bash shell zsh powershell ps1 bat c cpp csharp cs java kotlin kt swift go rust rs ruby rb php r lua dart dockerfile makefile diff vue svelte').split(' '));

export const parseCodeFence = (part) => {
  // The language is on the same line as the opening fence. Trimming before
  // reading it mistakenly consumed a single-word first line of ordinary text.
  const normalized = part.replace(/\r\n/g, '\n');
  const newline = normalized.indexOf('\n');
  const header = newline >= 0 ? normalized.slice(0, newline).trim() : '';
  const tagged = /^[\w#+.-]+$/.test(header);
  const language = tagged ? header : '';
  return {
    language,
    code: (tagged ? normalized.slice(newline + 1) : normalized).trim(),
    isSource: sourceLanguages.has(language.toLowerCase()),
  };
};
