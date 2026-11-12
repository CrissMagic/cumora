package io.cumora.app;

import android.Manifest;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.firebase.FirebaseApp;

/** Keep optional FCM setup failures on the promise boundary, not the plugin thread. */
@CapacitorPlugin(
    name = "PushNotifications",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "receive")
)
public class CumoraPushNotificationsPlugin extends PushNotificationsPlugin {
    private boolean requireFirebase(PluginCall call) {
        try {
            FirebaseApp.getInstance();
            return true;
        } catch (IllegalStateException missingConfiguration) {
            call.reject(
                "Push notifications are unavailable in this Android build: Firebase is not configured.",
                "PUSH_NOT_CONFIGURED"
            );
            return false;
        }
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        // A build without FCM cannot deliver notifications, so do not prompt.
        if (requireFirebase(call)) super.requestPermissions(call);
    }

    @Override
    @PluginMethod
    public void register(PluginCall call) {
        if (!requireFirebase(call)) return;
        try {
            super.register(call);
        } catch (IllegalStateException registrationFailure) {
            call.reject("Push notification registration failed.", "PUSH_REGISTRATION_FAILED", registrationFailure);
        }
    }

    @Override
    @PluginMethod
    public void unregister(PluginCall call) {
        if (!requireFirebase(call)) return;
        try {
            super.unregister(call);
        } catch (IllegalStateException registrationFailure) {
            call.reject("Push notification unregistration failed.", "PUSH_REGISTRATION_FAILED", registrationFailure);
        }
    }
}
