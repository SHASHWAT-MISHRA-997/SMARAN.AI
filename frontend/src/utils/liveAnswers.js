/* Time, date, weather and news - answered from the phone and the internet,
 * not from a language model.
 *
 * Asked "what time is it?", the model replied "check the clock on your device":
 * it has no clock, no location and no news, and says so. The phone has all
 * three. So these four questions are answered here, before the model:
 *
 *   time / date  the phone's own clock
 *   weather      Open-Meteo (free, no key): a named city is looked up by its
 *                geocoder; otherwise the phone's location, if allowed, else
 *                wttr.in's estimate from the network
 *   news         Google News' public RSS feed for India, or a topic search
 *
 * detectLiveQuestion() is pure and tested; answerLiveQuestion() does the
 * fetching. Anything it cannot answer returns null, and the question goes to
 * the model as before.
 */

const HI = /[ऀ-ॿ]/;
const HINGLISH = /\b(?:kya|kitne|kitna|baje|batao|bata|aaj|kal|mausam|kaisa|kaisi|hai|hain|mein|me|ka|ki|ke|khabar|khabre|khabrein|samachar|din|tarikh|abhi)\b/i;

export function languageOf(text) {
  const t = String(text || '');
  if (HI.test(t)) return 'hi';
  if (HINGLISH.test(t)) return 'hinglish';
  return 'en';
}

const TIME = /\b(?:what(?:'s|\s+is)?\s+(?:the\s+)?time|time\s+(?:is\s+it|now|please|kya|batao|bata\s+do)|kya\s+time|kitne\s+baje|kitna\s+baja|current\s+time|samay\s+kya|tell\s+me\s+the\s+time)\b|समय\s+क्या|कितने\s+बजे|टाइम\s+क्या/i;
const DATE = /\b(?:what(?:'s|\s+is)?\s+(?:the\s+|today'?s\s+)?date|today'?s\s+date|what\s+day\s+is\s+(?:it|today)|which\s+day\s+is\s+(?:it|today)|aaj\s+(?:ki\s+)?(?:date|tarikh|taarikh)|aaj\s+(?:kya|kaun\s*sa)\s+din|kaun\s*sa\s+din\s+hai|date\s+(?:kya|batao))\b|आज\s+(?:की\s+)?(?:तारीख|डेट)|आज\s+कौन\s+सा\s+दिन/i;
const WEATHER = /\b(?:weather|mausam|temperature|forecast|tapman|kitni\s+garmi|kitni\s+thand|barish|baarish|will\s+it\s+rain|is\s+it\s+(?:going\s+to\s+)?rain(?:ing)?)\b|मौसम|तापमान|बारिश/i;
const NEWS = /\b(?:news|headlines?|khabar|khabre|khabrein|samachar)\b|ख़बर|खबर|समाचार|न्यूज़/i;

// Words that sit around a place name and are not part of it.
const FILLER = /\b(?:what(?:'s|\s+is)?|how(?:'s|\s+is)?|the|weather|mausam|temperature|forecast|like|today|now|right|currently|tell|me|please|in|at|for|of|kaisa|kaisi|hai|hain|aaj|abhi|ka|ki|ke|mein|me|batao|bata|do|kya|is|it|will|rain|going|to|tapman|barish|baarish|news|headlines?|latest|top|khabar|khabre|khabrein|samachar|about|on|sunao|dikhao|give|show|any|some|sab|se|nayi|new|abhi\s+ki)\b/gi;

function leftover(text) {
  return String(text || '')
    .replace(/[?.!,।]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which live question this is, if any: {kind, place?, topic?, lang}. */
export function detectLiveQuestion(utterance) {
  const text = String(utterance || '').trim();
  if (!text || text.length > 160) return null;
  const lang = languageOf(text);
  if (WEATHER.test(text)) {
    // "weather in Delhi", "Delhi ka mausam", "mausam Mumbai mein"
    const place = leftover(text);
    return { kind: 'weather', place: /^[\p{L} .'-]{2,40}$/u.test(place) ? place : '', lang };
  }
  if (NEWS.test(text)) {
    const topic = leftover(text);
    return { kind: 'news', topic: topic.length >= 2 && topic.length <= 40 ? topic : '', lang };
  }
  if (TIME.test(text)) return { kind: 'time', lang };
  if (DATE.test(text)) return { kind: 'date', lang };
  return null;
}

/* ------------------------------ time and date ------------------------------ */

export function sayTime(now, lang) {
  const h24 = now.getHours();
  const m = now.getMinutes();
  const h12 = h24 % 12 || 12;
  const mm = String(m).padStart(2, '0');
  const ampm = h24 < 12 ? 'AM' : 'PM';
  if (lang === 'hi') return `अभी ${h12}:${mm} ${ampm} बजे हैं।`;
  if (lang === 'hinglish') return `Abhi ${h12}:${mm} ${ampm} baje hain.`;
  return `It's ${h12}:${mm} ${ampm}.`;
}

export function sayDate(now, lang) {
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const text = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (lang === 'hi') return `आज ${text} है।`;
  if (lang === 'hinglish') return `Aaj ${text} hai.`;
  return `Today is ${text}.`;
}

/* --------------------------------- weather --------------------------------- */

// WMO weather codes, as Open-Meteo reports them.
const WMO = {
  0: ['clear sky', 'saaf aasmaan', 'साफ़ आसमान'],
  1: ['mostly clear', 'zyadatar saaf', 'ज़्यादातर साफ़'],
  2: ['partly cloudy', 'thode baadal', 'हल्के बादल'],
  3: ['overcast', 'baadal chhaaye hain', 'बादल छाए हैं'],
  45: ['foggy', 'kohra', 'कोहरा'], 48: ['foggy', 'kohra', 'कोहरा'],
  51: ['light drizzle', 'halki boondabaandi', 'हल्की बूंदाबांदी'], 53: ['drizzle', 'boondabaandi', 'बूंदाबांदी'], 55: ['heavy drizzle', 'tez boondabaandi', 'तेज़ बूंदाबांदी'],
  61: ['light rain', 'halki baarish', 'हल्की बारिश'], 63: ['rain', 'baarish', 'बारिश'], 65: ['heavy rain', 'tez baarish', 'तेज़ बारिश'],
  71: ['light snow', 'halki barf', 'हल्की बर्फ़'], 73: ['snow', 'barf', 'बर्फ़'], 75: ['heavy snow', 'bhaari barf', 'भारी बर्फ़'],
  80: ['rain showers', 'baarish ki bauchhar', 'बारिश की बौछार'], 81: ['rain showers', 'baarish ki bauchhar', 'बारिश की बौछार'], 82: ['heavy showers', 'tez bauchhar', 'तेज़ बौछार'],
  95: ['thunderstorm', 'aandhi-toofan', 'आंधी-तूफ़ान'], 96: ['thunderstorm with hail', 'olon ke saath toofan', 'ओलों के साथ तूफ़ान'], 99: ['thunderstorm with hail', 'olon ke saath toofan', 'ओलों के साथ तूफ़ान'],
};

function describe(code, lang) {
  const row = WMO[code] || ['changing weather', 'badalta mausam', 'बदलता मौसम'];
  return lang === 'hi' ? row[2] : lang === 'hinglish' ? row[1] : row[0];
}

export function sayWeather(w, lang) {
  const t = Math.round(w.temp);
  const hi = Math.round(w.max);
  const lo = Math.round(w.min);
  const rain = w.rainChance;
  const sky = describe(w.code, lang);
  const place = w.place || '';
  if (lang === 'hi') {
    return `${place ? place + ' में ' : ''}अभी ${t}°C है, ${sky}। आज ${lo}° से ${hi}° तक${rain != null ? `, बारिश की संभावना ${rain}%` : ''}।`;
  }
  if (lang === 'hinglish') {
    return `${place ? place + ' mein ' : ''}abhi ${t}°C hai, ${sky}. Aaj ${lo}° se ${hi}° tak rahega${rain != null ? `, baarish ka chance ${rain}%` : ''}.`;
  }
  return `${place ? `In ${place}, it's` : "It's"} ${t}°C and ${sky}. Today ${lo}° to ${hi}°${rain != null ? `, ${rain}% chance of rain` : ''}.`;
}

async function getJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function where() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

async function forecast(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&current=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=auto&forecast_days=1';
  const d = await getJson(url);
  return {
    temp: d.current.temperature_2m,
    code: d.current.weather_code,
    max: d.daily.temperature_2m_max[0],
    min: d.daily.temperature_2m_min[0],
    rainChance: d.daily.precipitation_probability_max?.[0] ?? null,
  };
}

async function weatherFor(q) {
  if (q.place) {
    const geo = await getJson('https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(q.place)}&count=1&language=en&format=json`);
    const hit = geo.results?.[0];
    if (!hit) return null;
    return { ...(await forecast(hit.latitude, hit.longitude)), place: hit.name };
  }
  const here = await where();
  if (here) return forecast(here.lat, here.lon);
  // No location permission: wttr.in estimates the place from the network.
  const d = await getJson('https://wttr.in/?format=j1');
  const now = d.current_condition?.[0];
  const today = d.weather?.[0];
  if (!now || !today) return null;
  const area = d.nearest_area?.[0]?.areaName?.[0]?.value || '';
  return {
    temp: Number(now.temp_C),
    code: -1,
    max: Number(today.maxtempC),
    min: Number(today.mintempC),
    rainChance: Math.max(...(today.hourly || []).map((h) => Number(h.chanceofrain) || 0)),
    place: area,
    text: now.weatherDesc?.[0]?.value || '',
  };
}

/* ----------------------------------- news ---------------------------------- */

export function parseHeadlines(xml, limit = 5) {
  const items = [];
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    let title = m[1].replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    // Google appends " - Publisher"; keep the headline.
    title = title.replace(/\s+-\s+[^-]{2,60}$/, '').trim();
    if (title) items.push(title);
  }
  return items;
}

export function sayNews(headlines, topic, lang) {
  const list = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
  if (lang === 'hi') return `${topic ? topic + ' की ' : ''}ताज़ा ख़बरें:\n${list}`;
  if (lang === 'hinglish') return `${topic ? topic + ' ki ' : ''}taaza khabrein:\n${list}`;
  return `${topic ? `Latest on ${topic}` : 'Top headlines'}:\n${list}`;
}

async function fetchText(url) {
  // Google's feed sends no CORS header, so the page cannot fetch it; the
  // native HTTP client in the Android app can.
  const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
  if (Capacitor?.isNativePlatform?.() && CapacitorHttp) {
    const res = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 8000, readTimeout: 8000 });
    if (res.status >= 200 && res.status < 300) return typeof res.data === 'string' ? res.data : String(res.data);
    throw new Error(String(res.status));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

async function newsFor(q) {
  const hl = q.lang === 'hi' ? 'hi&gl=IN&ceid=IN:hi' : 'en-IN&gl=IN&ceid=IN:en';
  const url = q.topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q.topic)}&hl=${hl}`
    : `https://news.google.com/rss?hl=${hl}`;
  return parseHeadlines(await fetchText(url), 5);
}

/* ---------------------------------- entry ---------------------------------- */

const COULD_NOT = {
  weather: ["I couldn't get the weather right now. Please check your internet and try again.",
    'Abhi mausam ki jaankari nahi mil paayi. Internet check karke dobara poochiye.',
    'अभी मौसम की जानकारी नहीं मिल पाई। इंटरनेट देखकर फिर पूछिए।'],
  news: ["I couldn't get the news right now. Please check your internet and try again.",
    'Abhi khabrein nahi mil paayin. Internet check karke dobara poochiye.',
    'अभी ख़बरें नहीं मिल पाईं। इंटरनेट देखकर फिर पूछिए।'],
  place: ["I couldn't find that place. Which city should I check?",
    'Wo jagah nahi mili. Kaunsa shehar dekhun?',
    'वह जगह नहीं मिली। कौन सा शहर देखूँ?'],
};

const pick = (row, lang) => (lang === 'hi' ? row[2] : lang === 'hinglish' ? row[1] : row[0]);

/**
 * Answer a time / date / weather / news question, or return null so it goes
 * to the model. The answer is text ready to show and speak. With
 * network: false only time and date are answered.
 */
export async function answerLiveQuestion(utterance, now = new Date(), { network = true } = {}) {
  const q = detectLiveQuestion(utterance);
  if (!q) return null;
  if (q.kind === 'time') return sayTime(now, q.lang);
  if (q.kind === 'date') return sayDate(now, q.lang);
  // Weather and news need the internet from this page; where it cannot reach
  // them (the desktop page, whose backend has its own weather action), leave
  // the question to the usual path.
  if (!network) return null;
  try {
    if (q.kind === 'weather') {
      const w = await weatherFor(q);
      if (!w) return pick(COULD_NOT.place, q.lang);
      if (w.code === -1 && w.text) {
        // wttr.in speaks English descriptions; say them plainly.
        return sayWeather({ ...w, code: 2 }, q.lang).replace(describe(2, q.lang), w.text.toLowerCase());
      }
      return sayWeather(w, q.lang);
    }
    const headlines = await newsFor(q);
    return headlines.length ? sayNews(headlines, q.topic, q.lang) : pick(COULD_NOT.news, q.lang);
  } catch {
    return pick(COULD_NOT[q.kind], q.lang);
  }
}
