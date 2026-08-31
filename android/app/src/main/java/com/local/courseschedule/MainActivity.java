package com.local.courseschedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Collections;
import java.util.Locale;
import java.util.UUID;


public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int MAP_PICKER_REQUEST = 1002;
    private static final int PDF_MAP_EDITOR_REQUEST = 1003;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1004;
    private WebView webView;
    private NativeBridge nativeBridge;
    private ValueCallback<Uri[]> fileChooserCallback;
    private File pendingUpdate;
    private String pendingMapName = "";
    private String pendingMapCampus = "";
    private String pendingMapKind = "";
    private String pendingCourseDate = "";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pendingCourseDate = getIntent().getStringExtra("courseDate");
        removeLegacyVisionSecrets(this);
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

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("courseapp.local".equals(uri.getHost()) && uri.getPathSegments().size() == 2
                        && "maps".equals(uri.getPathSegments().get(0))) {
                    try {
                        File file = nativeBridge.campusMapFile(uri.getPathSegments().get(1));
                        if (file != null) {
                            WebResourceResponse response = new WebResourceResponse(nativeBridge.campusMapMime(uri.getPathSegments().get(1)), null, new FileInputStream(file));
                            response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-store"));
                            return response;
                        }
                    } catch (Exception ignored) {
                    }
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, request);
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
        if (requestCode == MAP_PICKER_REQUEST) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                return;
            }
            Uri uri = data.getData();
            if ("pdf".equals(pendingMapKind)) {
                Intent editor = new Intent(this, PdfMapImportActivity.class);
                editor.setData(uri);
                editor.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                editor.putExtra("mapName", pendingMapName);
                editor.putExtra("campus", pendingMapCampus);
                startActivityForResult(editor, PDF_MAP_EDITOR_REQUEST);
            } else {
                String name = pendingMapName;
                String campus = pendingMapCampus;
                new Thread(() -> sendCampusMapResult(nativeBridge.importImageMap(uri, name, campus)), "campus-map-image").start();
            }
            pendingMapKind = "";
            pendingMapName = "";
            pendingMapCampus = "";
            return;
        }
        if (requestCode == PDF_MAP_EDITOR_REQUEST) {
            if (resultCode != RESULT_OK || data == null) {
                return;
            }
            String path = data.getStringExtra("preparedPath");
            String name = data.getStringExtra("mapName");
            String campus = data.getStringExtra("campus");
            new Thread(() -> sendCampusMapResult(nativeBridge.importPreparedPdfMap(path, name, campus)), "campus-map-pdf").start();
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

    private void sendCampusMapResult(JSONObject result) {
        String argument = JSONObject.quote(result.toString());
        webView.post(() -> webView.evaluateJavascript("window.onNativeCampusMapImported(" + argument + ")", null));
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

    private void launchCampusMapPicker(String kind, String name, String campus) {
        pendingMapKind = kind;
        pendingMapName = name;
        pendingMapCampus = campus;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("pdf".equals(kind) ? "application/pdf" : "image/*");
        if (!"pdf".equals(kind)) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
        startActivityForResult(intent, MAP_PICKER_REQUEST);
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
        private static final String CAMPUS_MAPS_KEY = "campus_maps_json";
        private static final long MAX_MAP_BYTES = 20L * 1024L * 1024L;
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

        @JavascriptInterface
        public String pickCampusMap(String kind, String name, String campus) {
            JSONObject result = new JSONObject();
            try {
                if (!("image".equals(kind) || "pdf".equals(kind))) throw new Exception("不支持的地图类型");
                String safeName = cleanMapText(name, 80);
                String safeCampus = cleanMapText(campus, 80);
                webView.post(() -> launchCampusMapPicker(kind, safeName, safeCampus));
                result.put("ok", true);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public synchronized String listCampusMaps() {
            JSONObject result = new JSONObject();
            try {
                JSONArray stored = readCampusMaps();
                JSONArray available = new JSONArray();
                JSONArray publicMaps = new JSONArray();
                for (int index = 0; index < stored.length(); index++) {
                    JSONObject map = stored.getJSONObject(index);
                    try {
                        if (!verifiedMapFile(map.optString("localFile")).isFile()) continue;
                        available.put(map);
                        publicMaps.put(new JSONObject().put("id", map.optString("id")).put("name", map.optString("name"))
                                .put("campus", map.optString("campus")).put("source", map.optString("source"))
                                .put("updatedAt", map.optLong("updatedAt")));
                    } catch (Exception ignored) {
                    }
                }
                if (available.length() != stored.length()) writeCampusMaps(available);
                result.put("ok", true).put("maps", publicMaps);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public synchronized String updateCampusMap(String id, String name, String campus) {
            JSONObject result = new JSONObject();
            try {
                JSONArray maps = readCampusMaps();
                JSONObject map = findCampusMap(maps, id);
                if (map == null) throw new Exception("地图不存在");
                String nextName = cleanMapText(name, 80);
                if (nextName.isEmpty()) throw new Exception("地图名称不能为空");
                map.put("name", nextName).put("campus", cleanMapText(campus, 80)).put("updatedAt", System.currentTimeMillis());
                writeCampusMaps(maps);
                result.put("ok", true);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        @JavascriptInterface
        public synchronized String deleteCampusMap(String id) {
            JSONObject result = new JSONObject();
            try {
                JSONArray maps = readCampusMaps();
                JSONObject map = findCampusMap(maps, id);
                if (map == null) throw new Exception("地图不存在");
                File file = verifiedMapFile(map.optString("localFile"));
                if (file.exists() && !file.delete()) throw new Exception("地图文件删除失败");
                JSONArray remaining = new JSONArray();
                for (int index = 0; index < maps.length(); index++) {
                    JSONObject item = maps.getJSONObject(index);
                    if (!id.equals(item.optString("id"))) remaining.put(item);
                }
                writeCampusMaps(remaining);
                result.put("ok", true);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result.toString();
        }

        synchronized JSONObject importImageMap(Uri uri, String requestedName, String campus) {
            JSONObject result = new JSONObject();
            File temporary = null;
            try {
                String mime = context.getContentResolver().getType(uri);
                String originalName = displayName(uri);
                String lowerName = originalName.toLowerCase(Locale.ROOT);
                String extension;
                if ("image/jpeg".equals(mime) || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) { extension = ".jpg"; mime = "image/jpeg"; }
                else if ("image/png".equals(mime) || lowerName.endsWith(".png")) { extension = ".png"; mime = "image/png"; }
                else if ("image/webp".equals(mime) || lowerName.endsWith(".webp")) { extension = ".webp"; mime = "image/webp"; }
                else throw new Exception("只支持 JPEG、PNG 或 WebP 图片");
                String id = UUID.randomUUID().toString();
                temporary = new File(mapsDirectory(), id + ".tmp");
                copyLimited(context.getContentResolver().openInputStream(uri), temporary, MAX_MAP_BYTES);
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(temporary.getAbsolutePath(), bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 30000 || bounds.outHeight > 30000) {
                    throw new Exception("图片内容无效或尺寸过大");
                }
                File target = new File(mapsDirectory(), id + extension);
                if (!temporary.renameTo(target)) throw new Exception("地图文件保存失败");
                temporary = null;
                String fallbackName = originalName.replaceFirst("\\.[^.]+$", "");
                JSONObject map = addCampusMap(id, target.getName(), cleanMapText(requestedName, 80), fallbackName,
                        cleanMapText(campus, 80), mime, "image");
                result.put("ok", true).put("map", map);
            } catch (Exception error) {
                if (temporary != null) temporary.delete();
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result;
        }

        synchronized JSONObject importPreparedPdfMap(String path, String requestedName, String campus) {
            JSONObject result = new JSONObject();
            try {
                if (path == null) throw new Exception("没有生成地图图片");
                File source = new File(path).getCanonicalFile();
                File allowed = new File(context.getCacheDir(), "pdf-map-import").getCanonicalFile();
                if (!source.getPath().startsWith(allowed.getPath() + File.separator) || !source.isFile()) {
                    throw new Exception("PDF 地图临时文件无效");
                }
                if (source.length() <= 0 || source.length() > MAX_MAP_BYTES) throw new Exception("提取后的地图大小异常");
                String id = UUID.randomUUID().toString();
                File target = new File(mapsDirectory(), id + ".png");
                copyLimited(new FileInputStream(source), target, MAX_MAP_BYTES);
                source.delete();
                JSONObject map = addCampusMap(id, target.getName(), cleanMapText(requestedName, 80), "PDF 地图",
                        cleanMapText(campus, 80), "image/png", "pdf");
                result.put("ok", true).put("map", map);
            } catch (Exception error) {
                try { result.put("ok", false).put("error", safeMessage(error)); } catch (Exception ignored) {}
            }
            return result;
        }

        synchronized File campusMapFile(String id) throws Exception {
            JSONObject map = findCampusMap(readCampusMaps(), id);
            if (map == null) return null;
            File file = verifiedMapFile(map.optString("localFile"));
            return file.isFile() ? file : null;
        }

        synchronized String campusMapMime(String id) throws Exception {
            JSONObject map = findCampusMap(readCampusMaps(), id);
            return map == null ? "application/octet-stream" : map.optString("mimeType", "application/octet-stream");
        }

        private JSONObject addCampusMap(String id, String localFile, String requestedName, String fallbackName,
                                        String campus, String mime, String source) throws Exception {
            String name = requestedName.isEmpty() ? cleanMapText(fallbackName, 80) : requestedName;
            if (name.isEmpty()) name = "校区地图";
            JSONObject map = new JSONObject().put("id", id).put("name", name).put("campus", campus)
                    .put("localFile", localFile).put("mimeType", mime).put("source", source)
                    .put("updatedAt", System.currentTimeMillis());
            JSONArray maps = readCampusMaps();
            maps.put(map);
            writeCampusMaps(maps);
            return map;
        }

        private JSONArray readCampusMaps() throws Exception {
            return new JSONArray(preferences.getString(CAMPUS_MAPS_KEY, "[]"));
        }

        private void writeCampusMaps(JSONArray maps) throws Exception {
            if (!preferences.edit().putString(CAMPUS_MAPS_KEY, maps.toString()).commit()) throw new Exception("地图信息保存失败");
        }

        private JSONObject findCampusMap(JSONArray maps, String id) throws Exception {
            if (id == null || !id.matches("[0-9a-fA-F-]{36}")) return null;
            for (int index = 0; index < maps.length(); index++) {
                JSONObject map = maps.getJSONObject(index);
                if (id.equals(map.optString("id"))) return map;
            }
            return null;
        }

        private File mapsDirectory() throws Exception {
            File directory = new File(context.getFilesDir(), "campus_maps");
            if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建地图目录");
            return directory;
        }

        private File verifiedMapFile(String name) throws Exception {
            if (name == null || !name.matches("[0-9a-fA-F-]{36}\\.(jpg|png|webp)")) throw new Exception("地图文件名无效");
            File directory = mapsDirectory().getCanonicalFile();
            File file = new File(directory, name).getCanonicalFile();
            if (!file.getParentFile().equals(directory)) throw new Exception("地图路径无效");
            return file;
        }

        private void copyLimited(InputStream input, File target, long limit) throws Exception {
            if (input == null) throw new Exception("无法读取所选文件");
            try (InputStream source = input; FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[16384];
                long total = 0;
                int count;
                while ((count = source.read(buffer)) != -1) {
                    total += count;
                    if (total > limit) throw new Exception("文件超过 20 MB");
                    output.write(buffer, 0, count);
                }
                if (total == 0) throw new Exception("所选文件为空");
            } catch (Exception error) {
                target.delete();
                throw error;
            }
        }

        private String displayName(Uri uri) {
            try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && cursor.getString(0) != null) return cursor.getString(0);
            } catch (Exception ignored) {}
            return "校区地图";
        }

        private String cleanMapText(String value, int limit) {
            if (value == null) return "";
            String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
            return clean.length() > limit ? clean.substring(0, limit) : clean;
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
