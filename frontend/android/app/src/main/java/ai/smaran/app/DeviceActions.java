package ai.smaran.app;

import android.app.SearchManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Log;

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
        Command(String action, String argument) {
            this.action = action;
            this.argument = argument == null ? "" : argument;
        }
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
        Pattern.compile("^(.+?)\\s+(?:youtube|यूट्यूब)\\s+(?:pe|par|पर|पे)\\s+(?:channel|चैनल)\\s+(?:(?:ko|को)\\s+)?(?:open\\s+karo|kholo|khol\\s+do|खोलो|खोल\\s+दो)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:" + OPEN_FIRST + "|" + PLAY_FIRST
            + "|search|dikhao)\\s+(?:on\\s+|pe\\s+|par\\s+)?youtube\\s+(.+)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("youtube\\s+(?:pe|par|mein|mai|men)\\s+(.+?)\\s+(?:" + PLAY_LAST
            + "|" + OPEN_LAST + "|dikhao|search\\s+karo)$", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:" + PLAY_FIRST + ")\\s+(.+?)\\s+(?:on|pe|par)\\s+youtube$",
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
        String text = stripPoliteness(raw);
        if (text.isEmpty()) return null;

        Command found = firstMatch(YOUTUBE_QUERY, text, "youtube", true);
        if (found == null) found = firstMatch(YOUTUBE_BARE, text, "youtube", false);
        if (found == null) found = firstMatch(MUSIC_BARE, text, "music", false);
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
        Intent play = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
        String text = query == null ? "" : query.trim();
        if (!text.isEmpty()) {
            play.putExtra(SearchManager.QUERY, text);
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
        }
        if (!launch(context, play)) return "No music app answered on this phone.";
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
            case "music":   return playMusic(context, command.argument);
            case "url":     return openUrl(context, command.argument);
            default:        return "";
        }
    }
}
