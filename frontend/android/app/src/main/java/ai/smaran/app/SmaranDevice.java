package ai.smaran.app;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
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
    static final String PREFS = "smaran_voice";
    static final String STOPPED_BY_USER = "stopped_by_user";

    /* The plugin instance the listening service reports to, and a question
       asked out loud that the page has not picked up yet. */
    private static SmaranDevice active;
    private static String pendingQuery;

    /* "Hey SMARAN" heard while the app was elsewhere: the words after it
       (possibly none). Null when there is no wake waiting. */
    private static String pendingWake;

    static synchronized void setPendingWake(String rest) {
        pendingWake = rest;
    }

    private static synchronized String takeWake() {
        String rest = pendingWake;
        pendingWake = null;
        return rest;
    }

    /** Tell a running page the voice call is wanted; a page still loading takes it on start. */
    static void announceWake() {
        SmaranDevice plugin = active;
        if (plugin == null || !plugin.hasListeners("wake")) return;
        String rest = takeWake();
        if (rest != null) {
            plugin.notifyListeners("wake", new JSObject().put("rest", rest).put("fromBackground", true));
        }
    }

    /**
     * Back to whatever was in front before "Hey SMARAN" brought this app up.
     *
     * Not closed, and not killed: this phone kills an app outright when it is
     * swiped away from the recent apps, background listening and all, and
     * swiping was the only way back - so the wake word died after every use.
     */
    @PluginMethod
    public void moveToBack(PluginCall call) {
        android.app.Activity activity = getActivity();
        if (activity == null) {
            call.resolve(new JSObject().put("moved", false));
            return;
        }
        activity.runOnUiThread(() -> {
            boolean moved = activity.moveTaskToBack(true);
            call.resolve(new JSObject().put("moved", moved));
        });
    }

    /** A wake waiting for the page, if any: {woke, rest}. */
    @PluginMethod
    public void takePendingWake(PluginCall call) {
        String rest = takeWake();
        call.resolve(new JSObject().put("woke", rest != null).put("rest", rest == null ? "" : rest));
    }

    static synchronized void setPendingQuery(String query) {
        pendingQuery = query;
    }

    private static synchronized String takeQuery() {
        String query = pendingQuery;
        pendingQuery = null;
        return query;
    }

    /** Tell a running page that a question is waiting for it. */
    static void announceQuery() {
        SmaranDevice plugin = active;
        if (plugin != null) plugin.notifyListeners("voiceQuery", new JSObject());
    }

    @Override
    public void load() {
        active = this;
        // "Hey SMARAN" heard while the app is on screen: the page's own voice
        // call takes it from there, character and model included.
        SmaranVoiceService.pageSink = new SmaranVoiceService.PageSink() {
            @Override
            public boolean onWake(String rest) {
                SmaranDevice plugin = active;
                if (plugin == null || !plugin.hasListeners("wake")) return false;
                plugin.notifyListeners("wake", new JSObject().put("rest", rest));
                return true;
            }

            @Override
            public boolean onInterrupt(String name) {
                SmaranDevice plugin = active;
                if (plugin == null || !plugin.hasListeners("wake")) return false;
                plugin.notifyListeners("wake", new JSObject().put("rest", "").put("interrupt", true).put("name", name));
                return true;
            }
        };
    }

    /** The call is speaking an answer: the wake listener may interrupt it. */
    @PluginMethod
    public void setPageSpeaking(PluginCall call) {
        boolean speaking = Boolean.TRUE.equals(call.getBoolean("speaking", false));
        new android.os.Handler(android.os.Looper.getMainLooper())
            .post(() -> SmaranVoiceService.setPageSpeaking(speaking));
        call.resolve();
    }

    /** The page opened or closed its microphone; the wake listener steps aside meanwhile. */
    @PluginMethod
    public void setPageListening(PluginCall call) {
        boolean listening = Boolean.TRUE.equals(call.getBoolean("listening", false));
        new android.os.Handler(android.os.Looper.getMainLooper())
            .post(() -> SmaranVoiceService.setPageListening(listening));
        call.resolve(new JSObject().put("listening", listening));
    }

    /** Whether SMARAN's accessibility service is on (it presses play and Skip ad). */
    @PluginMethod
    public void accessibilityStatus(PluginCall call) {
        call.resolve(new JSObject().put("enabled", SmaranAccessibility.enabled()));
    }

    /** Android's Accessibility page, where SMARAN.AI is switched on. */
    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        call.resolve(new JSObject().put("opened", SmaranAccessibility.openSettings(getContext())));
    }

    /** Press the Skip button on an ad, if the accessibility service is on. */
    @PluginMethod
    public void skipAd(PluginCall call) {
        String result = SmaranAccessibility.skipAd();
        if ("not-enabled".equals(result)) SmaranAccessibility.openSettings(getContext());
        call.resolve(new JSObject()
            .put("skipped", "skipped".equals(result))
            .put("result", result)
            .put("said", SmaranAccessibility.describe(result)));
    }

    /** A question said to "Hey SMARAN" while the app was away, if one is waiting. */
    @PluginMethod
    public void takePendingQuery(PluginCall call) {
        String query = takeQuery();
        call.resolve(new JSObject().put("query", query == null ? "" : query));
    }

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
        // NEW_TASK puts the launched app in its own task. RESET_TASK_IF_NEEDED
        // is here because of the floating window, not the launch.
        //
        // Auto-enter picture-in-picture fires when this activity goes to the
        // background the way leaving it does. "open WhatsApp" floated and
        // "youtube par ... search karo" did not, and the difference was the
        // intent: getLaunchIntentForPackage returns a launcher intent carrying
        // both flags, while the YouTube search intent had only NEW_TASK and was
        // then forwarded on internally by YouTube - which brought its existing
        // task forward without this one ever leaving properly.
        //
        // Giving every launch the same task semantics as the one that already
        // worked is the smaller fix. The alternative - asking for the floating
        // window explicitly after the launch - races the activity losing focus,
        // and asking before it removes the visible non-pinned window the launch
        // itself depends on.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
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
        // One matcher for the page and the listening service alike; this was a
        // second copy, and the two had already started to differ.
        return DeviceActions.findApp(getContext(), spoken);
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
        // Named by the person ("... Spotify par play karo"): that app only. A
        // service that is not installed is said plainly rather than handed to
        // whichever other player happens to answer.
        String app = call.getString("app", "");
        String pkg = DeviceActions.musicPackage(app);
        boolean ok = launch(DeviceActions.musicIntent(query, pkg));
        // Spotify opens on its search; with the accessibility service on, the
        // song is pressed so it actually plays.
        if (ok && DeviceActions.opensSearch(pkg, query) && SmaranAccessibility.enabled()) {
            SmaranAccessibility.tapSpotifySong(query, tapped -> call.resolve(new JSObject()
                .put("opened", true).put("mode", tapped ? "play" : "search")));
            return;
        }
        boolean search = DeviceActions.opensSearch(pkg, query);
        call.resolve(ok
            ? new JSObject().put("opened", true)
                .put("mode", search ? "search" : "play")
                // Said so the page can offer the switch that makes it play.
                .put("needsAccessibility", search && !SmaranAccessibility.enabled())
            : new JSObject().put("opened", false)
                .put("reason", pkg != null ? "not-installed" : "no-music-app"));
    }

    /**
     * YouTube, either a search or a specific video.
     *
     * Two ways in, and the order matters. `ACTION_SEARCH` aimed at the YouTube
     * package opens the results inside the app, which is what a phone user
     * expects. The web address is the fallback and works everywhere, including
     * a device with no YouTube app - it simply opens the app anyway if one is
     * installed and claims the link.
     *
     * `resolveActivity` deliberately does *not* gate this any more. Since
     * Android 11 it answers through the package-visibility filter, so it
     * returns null for a package this app has not declared an interest in -
     * even one that handles the intent perfectly well. The manifest lists
     * MAIN/LAUNCHER and a couple of others, not ACTION_SEARCH, so the check
     * failed here and reported no YouTube on a phone that plainly has it.
     * Trying the launch and catching the failure asks the real question.
     */
    /** Play/pause/stop/next/previous/volume for whatever app holds playback. */
    @PluginMethod
    public void mediaControl(PluginCall call) {
        String control = call.getString("control", "");
        String said = DeviceActions.performMedia(getContext(), control == null ? "" : control);
        call.resolve(new JSObject().put("opened", !said.isEmpty() && !said.startsWith("Nothing"))
            .put("said", said));
    }

    /** The top YouTube result for the words, opened so it plays. Falls back to search. */
    @PluginMethod
    public void playYouTube(PluginCall call) {
        String query = call.getString("query", "");
        new Thread(() -> {
            String id = DeviceActions.firstYouTubeVideo(query);
            if (id != null && launch(DeviceActions.youTubeVideo(id))) {
                call.resolve(new JSObject().put("opened", true).put("mode", "play").put("videoId", id));
                return;
            }
            Intent search = new Intent(Intent.ACTION_SEARCH)
                .setPackage("com.google.android.youtube").putExtra("query", query == null ? "" : query.trim());
            boolean ok = launch(search);
            call.resolve(new JSObject().put("opened", ok).put("mode", "search"));
        }, "youtube-lookup").start();
    }

    @PluginMethod
    public void openYouTube(PluginCall call) {
        String query = call.getString("query", "");
        String text = query == null ? "" : query.trim();
        Intent search = new Intent(Intent.ACTION_SEARCH)
            .setPackage("com.google.android.youtube")
            .putExtra("query", text);
        if (!text.isEmpty() && launch(search)) {
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
     * Start listening even when the app is not on screen.
     *
     * This is the answer to "the second command does nothing". The activity is
     * stopped as soon as another app opens, and a stopped activity does not
     * hear, does not run the page, and cannot float itself. The service is not
     * subject to any of that.
     */
    @PluginMethod
    public void startListeningService(PluginCall call) {
        // Checked here as well as in the service, because once
        // startForegroundService() has been called Android insists the service
        // go foreground - and without the microphone it cannot. Asking first
        // means a service that could never start is never started.
        if (getContext().checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            call.resolve(new JSObject().put("listening", false)
                .put("reason", "microphone-permission"));
            return;
        }
        // Stop, pressed on the notification, is the user's answer. An automatic
        // start - the app opening with "Hey SMARAN" switched on - respects it;
        // switching it on again, or opening a call, is a new answer.
        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
        if (Boolean.TRUE.equals(call.getBoolean("auto", false))) {
            if (prefs.getBoolean(STOPPED_BY_USER, false)) {
                call.resolve(new JSObject().put("listening", false).put("reason", "stopped-by-user"));
                return;
            }
        } else {
            prefs.edit().putBoolean(STOPPED_BY_USER, false).apply();
        }
        try {
            Intent service = new Intent(getContext(), SmaranVoiceService.class)
                .setAction(SmaranVoiceService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(service);
            } else {
                getContext().startService(service);
            }
            call.resolve(new JSObject().put("listening", true));
        } catch (Exception e) {
            Log.w(TAG, "could not start the listening service", e);
            call.resolve(new JSObject().put("listening", false)
                .put("reason", String.valueOf(e.getMessage())));
        }
    }

    @PluginMethod
    public void stopListeningService(PluginCall call) {
        getContext().stopService(new Intent(getContext(), SmaranVoiceService.class));
        call.resolve(new JSObject().put("listening", false));
    }

    /**
     * This app's page in Android Settings.
     *
     * Refuse the microphone twice and Android stops showing the prompt: every
     * later request is answered "denied" without asking anybody. From then on
     * the only place it can be turned back on is the app's own settings page,
     * and a Try again button that asks again can never succeed.
     */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent settings = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getContext().getPackageName(), null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception e) {
            Log.w(TAG, "could not open this app's settings", e);
            call.resolve(new JSObject().put("opened", false));
        }
    }

    /**
     * Hand text to Android's own share sheet - WhatsApp, Gmail, Telegram,
     * Drive, whatever the phone has.
     *
     * Android's WebView does not implement navigator.share, so the page's
     * Share button never appeared on a phone at all; the only choices left were
     * a public link that needed the PC switched on, and a file download.
     */
    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.resolve(new JSObject().put("shared", false).put("reason", "empty"));
            return;
        }
        try {
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, text)
                .putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "SMARAN.AI conversation"));
            Intent chooser = Intent.createChooser(send, call.getString("title", "Share"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve(new JSObject().put("shared", true));
        } catch (Exception e) {
            Log.w(TAG, "could not open the share sheet", e);
            call.resolve(new JSObject().put("shared", false).put("reason", String.valueOf(e.getMessage())));
        }
    }

    @PluginMethod
    public void isListeningService(PluginCall call) {
        call.resolve(new JSObject().put("listening", SmaranVoiceService.running));
    }

    /** Whether the app is in a floating window right now. */
    @PluginMethod
    public void isFloating(PluginCall call) {
        boolean floating = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
            && getActivity() != null
            && getActivity().isInPictureInPictureMode();
        call.resolve(new JSObject().put("floating", floating));
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

    /**
     * Say what actually went wrong with a Credential Manager failure.
     *
     * Every failure used to arrive as "Check your connection and Google
     * account, then retry", followed by the raw exception text - which sent
     * people to look at a network and a Google account that were both fine.
     *
     * The failure that matters here is "[16] Account reauth failed", which
     * Play services reports as TYPE_USER_CANCELED even though nobody
     * cancelled anything. It means Google's servers refused to mint a token
     * for this app: the account chooser appears, an account is picked, GMS
     * calls googleapis.com, and the answer is no. Observed identically on two
     * different Google accounts on the same device, so it is about the app,
     * not the account.
     *
     * The message below deliberately stops short of naming one cause. An
     * earlier version asserted the Android OAuth client was missing; that was
     * true at the time - Play services was logging DEVELOPER_ERROR then - but
     * once a client was registered the DEVELOPER_ERROR stopped and this error
     * did not, and a message that keeps insisting on a fix already applied is
     * worse than one that says what it knows. A mismatched fingerprint, a
     * client in the wrong project and a client that simply has not propagated
     * yet are indistinguishable from inside the app, and Google's own console
     * warns that changes take "five minutes to a few hours" to take effect.
     */
    private static String explain(GetCredentialException error) {
        String detail = error.getMessage() == null ? "" : error.getMessage();
        String type = error.getType() == null ? "" : error.getType();
        // The mapping below is a guess made from two strings, and a wrong guess
        // here is worse than no message: it sends someone to fix a thing that
        // was never broken. Play services does not log the cause under a tag
        // anyone would think to look for, so the raw pair is recorded here
        // where `adb logcat -s SmaranDevice` will show it.
        Log.w(TAG, "Google sign-in failed. type=" + type + " message=" + detail);
        if (detail.contains("[16]") || detail.contains("DEVELOPER_ERROR")
                || detail.contains("reauth")) {
            return "Google would not issue a sign-in token for this app. Its "
                + "Android OAuth client must list package ai.smaran.app with "
                + "this build's certificate fingerprint, in the same Google "
                + "Cloud project as the web client - and a change there can "
                + "take up to a few hours to take effect. Sign in with your "
                + "SMARAN.AI account meanwhile.";
        }
        if (type.endsWith("TYPE_NO_CREDENTIAL")) {
            return "No Google account is available on this phone. Add one in "
                + "Android Settings, or sign in with your SMARAN.AI account.";
        }
        if (type.endsWith("TYPE_USER_CANCELED")) {
            return "Google sign-in was cancelled.";
        }
        if (type.endsWith("TYPE_GET_CREDENTIAL_PROVIDER_CONFIGURATION")) {
            return "Google Play services is missing or out of date on this "
                + "phone, so Google sign-in cannot run here.";
        }
        return "Google sign-in could not finish. " + detail;
    }

    /** Google authenticates the account and returns an ID token, never just an email. */
    @PluginMethod
    public void chooseGoogleAccount(PluginCall call) {
        String clientId = call.getString("clientId");
        if (clientId == null || !clientId.endsWith(".apps.googleusercontent.com")) {
            call.reject("Google sign-in is not configured.");
            return;
        }
        // Which client id actually reached Google. It can come from the paired
        // backend rather than the built-in default, so "the id is right" is an
        // assumption worth being able to check rather than argue about.
        Log.i(TAG, "Google sign-in requested with client id " + clientId);
        getActivity().runOnUiThread(() -> {
            try {
                GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).build();
                GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
                CredentialManager.create(getContext()).getCredentialAsync(
                    getActivity(), request, new CancellationSignal(), ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override public void onResult(GetCredentialResponse result) {
                            try {
                                GoogleIdTokenCredential credential = GoogleIdTokenCredential.createFrom(result.getCredential().getData());
                                JSObject value = new JSObject();
                                value.put("credential", credential.getIdToken());
                                value.put("email", credential.getId());
                                value.put("name", credential.getDisplayName());
                                if (credential.getProfilePictureUri() != null) value.put("picture", credential.getProfilePictureUri().toString());
                                call.resolve(value);
                            } catch (Exception error) { call.reject("Google returned an invalid credential."); }
                        }
                        @Override public void onError(GetCredentialException error) {
                            call.reject(explain(error), error.getType());
                        }
                    });
            } catch (Exception error) { call.reject("Google sign-in could not open: " + error.getMessage()); }
        });
    }
}
