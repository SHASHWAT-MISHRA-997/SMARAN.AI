package ai.smaran.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * "Skip ad", and starting the Spotify song that was asked for.
 *
 * Android lets one app press a button in another only through an
 * accessibility service, which the user switches on themselves in Settings.
 * This one does nothing on its own: it handles no events, keeps nothing, and
 * sends nothing anywhere. When "skip ad" is said it looks at the app in front
 * once, finds a button labelled Skip / Skip ad, and presses it. Nothing else
 * is ever pressed - a label that is not a skip label is never clicked, so it
 * cannot be steered into a purchase or a payment. The one other press is in
 * Spotify, which will not start a song for another app: after SMARAN opens
 * its search, the matching song row is pressed (tapSpotifySong).
 */
public class SmaranAccessibility extends AccessibilityService {
    private static volatile SmaranAccessibility running;

    @Override
    protected void onServiceConnected() {
        running = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Deliberately nothing: this service acts only when asked.
    }

    @Override
    public void onInterrupt() { }

    @Override
    public boolean onUnbind(Intent intent) {
        running = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        running = null;
        super.onDestroy();
    }

    static boolean enabled() {
        return running != null;
    }

    /** The labels that mean "skip this ad", in English and Hindi. Whole label only. */
    private static final Pattern SKIP_LABEL = Pattern.compile(
        "^(?:skip|skip ads?|skip ad[s]?\\s*[›>]*|skip (?:this )?ad|skip video|skip trailer"
        + "|विज्ञापन छोड़ें"  // विज्ञापन छोड़ें
        + "|छोड़ें)$",                                                  // छोड़ें
        Pattern.CASE_INSENSITIVE);

    static boolean isSkipLabel(CharSequence label) {
        if (label == null) return false;
        String text = label.toString().replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
        return !text.isEmpty() && SKIP_LABEL.matcher(text).matches();
    }

    /** "skipped", "no-skip-button" or "not-enabled". */
    static String skipAd() {
        SmaranAccessibility service = running;
        if (service == null) return "not-enabled";
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) return "no-skip-button";
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 3000) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            if (node.isVisibleToUser()
                    && (isSkipLabel(node.getText()) || isSkipLabel(node.getContentDescription()))) {
                AccessibilityNodeInfo target = node;
                // The label is often a TextView inside the clickable button.
                for (int up = 0; target != null && !target.isClickable() && up < 3; up++) {
                    target = target.getParent();
                }
                if (target != null && target.isClickable()
                        && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    return "skipped";
                }
            }
            for (int i = 0; i < node.getChildCount(); i++) queue.add(node.getChild(i));
        }
        return "no-skip-button";
    }

    // ── Spotify: press the song that was asked for ──────────────────────────

    static final String SPOTIFY = "com.spotify.music";

    interface Done { void result(boolean tapped); }

    /*
     * Spotify will not let another app start a song; its search link only
     * opens the results. So after the search opens, the song row is pressed
     * here - the row whose subtitle says "Song", best matching what was asked.
     * Never the "Add to library" or "More options" buttons beside it, never a
     * row that is not a song, and only inside Spotify.
     */
    static void tapSpotifySong(String query, Done done) {
        SmaranAccessibility service = running;
        if (service == null) {
            if (done != null) done.result(false);
            return;
        }
        android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        final String wanted = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        final int[] tries = {0};
        Runnable attempt = new Runnable() {
            @Override public void run() {
                SmaranAccessibility live = running;
                boolean tapped = live != null && live.pressSong(wanted);
                if (tapped || ++tries[0] >= 14) {
                    if (done != null) done.result(tapped);
                } else {
                    main.postDelayed(this, 350);   // results still loading
                }
            }
        };
        main.postDelayed(attempt, 600);
    }

    private boolean pressSong(String wanted) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null
                || !SPOTIFY.contentEquals(root.getPackageName())) return false;
        AccessibilityNodeInfo best = null;
        int bestScore = -1;
        for (AccessibilityNodeInfo title : root.findAccessibilityNodeInfosByViewId(SPOTIFY + ":id/title")) {
            AccessibilityNodeInfo row = title.getParent();
            if (row == null || !isSongRow(row) || !title.isVisibleToUser()) continue;
            int score = overlap(wanted, String.valueOf(title.getText()).toLowerCase(Locale.ROOT));
            if (score > bestScore) {
                bestScore = score;
                best = row;
            }
        }
        if (best == null) return false;
        AccessibilityNodeInfo target = best;
        for (int up = 0; target != null && !target.isClickable() && up < 3; up++) target = target.getParent();
        return target != null && target.isClickable()
            && target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }

    /** A result row for a song: its subtitle begins "Song". */
    private static boolean isSongRow(AccessibilityNodeInfo row) {
        for (int i = 0; i < row.getChildCount(); i++) {
            AccessibilityNodeInfo child = row.getChild(i);
            if (child == null) continue;
            String id = child.getViewIdResourceName();
            CharSequence text = child.getText();
            if (id != null && id.endsWith(":id/subtitle") && text != null
                    && text.toString().trim().toLowerCase(Locale.ROOT).startsWith("song")) {
                return true;
            }
        }
        return false;
    }

    /** How many words of what was asked appear in the title. */
    static int overlap(String wanted, String title) {
        int score = 0;
        for (String word : wanted.split("\\s+")) {
            if (word.length() > 1 && title.contains(word)) score++;
        }
        return score;
    }

    /** Android's Accessibility settings, where the user switches this on. */
    static boolean openSettings(Context context) {
        try {
            context.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** What to say back for a skipAd() result. */
    static String describe(String result) {
        switch (result) {
            case "skipped":
                return "Skipped.";
            case "not-enabled":
                return "To skip ads I need Accessibility access. I've opened the settings - "
                    + "turn on SMARAN.AI there, then say skip ad again.";
            default:
                return "There's no Skip button yet - some ads can't be skipped for the first few seconds.";
        }
    }
}
