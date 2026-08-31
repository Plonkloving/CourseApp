package com.local.courseschedule;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

final class CourseNotificationScheduler {
    static final String CHANNEL_ID = "course_reminders";
    static final String ALARM_ACTION = "com.local.courseschedule.COURSE_ALARM";
    private static final String SETTINGS = "course_notifications";
    private static final String STATE_PREFERENCES = "course_schedule";
    private static final String STATE_KEY = "state_json";
    private static final String SCHEDULED_CODES = "scheduled_codes";
    private static final int[] ALLOWED_LEADS = {0, 5, 10, 15, 30};

    private CourseNotificationScheduler() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "上课提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("在课程开始前显示本机课程提醒");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    static JSONObject settings(Context context) throws Exception {
        SharedPreferences values = context.getSharedPreferences(SETTINGS, Context.MODE_PRIVATE);
        return new JSONObject()
                .put("ok", true)
                .put("enabled", values.getBoolean("enabled", false))
                .put("leadMinutes", values.getInt("lead_minutes", 15))
                .put("showDetails", values.getBoolean("show_details", false))
                .put("notificationGranted", notificationsGranted(context))
                .put("exactAlarmGranted", exactAlarmsGranted(context));
    }

    static void saveSettings(Context context, boolean enabled, int leadMinutes, boolean showDetails) throws Exception {
        if (!allowedLead(leadMinutes)) throw new Exception("提醒提前时间不受支持");
        boolean saved = context.getSharedPreferences(SETTINGS, Context.MODE_PRIVATE).edit()
                .putBoolean("enabled", enabled)
                .putInt("lead_minutes", leadMinutes)
                .putBoolean("show_details", showDetails)
                .commit();
        if (!saved) throw new Exception("提醒设置保存失败");
        reschedule(context);
    }

    static void reschedule(Context context) {
        cancelScheduled(context);
        SharedPreferences values = context.getSharedPreferences(SETTINGS, Context.MODE_PRIVATE);
        if (!values.getBoolean("enabled", false)) return;
        String savedState = context.getSharedPreferences(STATE_PREFERENCES, Context.MODE_PRIVATE).getString(STATE_KEY, null);
        if (savedState == null) return;
        try {
            JSONObject state = new JSONObject(savedState);
            JSONObject semester = state.getJSONObject("semester");
            JSONArray periods = state.optJSONArray("periods");
            JSONArray sessions = state.getJSONArray("sessions");
            int leadMinutes = values.getInt("lead_minutes", 15);
            JSONArray scheduled = new JSONArray();
            for (int index = 0; index < sessions.length(); index++) {
                JSONObject session = sessions.getJSONObject(index);
                JSONObject next = nextOccurrence(semester, periods, session, leadMinutes, System.currentTimeMillis());
                if (next == null) continue;
                int requestCode = requestCode(session.optString("id", "session-" + index));
                Intent alarmIntent = new Intent(context, CourseAlarmReceiver.class)
                        .setAction(ALARM_ACTION)
                        .putExtra("requestCode", requestCode)
                        .putExtra("courseName", session.optString("name", "课程"))
                        .putExtra("location", session.optString("location", ""))
                        .putExtra("startTime", next.getString("startTime"))
                        .putExtra("courseDate", next.getString("courseDate"))
                        .putExtra("leadMinutes", leadMinutes)
                        .putExtra("showDetails", values.getBoolean("show_details", false));
                PendingIntent pending = PendingIntent.getBroadcast(context, requestCode, alarmIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                scheduleAlarm(context, next.getLong("alarmAt"), pending);
                scheduled.put(requestCode);
            }
            values.edit().putString(SCHEDULED_CODES, scheduled.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static void showCourseNotification(Context context, Intent alarmIntent) {
        if (!notificationsGranted(context)) return;
        createChannel(context);
        int requestCode = alarmIntent.getIntExtra("requestCode", 20001);
        boolean showDetails = alarmIntent.getBooleanExtra("showDetails", false);
        String courseName = clean(alarmIntent.getStringExtra("courseName"), "课程");
        String location = clean(alarmIntent.getStringExtra("location"), "");
        String startTime = clean(alarmIntent.getStringExtra("startTime"), "");
        int leadMinutes = alarmIntent.getIntExtra("leadMinutes", 15);
        String title = showDetails ? (leadMinutes == 0 ? "现在开始上课 · " : leadMinutes + " 分钟后上课 · ") + courseName : "即将有课程";
        String text = showDetails
                ? (startTime.isEmpty() ? "" : startTime) + (location.isEmpty() ? "" : " · " + location)
                : "打开课程表查看详情";
        Intent openIntent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("courseDate", alarmIntent.getStringExtra("courseDate"));
        PendingIntent contentIntent = PendingIntent.getActivity(context, requestCode, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID) : new Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setVisibility(showDetails ? Notification.VISIBILITY_PUBLIC : Notification.VISIBILITY_PRIVATE)
                .setCategory(Notification.CATEGORY_EVENT);
        context.getSystemService(NotificationManager.class).notify(requestCode, builder.build());
    }

    static void showTestNotification(Context context) throws Exception {
        if (!notificationsGranted(context)) throw new Exception("请先允许系统通知权限");
        Intent test = new Intent()
                .putExtra("requestCode", 20000)
                .putExtra("courseName", "课程提醒测试")
                .putExtra("location", "通知功能工作正常")
                .putExtra("startTime", new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()))
                .putExtra("courseDate", new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date()))
                .putExtra("leadMinutes", 0)
                .putExtra("showDetails", true);
        showCourseNotification(context, test);
    }

    static boolean notificationsGranted(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.N || manager.areNotificationsEnabled();
    }

    static boolean exactAlarmsGranted(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }

    private static JSONObject nextOccurrence(JSONObject semester, JSONArray periods, JSONObject session,
                                             int leadMinutes, long now) throws Exception {
        String startTime = periodStart(periods, session.optInt("periodStart"));
        if (!startTime.matches("(?:[01]?\\d|2[0-3]):[0-5]\\d")) return null;
        Calendar weekOne = parseDate(semester.optString("weekOneStart", semester.optString("firstDay")));
        Calendar classStart = parseDate(semester.optString("classStartDate", semester.optString("firstDay")));
        JSONArray weeks = session.optJSONArray("weeks");
        int day = session.optInt("day");
        if (weeks == null || day < 1 || day > 7) return null;
        String[] time = startTime.split(":");
        JSONObject earliest = null;
        for (int index = 0; index < weeks.length(); index++) {
            int week = weeks.optInt(index);
            if (week < 1) continue;
            Calendar occurrence = (Calendar) weekOne.clone();
            occurrence.add(Calendar.DAY_OF_YEAR, (week - 1) * 7 + day - 1);
            occurrence.set(Calendar.HOUR_OF_DAY, Integer.parseInt(time[0]));
            occurrence.set(Calendar.MINUTE, Integer.parseInt(time[1]));
            occurrence.set(Calendar.SECOND, 0);
            occurrence.set(Calendar.MILLISECOND, 0);
            if (occurrence.before(classStart)) continue;
            long alarmAt = occurrence.getTimeInMillis() - leadMinutes * 60_000L;
            if (alarmAt <= now) continue;
            if (earliest == null || alarmAt < earliest.getLong("alarmAt")) earliest = new JSONObject()
                    .put("alarmAt", alarmAt)
                    .put("startTime", startTime)
                    .put("courseDate", new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(occurrence.getTime()));
        }
        return earliest;
    }

    private static Calendar parseDate(String value) throws Exception {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        format.setLenient(false);
        Date date = format.parse(value);
        if (date == null) throw new Exception("日期无效");
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(date);
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        return calendar;
    }

    private static String periodStart(JSONArray periods, int number) throws Exception {
        if (periods == null) return "";
        for (int index = 0; index < periods.length(); index++) {
            JSONObject period = periods.getJSONObject(index);
            if (period.optInt("number") == number) return period.optString("start");
        }
        return "";
    }

    private static void scheduleAlarm(Context context, long alarmAt, PendingIntent pending) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (exactAlarmsGranted(context)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarmAt, pending);
            else manager.setExact(AlarmManager.RTC_WAKEUP, alarmAt, pending);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarmAt, pending);
        } else {
            manager.set(AlarmManager.RTC_WAKEUP, alarmAt, pending);
        }
    }

    private static void cancelScheduled(Context context) {
        SharedPreferences values = context.getSharedPreferences(SETTINGS, Context.MODE_PRIVATE);
        try {
            JSONArray codes = new JSONArray(values.getString(SCHEDULED_CODES, "[]"));
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            for (int index = 0; index < codes.length(); index++) {
                int requestCode = codes.optInt(index);
                PendingIntent pending = PendingIntent.getBroadcast(context, requestCode,
                        new Intent(context, CourseAlarmReceiver.class).setAction(ALARM_ACTION),
                        PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                if (pending != null) {
                    manager.cancel(pending);
                    pending.cancel();
                }
            }
        } catch (Exception ignored) {
        }
        values.edit().remove(SCHEDULED_CODES).apply();
    }

    private static int requestCode(String id) {
        return 30_000 + (id.hashCode() & 0x3fffffff);
    }

    private static boolean allowedLead(int value) {
        for (int allowed : ALLOWED_LEADS) if (allowed == value) return true;
        return false;
    }

    private static String clean(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() > 100 ? clean.substring(0, 100) : clean;
    }
}
