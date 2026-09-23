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
 * "Skip ad" - pressing the Skip button in whatever app is in front.
 *
 * Android lets one app press a button in another only through an
 * accessibility service, which the user switches on themselves in Settings.
 * This one does nothing on its own: it handles no events, keeps nothing, and
 * sends nothing anywhere. When "skip ad" is said it looks at the app in front
 * once, finds a button labelled Skip / Skip ad, and presses it. Nothing else
 * is ever pressed - a label that is not a skip label is never clicked, so it
 * cannot be steered into a purchase or a payment.
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
