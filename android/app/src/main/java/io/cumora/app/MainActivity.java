package io.cumora.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App plugins are appended after Capacitor's auto-discovered plugins,
        // so this replaces the PushNotifications handle with the guarded one.
        initialPlugins.add(CumoraPushNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) {
            // Capacitor serves the bundle from https://localhost. The debug
            // network config still restricts cleartext to the selected host.
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}
