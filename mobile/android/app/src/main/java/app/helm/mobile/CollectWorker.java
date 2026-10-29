package app.helm.mobile;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * The background task: every 15 minutes or so, as Android allows, collect what the paired computers are holding for this phone and show it
 * as notifications. The protocol is TypeScript, so this starts a hidden web view on the app's own `collect.html` and gives it a few native
 * functions (preferences, a UDP socket, a notification, "done"). It never shows anything itself.
 */
public class CollectWorker extends Worker {
    private static final String CHANNEL = "helm_notices";
    private static final String PREFS = "CapacitorStorage"; // where @capacitor/preferences keeps the instance list

    public CollectWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    public static void schedule(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(CollectWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("helm-collect", ExistingPeriodicWorkPolicy.KEEP, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        final Context context = getApplicationContext();
        // Nothing to do until a computer has been added.
        String saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("helm.instances", null);
        if (saved == null || !saved.contains("\"desktop\"")) return Result.success();

        final CountDownLatch done = new CountDownLatch(1);
        final Handler main = new Handler(Looper.getMainLooper());
        final WebView[] web = new WebView[1];
        final HelmUdp[] udp = new HelmUdp[1];
        main.post(() -> {
            web[0] = new WebView(context);
            web[0].getSettings().setJavaScriptEnabled(true);
            udp[0] = new HelmUdp((id, data, host, port) -> main.post(() -> {
                if (web[0] == null) return;
                String js = "window.__helmUdp&&window.__helmUdp(" + id + ",'" + Base64.encodeToString(data, Base64.NO_WRAP) + "','" + host.replace("'", "") + "'," + port + ")";
                web[0].evaluateJavascript(js, null);
            }));
            web[0].addJavascriptInterface(new Host(context, udp[0], done), "HelmHeadless");
            final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(context)).build();
            web[0].setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return loader.shouldInterceptRequest(request.getUrl());
                }
            });
            web[0].loadUrl("https://appassets.androidplatform.net/assets/public/collect.html");
        });
        try {
            done.await(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        main.post(() -> {
            if (udp[0] != null) udp[0].closeAll();
            if (web[0] != null) { web[0].destroy(); web[0] = null; }
        });
        return Result.success();
    }

    /** What the hidden page can call. Methods run on a web view thread, not the main one. */
    private static final class Host {
        private final Context context;
        private final HelmUdp udp;
        private final CountDownLatch done;

        Host(Context context, HelmUdp udp, CountDownLatch done) { this.context = context; this.udp = udp; this.done = done; }

        private SharedPreferences prefs() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

        @JavascriptInterface public String getPref(String key) { return prefs().getString(key, null); }
        @JavascriptInterface public void setPref(String key, String value) { prefs().edit().putString(key, value).apply(); }
        @JavascriptInterface public int udpBind() { try { return udp.bind(); } catch (Exception e) { return -1; } }
        @JavascriptInterface public void udpSend(int id, String data, String host, int port) { udp.send(id, Base64.decode(data, Base64.NO_WRAP), host, port); }
        @JavascriptInterface public void udpClose(int id) { udp.close(id); }
        @JavascriptInterface public void done(int shown) { done.countDown(); }

        @JavascriptInterface
        public void notify(String json) {
            try {
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
                JSONObject n = new JSONObject(json);
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Agents", NotificationManager.IMPORTANCE_DEFAULT));
                // Tapping opens the app on the session: a link the app handles (see openUrl in mobile/src/open.ts).
                Uri link = new Uri.Builder().scheme("helm").authority("open")
                    .appendQueryParameter("instance", n.optString("instanceId"))
                    .appendQueryParameter("session", n.optString("sessionId"))
                    .appendQueryParameter("kind", n.optString("kind")).build();
                Intent open = new Intent(Intent.ACTION_VIEW, link, context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent tap = PendingIntent.getActivity(context, n.optString("id").hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_helm)
                    .setContentTitle(n.optString("title"))
                    .setContentText(n.optString("body"))
                    .setSubText(n.optString("instanceName"))
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .setSilent(n.optBoolean("silent", false));
                manager.notify(n.optString("id").hashCode(), builder.build());
            } catch (Exception e) {
                // A notice that cannot be shown is dropped rather than failing the task.
            }
        }
    }
}
