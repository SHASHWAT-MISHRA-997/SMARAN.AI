package ai.smaran.app;

import android.os.Bundle;
import android.graphics.Rect;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.webkit.PermissionRequest;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.net.URI;

/** Request microphone/camera permission when our page actually needs it. */
public class MainActivity extends BridgeActivity {
    /** The dispatcher runs before the IME gets a chance to consume Back. */
    private boolean isKeyboardVisible() {
        View decor = getWindow().getDecorView();
        Rect visible = new Rect();
        decor.getWindowVisibleDisplayFrame(visible);
        int fullHeight = decor.getRootView().getHeight();
        return fullHeight > 0 && (fullHeight - visible.bottom) > (fullHeight * 0.15f);
    }

    static boolean sameOrigin(String requested, String trusted) {
        try {
            URI a = new URI(requested);
            URI b = new URI(trusted);
            return a.getHost() != null && b.getHost() != null
                && a.getScheme() != null && b.getScheme() != null
                && a.getHost().equalsIgnoreCase(b.getHost())
                && a.getScheme().equalsIgnoreCase(b.getScheme())
                && originPort(a) == originPort(b);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static int originPort(URI uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    /**
     * Tell the page when it is floating, so it can show the character alone.
     *
     * A picture-in-picture window is roughly a quarter the width of the phone.
     * The call screen laid out for a full screen does not survive that: the
     * header, the caption - which may take half the height - and the footer are
     * all fixed, so the figure between them is squeezed to nothing and the
     * floating window shows everything except the character, which is the one
     * thing anyone put it there to watch.
     *
     * The page cannot detect this on its own. A WebView is not told it is in a
     * picture-in-picture window; the size changes and nothing says why, and a
     * width test would also catch a small phone in split screen.
     */
    @Override
    public void onPictureInPictureModeChanged(boolean inPictureInPicture,
                                              android.content.res.Configuration config) {
        super.onPictureInPictureModeChanged(inPictureInPicture, config);
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "document.documentElement.classList.toggle('sm-pip', " + inPictureInPicture + ");"
            + "window.dispatchEvent(new CustomEvent('smaran:pip',{detail:{floating:"
            + inPictureInPicture + "}}));",
            null);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmaranSpeech.class);
        registerPlugin(SmaranDevice.class);
        super.onCreate(savedInstanceState);
        // BridgeActivity displays its own error screen when WebView is missing.
        if (getBridge() == null) return;
        // Android 15+ draws edge to edge. Keep the entire WebView, including
        // fixed call controls, clear of the status bar and display cutout.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean dispatching;

            @Override
            public void handleOnBackPressed() {
                if (dispatching) return;
                if (getBridge() == null || getBridge().getWebView() == null) {
                    setEnabled(false);
                    MainActivity.super.onBackPressed();
                    return;
                }
                // A focused textarea with the keyboard up is a layer above the
                // page. Dismissing it must not be interpreted as “leave the
                // app” just because no modal is open in the page history.
                if (isKeyboardVisible()) {
                    View webView = getBridge().getWebView();
                    InputMethodManager input = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (input != null) input.hideSoftInputFromWindow(webView.getWindowToken(), 0);
                    webView.clearFocus();
                    return;
                }
                dispatching = true;
                getBridge().getWebView().evaluateJavascript(
                    "(typeof window.__smaranHandleAndroidBack === 'function' "
                        + "&& window.__smaranHandleAndroidBack()) ? 'handled' : 'unhandled'",
                    result -> runOnUiThread(() -> {
                        dispatching = false;
                        if ("\"handled\"".equals(result) || "true".equals(result)) return;
                        setEnabled(false);
                        MainActivity.super.onBackPressed();
                    })
                );
            }
        });
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!sameOrigin(request.getOrigin().toString(), getBridge().getLocalUrl())) {
                        request.deny();
                        return;
                    }
                    for (String resource : request.getResources()) {
                        if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                                && !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            request.deny();
                            return;
                        }
                    }
                    // Capacitor asks Android for missing runtime permissions and
                    // completes this request after the user's answer. Checking
                    // only existing grants made camera permission unreachable.
                    super.onPermissionRequest(request);
                });
            }
        });
    }
}
