/* Web research events from the chat stream (backend/app/answer_engine.py),
   folded into the message they belong to.

     research_step     {stage: search|read|done, text, queries?, sources?}
     research_sources  {mode, focus, queries, seconds, sources: [{n,title,url,domain,date,snippet,read}]}
     research_check    {verification, related}

   The sources become the message's references - numbered as the answer cites
   them, so [n] in the text opens source n - and the steps show what is
   happening while the answer is still being prepared. */

export function isResearchEvent(event) {
  return Boolean(event && typeof event.type === 'string' && event.type.startsWith('research_'));
}

export function applyResearchEvent(message, event) {
  if (!isResearchEvent(event)) return message;
  if (event.type === 'research_step') {
    const steps = [...(message.researchSteps || []).filter((s) => s.stage !== event.stage || s.round !== event.round),
      { stage: event.stage, round: event.round, text: event.text, queries: event.queries, sources: event.sources }];
    return { ...message, researchSteps: steps };
  }
  if (event.type === 'research_sources') {
    const sources = Array.isArray(event.sources) ? event.sources : [];
    return {
      ...message,
      references: sources.map((src) => ({
        document_name: src.title, url: src.url, text: src.snippet, n: src.n, domain: src.domain, date: src.date,
      })),
      research: {
        mode: event.mode,
        focus: event.focus,
        queries: event.queries || [],
        sources: sources.length,
        read: sources.filter((s) => s.read).length,
        seconds: event.seconds,
      },
    };
  }
  if (event.type === 'research_check') {
    return {
      ...message,
      related: Array.isArray(event.related) ? event.related : [],
      verification: event.verification || null,
    };
  }
  return message;
}
