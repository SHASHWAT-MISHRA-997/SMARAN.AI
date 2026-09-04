package ai.smaran.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Letting the page reach the microphone.
 *
 * This class was empty, and that is why voice never worked on the phone.
 *
 * Android's WebView has two permission layers and satisfying one does nothing
 * for the other. The manifest declares RECORD_AUDIO and Android may even show
 * its own prompt - but when the page calls getUserMedia, the WebView asks the
 * *application* through WebChromeClient.onPermissionRequest, and the default
 * answer is no. Nothing here answered it, so getUserMedia rejected every time
 * and the screen said "Voice input unavailable" on a phone whose microphone
 * was working perfectly.
 *
 * Both layers are handled here:
 *
 *   - the runtime permission is asked for on start, because a manifest entry
 *     alone has not been enough since Android 6;
 *   - the WebView's own request is then granted, but only for audio, only if
 *     Android has actually given us the permission, and only to our own page.
 *
 * BridgeWebChromeClient is subclassed rather than replaced. Capacitor's own
 * client handles file inputs, dialogs and geolocation; swapping it out for a
 * bare WebChromeClient would fix the microphone by breaking those.
 */
public class MainActivity extends BridgeActivity {

    private static final int MIC_REQUEST = 4101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                   != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this, new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
        }

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    // Only what was asked for, and only what this app is
                    // allowed to give. Granting the whole request blindly
                    // would hand over the camera as well.
                    java.util.List<String> allowed = new java.util.ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                                && ContextCompat.checkSelfPermission(
                                        MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                   == PackageManager.PERMISSION_GRANTED) {
                            allowed.add(resource);
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                                && ContextCompat.checkSelfPermission(
                                        MainActivity.this, Manifest.permission.CAMERA)
                                   == PackageManager.PERMISSION_GRANTED) {
                            allowed.add(resource);
                        }
                    }
                    if (allowed.isEmpty()) {
                        // Denying is the honest answer: the page then reports
                        // that it cannot record, rather than waiting forever.
                        request.deny();
                    } else {
                        request.grant(allowed.toArray(new String[0]));
                    }
                });
            }
        });
    }
}
