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
    /** Jarvis is distinctive enough to be said on its own. */
    private static final Pattern ALONE = Pattern.compile("^jarvis\\b(.*)$");

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
        return alone.find() ? new Heard("jarvis", alone.group(1)) : null;
    }
}
