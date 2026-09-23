package ai.smaran.app;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Was that "Hey SMARAN" - or Amarya, Myra, Jarvis?
 *
 * The offline model (vosk-model-small-en-in) has no words for SMARAN or
 * Amarya, so it writes them down as the nearest English it knows: "hey small
 * run", "he's married", "hey amalia". These lists are those spellings,
 * collected by synthesising the names and reading back what the model heard.
 *
 * Tuned against ordinary speech as much as against the names: on 60 everyday
 * sentences - English, Hinglish, "Hey Siri", "OK Google", "look in the
 * mirror", "she is married now" - it wakes on none, and on 15 of 18 wake
 * phrases. What keeps it quiet:
 *
 *  - The greeting must open the utterance. An assistant is addressed first,
 *    and "every year we travel" or "send it to Travis" never start that way.
 *  - "Hey" heard as "a" or "he's" is weak evidence, so then the name must be
 *    all that was said, or be followed at once by an instruction.
 */
final class WakeWord {
    private WakeWord() { }

    /** A wake phrase that was heard, and whatever was said after it. */
    static final class Heard {
        final String name;
        final String rest;
        Heard(String name, String rest) {
            this.name = name;
            this.rest = rest == null ? "" : rest.trim();
        }
    }

    private static final String GREETING = "(?:hey|hi|hay|ok|okay|hello)";
    private static final String WEAK = "(?:a|he's|hey's)";
    private static final String COMMAND =
        "(?:play|open|search|call|stop|pause|next|skip|what|tell|set|show|turn|start|close)";

    private static final Map<String, String> NAMES = new LinkedHashMap<>();
    static {
        NAMES.put("smaran", "(?:smaran|smart run|small run|some run|summer run|sam ran|smile and|smile run"
            + "|is marin|s marin|marin|married|morale|my run|smarter|some ran|summer ran)");
        NAMES.put("amarya", "(?:amarya|a maria|amalia|a mario|a marie|m a year|m\\. a year|more year"
            + "|a more year|amar ya)");
        NAMES.put("myra", "(?:myra|mira|mirror|maira|my ra)");
        NAMES.put("jarvis", "(?:jarvis|jervis|jarvi's)");
    }

    private static final Map<String, Pattern[]> PATTERNS = new LinkedHashMap<>();
    static {
        for (Map.Entry<String, String> entry : NAMES.entrySet()) {
            String alt = entry.getValue();
            PATTERNS.put(entry.getKey(), new Pattern[] {
                Pattern.compile("^(?:" + GREETING + "\\s+)?" + GREETING + "\\s+" + alt + "\\b(.*)$"),
                Pattern.compile("^" + WEAK + "\\s+" + alt + "(?:$|\\s+(" + COMMAND + "\\b.*)$)"),
            });
        }
    }
    /* Said on their own, these are the name. Jarvis is distinctive enough; the
       others are how the model wrote "Hey SMARAN" in the owner's voice, in a
       room with a TV on. Whole utterance only - never in words still arriving,
       where "here's more on..." is how a news anchor starts a sentence. */
    private static final Pattern ALONE = Pattern.compile(
        "^(?:jarvis\\b(.*)|(?:here's|he's|his|hey's) (?:more on|marin|morning|more ron)$)");

    /* While words are still arriving. The model ends an utterance only after a
       clear pause, and with music or a TV on that pause may never come - so
       "Hey SMARAN" said over a song was never checked at all. Words in
       progress are checked too, but only for a strong greeting ("hey", "ok",
       "hello"...) directly followed by the name, somewhere in the last few
       words: weak evidence ("a", "he's") still needs the whole utterance. */
    private static final Map<String, Pattern> TAIL = new LinkedHashMap<>();
    static {
        for (Map.Entry<String, String> entry : NAMES.entrySet()) {
            TAIL.put(entry.getKey(), Pattern.compile(
                "(?:^|\\s)" + GREETING + "\\s+" + entry.getValue() + "(?:\\s|$)"));
        }
    }
    private static final int TAIL_WORDS = 7;

    // ── the second look, for "Hey SMARAN" ──────────────────────────────────

    /* The model has no word for SMARAN, and in the owner's voice it wrote a
       different English phrase every time: "here's my run", "a salad and",
       "a small", or just "hey". So a short utterance that starts like a
       greeting is decoded again, from the same audio, against a handful of
       phrases only - the spellings the name comes out as, the other names so
       they compete, and [unk] for anything else. Held to that list, the model
       picks the nearest phrase instead of inventing English.

       Only a SMARAN phrase is accepted from it. The others already wake
       reliably from the first pass, and accepting them here let "hey man"
       through as Myra. */
    static final String[] SMARAN_PHRASES = {
        "hey small run", "hey some run", "hey summer run", "hey smart run", "here's my run",
        "here's more on", "hey smile and", "hey is my run", "hey smile run",
    };
    private static final String[] OTHER_PHRASES = {
        "hey a maria", "hey amalia", "hey myra", "hey mirror", "a mirror", "hey jarvis",
    };

    static String secondLookGrammar() {
        StringBuilder json = new StringBuilder("[");
        for (String phrase : SMARAN_PHRASES) json.append('"').append(phrase).append("\",");
        for (String phrase : OTHER_PHRASES) json.append('"').append(phrase).append("\",");
        return json.append("\"[unk]\"]").toString();
    }

    private static final Pattern GATE = Pattern.compile(
        "^(?:hey|hi|hay|here's|he's|his|hey's|a|ok|okay|hello)\\b");

    /** Worth a second look: short, and opening the way a greeting does. */
    static boolean worthSecondLook(String transcript) {
        if (transcript == null) return false;
        String text = transcript.toLowerCase(Locale.ROOT).trim();
        return !text.isEmpty() && text.split("\\s+").length <= 4 && GATE.matcher(text).find();
    }

    /** Whether the second look's result is a SMARAN phrase ([unk] around it ignored). */
    static boolean secondLookSaysSmaran(String result) {
        if (result == null) return false;
        String core = result.toLowerCase(Locale.ROOT).replace("[unk]", " ").replaceAll("\\s+", " ").trim();
        for (String phrase : SMARAN_PHRASES) if (phrase.equals(core)) return true;
        return false;
    }

    /** A strong greeting and a name among the latest words, or null. */
    static Heard matchPartial(String partial) {
        if (partial == null) return null;
        String text = partial.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) return null;
        String[] words = text.split(" ");
        int from = Math.max(0, words.length - TAIL_WORDS);
        String tail = String.join(" ", java.util.Arrays.copyOfRange(words, from, words.length));
        for (Map.Entry<String, Pattern> entry : TAIL.entrySet()) {
            if (entry.getValue().matcher(tail).find()) return new Heard(entry.getKey(), "");
        }
        return null;
    }

    /** The wake phrase at the start of this transcript, or null. */
    static Heard match(String transcript) {
        if (transcript == null) return null;
        // "[unk]" stays: something said before the greeting means the name was
        // not what opened the utterance, and the anchor must fail.
        String text = transcript.toLowerCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
        if (text.isEmpty()) return null;
        for (Map.Entry<String, Pattern[]> entry : PATTERNS.entrySet()) {
            for (Pattern pattern : entry.getValue()) {
                Matcher m = pattern.matcher(text);
                if (m.find()) return new Heard(entry.getKey(), m.group(1));
            }
        }
        Matcher alone = ALONE.matcher(text);
        if (!alone.find()) return null;
        return alone.group(1) != null ? new Heard("jarvis", alone.group(1)) : new Heard("smaran", "");
    }
}
