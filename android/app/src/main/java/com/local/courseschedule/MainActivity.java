package com.local.courseschedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Locale;


public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1004;
    private WebView webView;
    private NativeBridge nativeBridge;
    private ValueCallback<Uri[]> fileChooserCallback;
    private File pendingUpdate;
    private String pendingCourseDate = "";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pendingCourseDate = getIntent().getStringExtra("courseDate");
        removeLegacyVisionSecrets(this);
        removeCampusMapData(this);
        CourseNotificationScheduler.createChannel(this);
        getWindow().setStatusBarColor(Color.rgb(23, 59, 87));
        getWindow().setNavigationBarColor(Color.rgb(251, 250, 247));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(251, 250, 247));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        nativeBridge = new NativeBridge(this);
        webView.addJavascriptInterface(nativeBridge, "CourseAppNative");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    return false;
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                return !url.startsWith("file:///android_asset/");
            }
        });
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        CourseNotificationScheduler.reschedule(this);
        sendNotificationSettingsChanged();
        if (pendingUpdate != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getPackageManager().canRequestPackageInstalls())) {
            File update = pendingUpdate;
            pendingUpdate = null;
            installUpdate(update);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String courseDate = intent.getStringExtra("courseDate");
        if (courseDate != null && !courseDate.isEmpty()) {
            pendingCourseDate = courseDate;
            sendOpenCourseDate(courseDate);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            CourseNotificationScheduler.reschedule(this);
            sendNotificationSettingsChanged();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = null;
            }
            webView.removeJavascriptInterface("CourseAppNative");
            webView.destroy();
        }
        super.onDestroy();
    }

    private void sendUpdateResult(JSONObject result) {
        String argument = JSONObject.quote(result.toString());
        webView.post(() -> webView.evaluateJavascript("window.onNativeUpdateCheck(" + argument + ")", null));
    }

    private void sendUpdateStatus(String message, boolean error) {
        String script = "window.onNativeUpdateStatus(" + JSONObject.quote(message) + "," + error + ")";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void sendNotificationSettingsChanged() {
        if (webView != null) webView.post(() -> webView.evaluateJavascript("window.onNativeNotificationSettingsChanged?.()", null));
    }

    private void sendOpenCourseDate(String date) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(
                "window.onNativeNotificationOpen?.(" + JSONObject.quote(date) + ")", null));
    }

    private static void removeLegacyVisionSecrets(Context context) {
        SharedPreferences preferences = context.getSharedPreferences("course_schedule", Context.MODE_PRIVATE);
        if (preferences.getBoolean("vision_removed_1_4_3", false)) return;
        boolean secretsCleared = context.getSharedPreferences("deepseek_secrets", Context.MODE_PRIVATE).edit().clear().commit();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) context.deleteSharedPreferences("deepseek_secrets");
        boolean keyCleared = false;
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias("course_schedule_deepseek_key")) keyStore.deleteEntry("course_schedule_deepseek_key");
            keyCleared = true;
        } catch (Exception ignored) {
        }
        if (secretsCleared && keyCleared) preferences.edit().putBoolean("vision_removed_1_4_3", true).commit();
    }

    private static void removeCampusMapData(Context context) {
        SharedPreferences preferences = context.getSharedPreferences("course_schedule", Context.MODE_PRIVATE);
        if (preferences.getBoolean("maps_removed_1_5_0", false)) return;
        preferences.edit().remove("campus_maps_json").commit();
        File mapsDirectory = new File(context.getFilesDir(), "campus_maps");
        if (mapsDirectory.exists()) deleteRecursively(mapsDirectory);
        preferences.edit().putBoolean("maps_removed_1_5_0", true).commit();
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }

    private void installUpdate(File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            pendingUpdate = apk;
            sendUpdateStatus("请先允许此应用安装未知来源应用，返回后将继续安装", false);
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()));
            startActivity(settingsIntent);
            return;
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(uri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(installIntent);
    }

    private final class NativeBridge {
        private static final String PREFERENCES = "course_schedule";
        private static final String STATE_KEY = "state_json";
        private static final String PRIVACY_RESET_KEY = "privacy_reset_1_3";
        private final Context context;
        private final SharedPreferences preferences;

        NativeBridge(Context context) {
            this.context = context.getApplicationContext();
            this.preferences = this.context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        }

        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public String getPlatform() {
            return "Android";
        }

        @JavascriptInterface
        public String getNotificationSettings() {
            try {
                return CourseNotificationScheduler.settings(context).toString();
            } catch (Exception error) {
                return "{\"ok\":false,\"error\":\"无法读取提醒设置\"}";
            }
        }

        @JavascriptInterface
        public String saveNotificationSettings(boolean enabled, int leadMinutes, boolean showDetails) {
            JSONObject result = new JSONObject();
            try {
                CourseNotificationScheduler.saveSettings(context, enabled, leadMinutes, showDetails);
                result.put("ok", true);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public String requestNotificationPermission() {
            JSONObject result = new JSONObject();
            try {
                SharedPreferences notificationPreferences = context.getSharedPreferences("course_notifications", Context.MODE_PRIVATE);
                boolean alreadyRequested = notificationPreferences.getBoolean("permission_requested", false);
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        && !alreadyRequested) {
                    notificationPreferences.edit().putBoolean("permission_requested", true).apply();
                    webView.post(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST));
                    result.put("ok", true).put("requested", true);
                } else if (!CourseNotificationScheduler.notificationsGranted(context)) {
                    Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    webView.post(() -> startActivity(intent));
                    result.put("ok", true).put("requested", false).put("openedSettings", true);
                } else {
                    result.put("ok", true).put("requested", false).put("openedSettings", false);
                }
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public String openExactAlarmSettings() {
            JSONObject result = new JSONObject();
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()));
                    webView.post(() -> startActivity(intent));
                }
                result.put("ok", true);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public String sendTestNotification() {
            JSONObject result = new JSONObject();
            try {
                CourseNotificationScheduler.showTestNotification(context);
                result.put("ok", true);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public String getLaunchCourseDate() {
            String date = pendingCourseDate == null ? "" : pendingCourseDate;
            pendingCourseDate = "";
            return date;
        }

        private String safeMessage(Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) return "操作失败";
            message = message.replace('\n', ' ').replace('\r', ' ').trim();
            return message.length() > 240 ? message.substring(0, 240) : message;
        }

        @JavascriptInterface
        public void checkForUpdate() {
            new Thread(() -> {
                HttpURLConnection connection = null;
                try {
                    URL url = new URL("https://api.github.com/repos/" + BuildConfig.UPDATE_REPOSITORY + "/releases/latest");
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(12000);
                    connection.setReadTimeout(12000);
                    connection.setRequestProperty("Accept", "application/vnd.github+json");
                    connection.setRequestProperty("User-Agent", "CourseSchedule-Android/" + BuildConfig.VERSION_NAME);
                    int status = connection.getResponseCode();
                    if (status != HttpURLConnection.HTTP_OK) throw new Exception("GitHub 返回 " + status);
                    String body = readText(connection.getInputStream());
                    JSONObject release = new JSONObject(body);
                    JSONArray assets = release.getJSONArray("assets");
                    String apkUrl = "";
                    for (int index = 0; index < assets.length(); index += 1) {
                        JSONObject asset = assets.getJSONObject(index);
                        if (asset.optString("name").toLowerCase(Locale.ROOT).endsWith(".apk")) {
                            apkUrl = asset.getString("browser_download_url");
                            break;
                        }
                    }
                    JSONObject result = new JSONObject();
                    result.put("ok", true);
                    result.put("currentVersion", BuildConfig.VERSION_NAME);
                    result.put("latestVersion", release.optString("tag_name").replaceFirst("^[vV]", ""));
                    result.put("apkUrl", apkUrl);
                    result.put("releaseUrl", release.optString("html_url"));
                    String releaseNotes = release.optString("body");
                    result.put("releaseNotes", releaseNotes.length() > 2000 ? releaseNotes.substring(0, 2000) : releaseNotes);
                    result.put("publishedAt", release.optString("published_at"));
                    sendUpdateResult(result);
                } catch (Exception error) {
                    JSONObject result = new JSONObject();
                    try {
                        result.put("ok", false);
                        result.put("error", "检查失败：" + error.getMessage());
                    } catch (Exception ignored) {
                    }
                    sendUpdateResult(result);
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }, "course-update-check").start();
        }

        @JavascriptInterface
        public void downloadUpdate(String url) {
            new Thread(() -> {
                HttpURLConnection connection = null;
                try {
                    URL source = new URL(url);
                    String host = source.getHost().toLowerCase(Locale.ROOT);
                    if (!"https".equals(source.getProtocol()) || !(host.equals("github.com") || host.endsWith(".githubusercontent.com"))) {
                        throw new Exception("下载地址不受信任");
                    }
                    sendUpdateStatus("正在从 GitHub 下载新版…", false);
                    connection = (HttpURLConnection) source.openConnection();
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestProperty("User-Agent", "CourseSchedule-Android/" + BuildConfig.VERSION_NAME);
                    if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                        throw new Exception("下载返回 " + connection.getResponseCode());
                    }
                    File directory = new File(getCacheDir(), "updates");
                    if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建更新缓存");
                    File apk = new File(directory, "CourseSchedule-update.apk");
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                        byte[] buffer = new byte[16384];
                        int count;
                        long total = 0;
                        while ((count = input.read(buffer)) != -1) {
                            total += count;
                            if (total > 200L * 1024L * 1024L) throw new Exception("安装包大小异常");
                            output.write(buffer, 0, count);
                        }
                    }
                    if (apk.length() < 1024) throw new Exception("下载的安装包无效");
                    sendUpdateStatus("下载完成，正在打开系统安装界面", false);
                    webView.post(() -> installUpdate(apk));
                } catch (Exception error) {
                    sendUpdateStatus("下载失败：" + error.getMessage(), true);
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }, "course-update-download").start();
        }

        @JavascriptInterface
        public String loadState() {
            if (!preferences.getBoolean(PRIVACY_RESET_KEY, false)) {
                preferences.edit().remove(STATE_KEY).putBoolean(PRIVACY_RESET_KEY, true).commit();
            }
            String saved = preferences.getString(STATE_KEY, null);
            if (saved != null && isValid(saved)) {
                return saved;
            }
            return "{\"version\":2,\"semester\":{\"name\":\"课程表\",\"weekOneStart\":\"2026-08-31\",\"classStartDate\":\"2026-08-31\",\"totalWeeks\":19,\"campus\":\"\"},\"periods\":[],\"sessions\":[]}";
        }

        @JavascriptInterface
        public String saveState(String json) {
            if (!isValid(json)) {
                return "{\"ok\":false,\"error\":\"课程数据结构不合法\"}";
            }
            boolean saved = preferences.edit().putString(STATE_KEY, json).commit();
            if (saved) CourseNotificationScheduler.reschedule(context);
            return saved ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"手机存储写入失败\"}";
        }

        private boolean isValid(String json) {
            try {
                JSONObject state = new JSONObject(json);
                JSONObject semester = state.getJSONObject("semester");
                JSONArray sessions = state.getJSONArray("sessions");
                boolean hasDates = (semester.has("weekOneStart") && semester.has("classStartDate")) || semester.has("firstDay");
                return hasDates && sessions.length() <= 500;
            } catch (Exception ignored) {
                return false;
            }
        }

        private String readText(InputStream input) throws Exception {
            try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = source.read(buffer)) != -1) output.write(buffer, 0, count);
                return output.toString(StandardCharsets.UTF_8.name());
            }
        }

    }
}
