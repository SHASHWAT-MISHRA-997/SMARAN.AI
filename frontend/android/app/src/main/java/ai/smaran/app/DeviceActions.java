package ai.smaran.app;

import android.app.SearchManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Log;
import android.view.KeyEvent;
import android.media.AudioManager;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What the phone can be asked to do, and how to recognise the asking.
 *
 * Shared by two callers that must never disagree: the plugin, used while the
 * app is on screen, and the listening service, used while it is not. The page
 * has its own copy of these rules in JavaScript for the on-screen case; the
 * service cannot reach that copy, because a stopped activity's WebView is not
 * running, which is the whole reason the service exists.
 *
 * Everything here builds a fixed intent shape from an argument. Nothing takes
 * an action string or a component name from the caller: the text ultimately
 * comes from a microphone, and "start this component" is a far larger surface
 * than "open the app the user named".
 */
final class DeviceActions {
    private static final String TAG = "DeviceActions";

    private DeviceActions() { }

    /** What a spoken line was asking for, if anything. */
    static final class Command {
        final String action;   // app | youtube | music | url
        final String argument; // may be empty
        final String app;      // music only: the service named, or empty
        String lang = "en";    // ask only: the language the question is in
        Command(String action, String argument) {
            this(action, argument, "");
        }
        Command(String action, String argument, String app) {
            this.action = action;
            this.argument = argument == null ? "" : argument;
            this.app = app == null ? "" : app;
        }
    }

    /* Music in a named service: "kesariya Spotify par play karo", "play X on
       Spotify", "Spotify pe X bajao".

       None of these matched before - the music rules want the word "gaana" or
       "song" - so the sentence went to the language model, which answered "I
       cannot directly open Spotify" with a link to search it yourself. Asked
       by name, the play request now goes to that app's package, and Spotify
       starts playing the top match rather than opening a search. */
    static final String[][] MUSIC_SERVICES = {
        // name, package, spoken forms
        {"Spotify", "com.spotify.music", "spotify|\u0938\u094d\u092a\u0949\u091f\u093f\u092b\u093e\u0908|\u0938\u094d\u092a\u094b\u091f\u093f\u092b\u093e\u0908"},
        {"YouTube Music", "com.google.android.apps.youtube.music", "youtube\\s*music|yt\\s*music"},
        {"Wynk", "tv.accedo.airtel.wynk", "wynk(?:\\s*music)?"},
        {"JioSaavn", "com.jio.media.jiobeats", "jio\\s*saavn|saavn"},
        {"Apple Music", "com.apple.android.music", "apple\\s*music"},
    };

    /** The package for a music service by its display name, or null. */
    static String musicPackage(String name) {
        if (name == null) return null;
        for (String[] service : MUSIC_SERVICES) {
            if (service[0].equalsIgnoreCase(name.trim())) return service[1];
        }
        return null;
    }

    /* Play, pause, stop, next, previous, volume - of whatever is playing.

       "Pause" said to the phone while Spotify played reached the language
       model, which explained how to pause Spotify. Media keys are how Android
       lets one app control another's playback, the same thing a headset
       button does, and they need no permission. Anchored short phrases only,
       so "play despacito" is still a request for a song. */
    private static final Object[][] CONTROLS = {
        {"pause", Pattern.compile("^(?:pause(?:\\s+karo|\\s+kar\\s+do|\\s+it)?|pause\\s+(?:the\\s+)?(?:music|song|video|gaana)"
            + "|ruko|ruk\\s+jao|roko|rok\\s+do|(?:gaana|music|song|video)\\s+(?:roko|rok\\s+do|pause\\s+karo)"
            + "|\u0930\u0941\u0915\u094b|\u0930\u094b\u0915\u094b|\u0930\u094b\u0915\\s+\u0926\u094b|\u092a\u0949\u091c\u093c?(?:\\s+\u0915\u0930\u094b)?)$", Pattern.CASE_INSENSITIVE)},
        {"stop", Pattern.compile("^(?:stop(?:\\s+(?:the\\s+)?(?:music|song|video|playing))?|(?:gaana|music|song|video)\\s+band\\s+karo"
            + "|band\\s+karo\\s+(?:gaana|music)|\u0917\u093e\u0928\u093e\\s+\u092c\u0902\u0926\\s+\u0915\u0930\u094b)$", Pattern.CASE_INSENSITIVE)},
        {"play", Pattern.compile("^(?:resume|continue|play|play\\s+karo|resume\\s+karo|chalao|chalu\\s+karo\\s+(?:gaana|music)|phir\\s+se\\s+chalao"
            + "|wapas\\s+chalao|(?:gaana|music|song|video)\\s+(?:chalao|resume\\s+karo|play\\s+karo|wapas\\s+chalao)"
            + "|\u091a\u0932\u093e\u0913|\u092b\u093f\u0930\\s+\u0938\u0947\\s+\u091a\u0932\u093e\u0913)$", Pattern.CASE_INSENSITIVE)},
        {"next", Pattern.compile("^(?:next(?:\\s+(?:song|track|video|gaana))?|skip(?:\\s+(?:this|it|song))?|agla(?:\\s+(?:gaana|song|video))?"
            + "|next\\s+karo|\u0905\u0917\u0932\u093e(?:\\s+\u0917\u093e\u0928\u093e)?)$", Pattern.CASE_INSENSITIVE)},
        {"previous", Pattern.compile("^(?:previous(?:\\s+(?:song|track|video))?|pichla(?:\\s+(?:gaana|song|video))?|last\\s+song"
            + "|\u092a\u093f\u091b\u0932\u093e(?:\\s+\u0917\u093e\u0928\u093e)?)$", Pattern.CASE_INSENSITIVE)},
        {"volume_up", Pattern.compile("^(?:volume\\s+(?:up|badhao|increase|tez\\s+karo|zyada\\s+karo)|(?:increase|raise|turn\\s+up)\\s+(?:the\\s+)?volume"
            + "|a+wa+z\\s+(?:badhao|tez\\s+karo)|louder|\u0906\u0935\u093e\u091c\u093c?\\s+\u092c\u0922\u093c\u093e\u0913)$", Pattern.CASE_INSENSITIVE)},
        {"volume_down", Pattern.compile("^(?:volume\\s+(?:down|kam\\s+karo|ghatao|decrease|dheere\\s+karo)|(?:decrease|lower|turn\\s+down)\\s+(?:the\\s+)?volume"
            + "|a+wa+z\\s+(?:kam\\s+karo|dheere\\s+karo|ghatao)|quieter|\u0906\u0935\u093e\u091c\u093c?\\s+\u0915\u092e\\s+\u0915\u0930\u094b)$", Pattern.CASE_INSENSITIVE)},
        {"mute", Pattern.compile("^(?:mute|mute\\s+karo|volume\\s+mute\\s+karo)$", Pattern.CASE_INSENSITIVE)},
    };

    static Command mediaControl(String text) {
        String t = text.trim().replaceAll("[.!?]+$", "");
        for (Object[] control : CONTROLS) {
            if (((Pattern) control[1]).matcher(t).matches()) return new Command("media", (String) control[0]);
        }
        return null;
    }

    /** Press a media key for whatever app holds playback. */
    static String performMedia(Context context, String control) {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return "I couldn't reach the phone's audio.";
        switch (control) {
            case "volume_up":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                return "Volume up.";
            case "volume_down":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                return "Volume down.";
            case "mute":
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI);
                return "Muted.";
            default:
                break;
        }
        int code;
        String said;
        switch (control) {
            case "pause":    code = KeyEvent.KEYCODE_MEDIA_PAUSE;    said = "Paused."; break;
            case "stop":     code = KeyEvent.KEYCODE_MEDIA_STOP;     said = "Stopped."; break;
            case "play":     code = KeyEvent.KEYCODE_MEDIA_PLAY;     said = "Playing."; break;
            case "next":     code = KeyEvent.KEYCODE_MEDIA_NEXT;     said = "Next one."; break;
            case "previous": code = KeyEvent.KEYCODE_MEDIA_PREVIOUS; said = "Previous one."; break;
            default: return "";
        }
        if (!audio.isMusicActive() && !"play".equals(control)) {
            // Nothing is playing; pressing pause would do nothing and say "Paused".
            if ("pause".equals(control) || "stop".equals(control)) return "Nothing is playing right now.";
        }
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
        return said;
    }

    /* YouTube, playing - not a page of results.

       "Kesariya YouTube par chalao" opened a search and stopped there. The top
       result's id is in the search page itself, so it is read from there and
       the video is opened directly, which starts it. Network, so never on the
       main thread; on any failure the search is opened instead, as before. */
    static String firstYouTubeVideo(String query) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("https://www.youtube.com/results?hl=en&search_query="
                + Uri.encode(query == null ? "" : query.trim()));
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(5000);
            // A desktop browser's name, deliberately. Asked as a phone, YouTube
            // redirects to m.youtube.com, whose page carries no video ids at
            // all - measured: 0 ids there, 234 on the desktop page - so the
            // lookup always failed and a search opened instead of the song.
            connection.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
            connection.setRequestProperty("Accept-Language", "en");
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                Pattern id = Pattern.compile(
                    "\"videoId\":\"([A-Za-z0-9_-]{11})\"|\\\\x22videoId\\\\x22:\\\\x22([A-Za-z0-9_-]{11})\\\\x22");
                String line;
                int read = 0;
                while ((line = reader.readLine()) != null && read < 3_000_000) {
                    read += line.length();
                    Matcher m = id.matcher(line);
                    if (m.find()) return m.group(1) != null ? m.group(1) : m.group(2);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "could not look up the top YouTube result", e);
        } finally {
            if (connection != null) connection.disconnect();
        }
        return null;
    }

    static Intent youTubeVideo(String videoId) {
        // The watch link with CLEAR_TOP, not vnd.youtube: plus the usual flags.
        // With YouTube already open, that combination brought its previous
        // screen - a page of search results - back to the front and never
        // opened the video. Tested on the phone: this starts it playing even
        // when YouTube is already open on something else.
        Intent app = new Intent(Intent.ACTION_VIEW,
            Uri.parse("https://www.youtube.com/watch?v=" + videoId));
        app.setPackage("com.google.android.youtube");
        app.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return app;
    }

    /** True when the words ask for it to play rather than to be looked for. */
    static boolean wantsPlay(String text) {
        return Pattern.compile("\\b(?:play|bajao|baja\\s+do|chalao|chala\\s+do|sunao|lagao|laga\\s+do)\\b"
            + "|\u092c\u091c\u093e\u0913|\u091a\u0932\u093e\u0913|\u0938\u0941\u0928\u093e\u0913|\u0932\u0917\u093e\u0913",
            Pattern.CASE_INSENSITIVE).matcher(text == null ? "" : text).find();
    }

    private static final String ON_WORD = "(?:on|in|pe|par|per|mein|mai|men|\u092a\u0930|\u092a\u0947|\u092e\u0947\u0902)";

    /* A request for music that names none. */
    static final Pattern GENERIC_MUSIC = Pattern.compile(
        "^(?:(?:some|a|any|my|the|koi|kuch|\u0915\u094b\u0908|\u0915\u0941\u091b)\\s+)?"
        + "(?:music|songs?|gaana|gana|gaane|gane|something|\u0917\u093e\u0928\u093e|\u0917\u093e\u0928\u0947|\u0917\u0940\u0924|\u0938\u0902\u0917\u0940\u0924)"
        + "(?:\\s+(?:for\\s+me|mere\\s+liye))?$", Pattern.CASE_INSENSITIVE);

    private static final Pattern DEVANAGARI = Pattern.compile("[\u0900-\u097F]");
    private static final Pattern HINGLISH = Pattern.compile(
        "\\b(?:karo|kar\\s+do|bajao|chalao|sunao|lagao|par|pe|mein|mere|liye|koi|kuch|gaana|gana|gaane|kholo|suno)\\b",
        Pattern.CASE_INSENSITIVE);

    /** "hi", "hinglish" or "en": how the request was said. */
    static String spokenLanguage(String text) {
        if (DEVANAGARI.matcher(text).find()) return "hi";
        if (HINGLISH.matcher(text).find()) return "hinglish";
        return "en";
    }

    /** "Which song?" in the language of the request. argument = the question. */
    static Command askForSong(String text, String app) {
        String lang = spokenLanguage(text);
        boolean named = app != null && !app.isEmpty();
        String question;
        if ("hi".equals(lang)) {
            question = named ? app + " \u092a\u0930 \u0915\u094c\u0928 \u0938\u093e \u0917\u093e\u0928\u093e \u091a\u0932\u093e\u090a\u0901?"
                             : "\u0915\u094c\u0928 \u0938\u093e \u0917\u093e\u0928\u093e \u0938\u0941\u0928\u0928\u093e \u0939\u0948?";
        } else if ("hinglish".equals(lang)) {
            question = named ? app + " par kaunsa gaana chalaun?" : "Kaunsa gaana sunna hai?";
        } else {
            question = named ? "Which song should I play on " + app + "?" : "Which song would you like to hear?";
        }
        Command ask = new Command("ask", question, app);
        ask.lang = lang;
        return ask;
    }

    private static final Pattern CANCEL = Pattern.compile(
        "^(?:cancel|never\\s*mind|nothing|no|nahi|nahin|kuch\\s+nahi|rehne\\s+do|rahne\\s+do|chhodo|chodo|jane\\s+do)$",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern ANYTHING = Pattern.compile(
        "^(?:any(?:thing)?|any\\s+song|whatever|your\\s+choice|you\\s+choose|surprise\\s+me|kuch\\s+bhi|koi\\s+bhi(?:\\s+gaana)?|kuchh\\s+bhi)$",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern NOT_AN_ANSWER = Pattern.compile(
        "^(?:what|why|how|when|where|who|which|kya|kyu|kyon|kaise|kab|kahan|tell\\s+me|explain|batao)\\b",
        Pattern.CASE_INSENSITIVE);

    /**
     * The reply to "which song?". Mirrors deviceCommands.answerFollowUp:
     * a command to run, action "cancelled", or null when it is not an answer.
     */
    static Command answer(Command asked, String said) {
        if (asked == null || said == null) return null;
        String text = tidy(stripWakePhrase(said.trim()));
        if (text.isEmpty()) return null;
        if (CANCEL.matcher(text).matches()) return new Command("cancelled", "");
        if (ANYTHING.matcher(text).matches()) return new Command("music", "", asked.app);
        Command direct = detect(text);
        if (direct != null && "youtube_play".equals(direct.action) && !asked.app.isEmpty()) {
            return new Command("music", direct.argument, asked.app);
        }
        if (direct != null && !"ask".equals(direct.action)) return direct;
        if (said.length() > 80 || NOT_AN_ANSWER.matcher(text).find()) return null;
        String query = text
            .replaceAll("(?i)^(?:play|bajao|chalao|sunao)\\s+", "")
            .replaceAll("(?i)\\s+(?:bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do|lagao|laga\\s+do|play\\s+karo|play\\s+kar\\s+do)$", "")
            .replaceAll("(?i)\\s+(?:song|gaana|gana|wala|waala)$", "")
            .trim();
        if (query.length() < 2) return null;
        return asked.app.isEmpty() ? new Command("youtube_play", query)
                                   : new Command("music", query, asked.app);
    }

    /* "Hey SMARAN, ..." - the name is how it was addressed, not the instruction. */
    private static final Pattern WAKE_PREFIX = Pattern.compile(
        "^\\s*(?:(?:hey|hi|hello|ok|okay|oye|suno)\\s+)?(?:smaran|samaran|amarya|amariya|amaria|myra|myraa|jarvis)(?:\\s+ai)?[\\s,!.:-]*",
        Pattern.CASE_INSENSITIVE);

    static String stripWakePhrase(String text) {
        return WAKE_PREFIX.matcher(text).replaceFirst("").trim();
    }

    private static Command musicInService(String text) {
        for (String[] service : MUSIC_SERVICES) {
            String app = "(?:" + service[2] + ")";
            Pattern[] shapes = {
                // "kesariya spotify par play karo"
                Pattern.compile("^(.+?)\\s+(?:" + ON_WORD + "\\s+)?" + app + "\\s+(?:" + ON_WORD + "\\s+)?"
                    + "(?:" + PLAY_LAST + "|play|" + OPEN_LAST + ")\\s*$", Pattern.CASE_INSENSITIVE),
                // "play kesariya on spotify", "kesariya bajao spotify par"
                Pattern.compile("^(?:" + PLAY_FIRST + "|play)\\s+(.+?)\\s+" + ON_WORD + "\\s+" + app + "\\s*$",
                    Pattern.CASE_INSENSITIVE),
                Pattern.compile("^(.+?)\\s+(?:" + PLAY_LAST + ")\\s+" + app + "\\s+" + ON_WORD + "\\s*$",
                    Pattern.CASE_INSENSITIVE),
                // "spotify par kesariya bajao"
                Pattern.compile("^" + app + "\\s+" + ON_WORD + "\\s+(.+?)\\s+(?:" + PLAY_LAST + "|play)\\s*$",
                    Pattern.CASE_INSENSITIVE),
            };
            for (Pattern shape : shapes) {
                Matcher m = shape.matcher(text);
                if (m.find()) {
                    // "Play music on Spotify" names no song: ask which, the
                    // way the page does (deviceCommands.askForSong).
                    if (GENERIC_MUSIC.matcher(tidy(m.group(1))).matches()) {
                        return askForSong(text, service[0]);
                    }
                    String query = m.group(1).replaceAll(
                        "(?i)\\s*(?:song|gaana|gana|gaane|\u0917\u093e\u0928\u093e)\\s*$", "").trim();
                    if (!query.isEmpty()) return new Command("music", query, service[0]);
                }
            }
        }
        return null;
    }

    // Talking *about* a command rather than giving one. The same three shapes
    // the page refuses: a refusal, a question about the command, and a command
    // in quotation marks. `stop`, `cancel` and "band karo" are deliberately
    // absent - "awaz band karo" is a real instruction.
    private static final Pattern REFUSAL = Pattern.compile(
        "\\b(?:do\\s*n[o']?t|don'?t|doesn'?t|never|instead\\s+of|nahi|mat|nako)\\b",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern ABOUT_IT = Pattern.compile(
        "^\\s*(?:how|what|why|when|where|which|who|kaise|kya|kyun|kyu)\\b",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern QUOTED = Pattern.compile("[\"'‘’“”]");

    // Verb first and verb last both, because Hinglish puts the verb at the end.
    private static final String OPEN_FIRST =
        "(?:open|launch|start|run|kholo|khol\\s+do|chalu\\s+karo|start\\s+karo|open\\s+karo)";
    private static final String OPEN_LAST =
        "(?:kholo|khol\\s+do|chalu\\s+karo|start\\s+karo|open\\s+karo|kholna)";
    private static final String PLAY_FIRST =
        "(?:play|bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do)";
    private static final String PLAY_LAST =
        "(?:bajao|baja\\s+do|chalao|chala\\s+do|sunao|suna\\s+do|play\\s+karo)";

    private static final Pattern[] YOUTUBE_QUERY = {
        Pattern.compile("^(.+?)\\s+(?:youtube|यूट्यूब)\\s+(?:pe|par|per|पर|पे)\\s+(?:channel|चैनल)\\s+(?:(?:ko|को)\\s+)?(?:open\\s+karo|kholo|khol\\s+do|खोलो|खोल\\s+दो)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:" + OPEN_FIRST + "|" + PLAY_FIRST
            + "|search|dikhao)\\s+(?:on\\s+|pe\\s+|par\\s+|per\\s+)?youtube\\s+(.+)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("youtube\\s+(?:pe|par|per|mein|mai|men)\\s+(.+?)\\s+(?:" + PLAY_LAST
            + "|" + OPEN_LAST + "|dikhao|search\\s+karo)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:" + PLAY_FIRST + ")\\s+(.+?)\\s+(?:on|pe|par|per)\\s+youtube$",
            Pattern.CASE_INSENSITIVE),
        // "sada shiv boliye youtube per play karo" - what, where, then the verb.
        Pattern.compile("^(.+?)\\s+youtube\\s+(?:pe|par|per|mein|mai|men)\\s+(?:" + PLAY_LAST
            + "|" + OPEN_LAST + "|dikhao|search\\s+karo)$", Pattern.CASE_INSENSITIVE),
        // "sada shiv boliye ko play karo youtube per" - the verb before the place.
        Pattern.compile("^(.+?)\\s+(?:" + PLAY_LAST + ")\\s+(?:on\\s+)?youtube(?:\\s+(?:pe|par|per|mein|mai|men))?$",
            Pattern.CASE_INSENSITIVE),
    };
    private static final Pattern[] YOUTUBE_BARE = {
        Pattern.compile("^\\s*" + OPEN_FIRST + "\\s+youtube\\s*$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("^\\s*youtube\\s+" + OPEN_LAST + "\\s*$", Pattern.CASE_INSENSITIVE),
    };
    private static final Pattern[] MUSIC_BARE = {
        Pattern.compile("^\\s*(?:koi\\s+|kuch\\s+)?(?:gaana|gana|song|music|gaane)\\s+"
            + PLAY_LAST + "\\s*$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("^\\s*" + PLAY_FIRST + "\\s+(?:koi\\s+|kuch\\s+)?(?:gaana|gana|song|music)\\s*$",
            Pattern.CASE_INSENSITIVE),
    };
    private static final Pattern[] MUSIC_QUERY = {
        Pattern.compile("^\\s*" + PLAY_FIRST + "\\s+(?:the\\s+)?song\\s+(.+)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("^\\s*(.+?)\\s+(?:gaana|gana|song)\\s+" + PLAY_LAST + "\\s*$",
            Pattern.CASE_INSENSITIVE),
        Pattern.compile("^\\s*" + PLAY_FIRST + "\\s+(.+?)\\s+(?:gaana|gana|song)\\s*$",
            Pattern.CASE_INSENSITIVE),
    };
    private static final Pattern[] URL = {
        Pattern.compile("(?:" + OPEN_FIRST + ")\\s+(https?://\\S+)$", Pattern.CASE_INSENSITIVE),
    };
    private static final Pattern[] APP = {
        Pattern.compile("^\\s*" + OPEN_FIRST + "\\s+(?:the\\s+)?(.+?)(?:\\s+app)?\\s*$",
            Pattern.CASE_INSENSITIVE),
        Pattern.compile("^\\s*(.+?)(?:\\s+app)?\\s+" + OPEN_LAST + "\\s*$", Pattern.CASE_INSENSITIVE),
    };

    // Politeness lands after the verb in Hinglish - "Chrome kholo zara" - past
    // the anchor a verb-last pattern needs, so it comes off before matching.
    // `karo` is not here: it is the verb in "chalu karo".
    private static final Pattern POLITENESS = Pattern.compile(
        "\\s*(?:please|plz|zara|jara|thoda|abhi|now)\\s*$", Pattern.CASE_INSENSITIVE);

    private static String stripPoliteness(String text) {
        String out = text.trim();
        String previous;
        do {
            previous = out;
            out = POLITENESS.matcher(out).replaceAll("").trim();
        } while (!out.equals(previous));
        return out;
    }

    private static String tidy(String value) {
        return stripPoliteness(value).replaceAll("[.!?,;:]+$", "").trim();
    }

    private static Command firstMatch(Pattern[] patterns, String text, String action, boolean capture) {
        for (Pattern pattern : patterns) {
            Matcher m = pattern.matcher(text);
            if (!m.find()) continue;
            if (!capture) return new Command(action, "");
            String value = tidy(m.group(1));
            // "sada shiv boliye ko ...": "ko" marks the object, it is not the title.
            if ("youtube".equals(action)) value = value.replaceAll("(?i)\\s+(?:ko|को)$", "").trim();
            if (value.isEmpty()) continue;
            if ("app".equals(action) && value.length() < 2) continue;
            return new Command(action, value);
        }
        return null;
    }

    /** What this line is asking the phone to do, or null. */
    static Command detect(String utterance) {
        if (utterance == null) return null;
        String raw = utterance.trim();
        if (raw.isEmpty() || raw.length() > 120) return null;
        if (REFUSAL.matcher(raw).find() || ABOUT_IT.matcher(raw).find()
                || QUOTED.matcher(raw).find()) {
            return null;
        }
        String text = stripPoliteness(stripWakePhrase(raw));
        if (text.isEmpty()) return null;

        // Control of whatever is already playing, before anything else: a
        // bare "pause" or "agla gaana" is never an app name or a song.
        Command control = mediaControl(text);
        if (control != null) return control;

        // First: "YouTube Music" would otherwise be taken for YouTube.
        Command found = musicInService(text);
        if (found == null) {
            found = firstMatch(YOUTUBE_QUERY, text, "youtube", true);
            if (found != null && wantsPlay(text) && !found.argument.isEmpty()) {
                found = new Command("youtube_play", found.argument);
            }
        }
        if (found == null) found = firstMatch(YOUTUBE_BARE, text, "youtube", false);
        // "Gaana bajao": which one? Asked, not guessed.
        if (found == null && firstMatch(MUSIC_BARE, text, "music", false) != null) {
            found = askForSong(text, "");
        }
        if (found == null) found = firstMatch(MUSIC_QUERY, text, "music", true);
        if (found == null) found = firstMatch(URL, text, "url", true);
        if (found == null) found = firstMatch(APP, text, "app", true);
        return found;
    }

    // ── carrying it out ──────────────────────────────────────────────────────

    static String simplify(String value) {
        if (value == null) return "";
        String flat = Normalizer.normalize(value, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        return flat.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    /** The installed app whose label best matches what was said. */
    static ResolveInfo findApp(Context context, String spoken) {
        String wanted = simplify(spoken);
        if (wanted.isEmpty()) return null;
        PackageManager pm = context.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> all = pm.queryIntentActivities(main, 0);
        ResolveInfo prefix = null;
        ResolveInfo contains = null;
        for (ResolveInfo info : all) {
            String label = simplify(String.valueOf(info.loadLabel(pm)));
            if (label.isEmpty()) continue;
            if (label.equals(wanted)) return info;      // exact wins outright
            if (prefix == null && label.startsWith(wanted)) prefix = info;
            if (contains == null && label.contains(wanted)) contains = info;
        }
        return prefix != null ? prefix : contains;
    }

    /**
     * Start an activity, from an Activity when there is one.
     *
     * A launch from the Application context is a background launch as far as
     * Android is concerned, and since 10 those are restricted - the symptom is
     * a call that reports success while nothing appears. The service has no
     * activity to use, which is why it is a foreground service: that is what
     * earns it the right to start one at all.
     */
    static boolean launch(Context context, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "activity start refused", e);
            return false;
        }
    }

    static String openApp(Context context, String name) {
        ResolveInfo match = findApp(context, name);
        if (match == null) return "I can't find " + name + " on this phone.";
        String pkg = match.activityInfo.packageName;
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(pkg);
        if (intent == null) return "I can't open " + name + " on this phone.";
        String label = String.valueOf(match.loadLabel(context.getPackageManager()));
        return launch(context, intent) ? "Opening " + label + "." : "I couldn't open " + name + ".";
    }

    static String openYouTube(Context context, String query) {
        String text = query == null ? "" : query.trim();
        if (!text.isEmpty()) {
            Intent search = new Intent(Intent.ACTION_SEARCH)
                .setPackage("com.google.android.youtube")
                .putExtra("query", text);
            if (launch(context, search)) return "Searching YouTube for " + text + ".";
        }
        Uri web = Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(text));
        boolean ok = launch(context, new Intent(Intent.ACTION_VIEW, web));
        if (!ok) return "I couldn't open YouTube.";
        return text.isEmpty() ? "Opening YouTube." : "Searching YouTube for " + text + ".";
    }

    static String playMusic(Context context, String query) {
        return playMusic(context, query, "");
    }

    static final String SPOTIFY = "com.spotify.music";

    /** True when Spotify is asked: it opens its search rather than playing. */
    static boolean opensSearch(String packageName, String query) {
        return SPOTIFY.equals(packageName) && query != null && !query.trim().isEmpty();
    }

    /** The system's "play this", addressed to one app when one was named. */
    static Intent musicIntent(String query, String packageName) {
        // Spotify ignores MEDIA_PLAY_FROM_SEARCH from other apps - tested on
        // a phone with Spotify both running and stopped: delivered, no change,
        // still paused on the previous track. Its own search link does work,
        // and lands on the song as the top result, one tap from playing. That
        // is what is sent, and what is said back, rather than a claim that it
        // is playing.
        if (opensSearch(packageName, query)) {
            Intent search = new Intent(Intent.ACTION_VIEW,
                Uri.parse("spotify:search:" + Uri.encode(query.trim())));
            search.setPackage(SPOTIFY);
            return search;
        }
        Intent play = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
        String text = query == null ? "" : query.trim();
        if (!text.isEmpty()) {
            play.putExtra(SearchManager.QUERY, text);
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
        }
        if (packageName != null && !packageName.isEmpty()) play.setPackage(packageName);
        return play;
    }

    static String playMusic(Context context, String query, String app) {
        String text = query == null ? "" : query.trim();
        String pkg = musicPackage(app);
        if (pkg != null) {
            if (!launch(context, musicIntent(text, pkg))) {
                return app + " isn't installed on this phone.";
            }
            if (opensSearch(pkg, text)) return "Opened " + text + " in " + app + ". Tap it to play.";
            return text.isEmpty() ? "Opening " + app + "." : "Playing " + text + " on " + app + ".";
        }
        if (!launch(context, musicIntent(text, null))) return "No music app answered on this phone.";
        return text.isEmpty() ? "Playing music." : "Playing " + text + ".";
    }

    static String openUrl(Context context, String url) {
        Uri uri = Uri.parse(url == null ? "" : url.trim());
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        // Only the two schemes a spoken request can reasonably mean. `file:`,
        // `content:` and `intent:` are all reachable otherwise, and each is a
        // way to read or start something nobody asked for.
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return "I can only open web addresses.";
        }
        return launch(context, new Intent(Intent.ACTION_VIEW, uri))
            ? "Opening that page." : "I couldn't open that address.";
    }

    /** Carry out a detected command. Returns what to say back. */
    static String perform(Context context, Command command) {
        if (command == null) return "";
        switch (command.action) {
            case "app":     return openApp(context, command.argument);
            case "youtube": return openYouTube(context, command.argument);
            case "music":   return playMusic(context, command.argument, command.app);
            case "media":   return performMedia(context, command.argument);
            case "youtube_play": {
                // Speech results arrive on the main thread, where Android forbids
                // network access, so the lookup runs on its own thread and the
                // reply is said straight away.
                final String query = command.argument;
                new Thread(() -> {
                    String id = firstYouTubeVideo(query);
                    if (id == null || !launch(context, youTubeVideo(id))) openYouTube(context, query);
                }, "youtube-lookup").start();
                return "Playing " + query + " on YouTube.";
            }
            case "url":     return openUrl(context, command.argument);
            default:        return "";
        }
    }
}
