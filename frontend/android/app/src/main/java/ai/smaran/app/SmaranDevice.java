package ai.smaran.app;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.app.SearchManager;
import android.util.Log;
import android.util.Rational;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Opening things on the phone itself.
 *
 * Until now "Chrome kholo" was answered with instructions for opening Chrome,
 * which on the device you are holding is a strange thing to be told. The
 * desktop build has done this for a while through desktop_agent; this is the
 * same idea reaching the phone.
 *
 * WHAT THIS DELIBERATELY CANNOT DO
 *
 * Every method here builds a fixed Intent shape from an argument. Nothing
 * takes an action string, a component name or an arbitrary extras bundle from
 * the page, because the page's input ultimately comes from a language model
 * repeating what it heard, and "launch this component with these extras" is a
 * much larger surface than "open the app the user named". Adding a general
 * startActivity bridge here would hand that surface to whatever the microphone
 * picked up.
 *
 * Web addresses are restricted to http and https for the same reason. `file:`,
 * `content:` and `intent:` are all reachable through a URL argument otherwise,
 * and each is a way to read something or start something that was never asked
 * for.
 *
 * FINDING APPS WITHOUT QUERY_ALL_PACKAGES
 *
 * Resolving "whatsapp" to a package needs to see what is installed. The blunt
 * way is QUERY_ALL_PACKAGES, which Play treats as a dangerous permission
 * needing justification - the manifest here already refuses it once, for the
 * speech services. A <queries> entry for MAIN/LAUNCHER gives visibility of
 * launchable apps only, which is exactly the set a person can name, and asks
 * for nothing that needs justifying.
 */
@CapacitorPlugin(name = "SmaranDevice")
public class SmaranDevice extends Plugin {
    private static final String TAG = "SmaranDevice";

    /**
     * Start an activity as the visible app rather than as the process.
     *
     * getContext() on a plugin is the Application context, and an activity
     * started from it is a background launch as far as Android is concerned.
     * Since Android 10 those are restricted, and the symptom is exactly what
     * was seen here: the call reports success, nothing is refused, and the
     * launched app never comes to the front. Launching from the Activity keeps
     * the launcher/launched relationship the restriction is looking for.
     *
     * FLAG_ACTIVITY_NEW_TASK stays for the Application fallback, which is only
     * reached if the activity has already gone.
     */
    private boolean launch(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }
            return true;
        } catch (Exception e) {
            Log.w(TAG, "activity start refused", e);
            return false;
        }
    }

    /** Lower case, unaccented, letters and digits only, so "Google Chrome" matches "chrome". */
    private static String simplify(String value) {
        if (value == null) return "";
        String flat = Normalizer.normalize(value, Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "");
        return flat.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    /** Every launchable app, as label plus package. */
    private List<ResolveInfo> launchable() {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        return pm.queryIntentActivities(main, 0);
    }

    /**
     * The package whose label best matches what was said.
     *
     * Exact match first, then prefix, then contains. Ordering matters: with
     * "contains" alone, "Files" would match "Google Files" and "My Files"
     * equally and the answer would depend on the order the system happened to
     * return. An exact label is unambiguous and should never lose to a longer
     * name that happens to contain it.
     */
    private ResolveInfo bestMatch(String spoken) {
        String wanted = simplify(spoken);
        if (wanted.isEmpty()) return null;
        PackageManager pm = getContext().getPackageManager();

        ResolveInfo prefix = null;
        ResolveInfo contains = null;
        for (ResolveInfo info : launchable()) {
            String label = simplify(String.valueOf(info.loadLabel(pm)));
            if (label.isEmpty()) continue;
            if (label.equals(wanted)) return info;
            if (prefix == null && label.startsWith(wanted)) prefix = info;
            if (contains == null && label.contains(wanted)) contains = info;
        }
        return prefix != null ? prefix : contains;
    }

    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSArray apps = new JSArray();
        for (ResolveInfo info : launchable()) {
            JSObject app = new JSObject();
            app.put("label", String.valueOf(info.loadLabel(pm)));
            app.put("package", info.activityInfo.packageName);
            apps.put(app);
        }
        call.resolve(new JSObject().put("apps", apps));
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String name = call.getString("name", "");
        ResolveInfo match = bestMatch(name);
        if (match == null) {
            // Not an error: the app genuinely is not on this phone, and the
            // page says so out loud rather than reporting a failure.
            call.resolve(new JSObject().put("opened", false).put("reason", "not-installed"));
            return;
        }
        String pkg = match.activityInfo.packageName;
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (intent == null) {
            call.resolve(new JSObject().put("opened", false).put("reason", "not-launchable"));
            return;
        }
        if (!launch(intent)) {
            call.resolve(new JSObject().put("opened", false).put("reason", "refused"));
            return;
        }
        String label = String.valueOf(match.loadLabel(getContext().getPackageManager()));
        call.resolve(new JSObject()
            .put("opened", true).put("package", pkg).put("label", label));
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url == null ? "" : url.trim());
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        // Only the two schemes a spoken request can reasonably mean. See the
        // note at the top of this file.
        if (!scheme.equals("http") && !scheme.equals("https")) {
            call.reject("Only http and https addresses can be opened");
            return;
        }
        boolean ok = launch(new Intent(Intent.ACTION_VIEW, uri));
        call.resolve(ok
            ? new JSObject().put("opened", true)
            : new JSObject().put("opened", false).put("reason", "no-browser"));
    }

    /**
     * Ask whatever plays music on this phone to play something.
     *
     * INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH is the system's own "play this"
     * request; the user's chosen music app answers it. Naming a package
     * instead would mean picking a music service on their behalf.
     */
    @PluginMethod
    public void playMusic(PluginCall call) {
        String query = call.getString("query", "");
        Intent play = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
        if (query != null && !query.trim().isEmpty()) {
            play.putExtra(SearchManager.QUERY, query.trim());
            play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
        }
        boolean ok = launch(play);
        call.resolve(ok
            ? new JSObject().put("opened", true)
            : new JSObject().put("opened", false).put("reason", "no-music-app"));
    }

    /**
     * YouTube, either a search or a specific video.
     *
     * The app is preferred when it is installed, because a video opened in the
     * app behaves the way people expect on a phone. Falling back to the web
     * address rather than reporting failure means this still works on a device
     * without the YouTube app.
     */
    @PluginMethod
    public void openYouTube(PluginCall call) {
        String query = call.getString("query", "");
        String text = query == null ? "" : query.trim();
        PackageManager pm = getContext().getPackageManager();
        Intent search = new Intent(Intent.ACTION_SEARCH)
            .setPackage("com.google.android.youtube")
            .putExtra("query", text);
        if (!text.isEmpty() && search.resolveActivity(pm) != null && launch(search)) {
            call.resolve(new JSObject().put("opened", true).put("via", "app"));
            return;
        }
        Uri web = Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(text));
        boolean ok = launch(new Intent(Intent.ACTION_VIEW, web));
        call.resolve(ok
            ? new JSObject().put("opened", true).put("via", "web")
            : new JSObject().put("opened", false).put("reason", "no-browser"));
    }

    /**
     * Arm the floating window, to be entered when this app steps aside.
     *
     * The ordering here is forced and the logs say why. Launching another app
     * is permitted because of BAL_ALLOW_VISIBLE_WINDOW - "callingUid has
     * visible non-pinned window". A picture-in-picture window *is* pinned, so
     * floating first would take away the very thing that allows the launch.
     * Floating afterwards does not work either: by then the launched app is
     * resumed and this one is not, and enterPictureInPictureMode is only
     * honoured for a foreground activity.
     *
     * setAutoEnterEnabled resolves it. The window is armed while still in
     * front, the launch proceeds under the allowance it needs, and Android
     * puts this activity into the floating window itself as it leaves - the
     * moment the other app arrives, which is exactly when it should happen.
     *
     * Added in API 31. Below that the caller is told it is not armed and the
     * app simply stays full screen behind whatever opened, rather than being
     * told it floated when it did not.
     */
    @PluginMethod
    public void prepareFloating(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || !getActivity().getPackageManager()
                    .hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            call.resolve(new JSObject().put("armed", false).put("reason", "unsupported"));
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().setPictureInPictureParams(
                    new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(9, 16))
                        .setAutoEnterEnabled(true)
                        .build());
                armed = true;
                call.resolve(new JSObject().put("armed", true));
            } catch (Exception e) {
                Log.w(TAG, "prepareFloating failed", e);
                call.resolve(new JSObject().put("armed", false).put("reason", "refused"));
            }
        });
    }

    /** True while auto-enter is set, so it can be taken back off again. */
    private boolean armed = false;

    /**
     * Stop floating on every exit.
     *
     * Auto-enter is a property of the activity, not of one launch, so leaving
     * it on would put the app in a floating window every time the user pressed
     * Home for any reason - which nobody asked for. It is disarmed as soon as
     * the user comes back.
     */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (!armed || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        armed = false;
        try {
            getActivity().setPictureInPictureParams(
                new PictureInPictureParams.Builder().setAutoEnterEnabled(false).build());
        } catch (Exception e) {
            Log.w(TAG, "could not disarm the floating window", e);
        }
    }

    /**
     * Float immediately, for a caller that wants it without launching anything.
     *
     * Picture-in-picture arrived in API 26 and minSdk here is 24, so this
     * reports back rather than throwing on an older phone - the caller then
     * simply leaves the app full screen instead of believing it floated.
     */
    @PluginMethod
    public void enterFloating(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(new JSObject().put("floating", false).put("reason", "unsupported"));
            return;
        }
        if (!getActivity().getPackageManager()
                .hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            call.resolve(new JSObject().put("floating", false).put("reason", "unsupported"));
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                // Taller than wide, because the call screen is a portrait
                // layout; a 16:9 window would letterbox the character.
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(9, 16))
                    .build();
                boolean ok = getActivity().enterPictureInPictureMode(params);
                call.resolve(new JSObject().put("floating", ok));
            } catch (Exception e) {
                Log.w(TAG, "enterFloating failed", e);
                call.resolve(new JSObject().put("floating", false).put("reason", "refused"));
            }
        });
    }
}
