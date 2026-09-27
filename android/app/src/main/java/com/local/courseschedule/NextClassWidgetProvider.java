package com.local.courseschedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class NextClassWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        refresh(context, manager);
    }

    static void refresh(Context context, AppWidgetManager manager) {
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NextClassWidgetProvider.class));
        if (ids.length == 0) return;
        try {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_next_class);
            JSONObject session = CourseNotificationScheduler.findNextSession(context);
            String courseDate = "";
            if (session == null) {
                views.setTextViewText(R.id.widget_next_label, "下一节课");
                views.setTextViewText(R.id.widget_next_name, "暂无课程安排");
                views.setTextViewText(R.id.widget_next_time, "打开应用导入课表");
                views.setTextViewText(R.id.widget_next_loc, "");
            } else {
                courseDate = session.optString("courseDate", "");
                String countdown = CourseNotificationScheduler.daysUntil(courseDate);
                views.setTextViewText(R.id.widget_next_label, countdown.isEmpty() ? "下一节课" : countdown);
                views.setTextViewText(R.id.widget_next_name, CourseNotificationScheduler.clean(session.optString("courseName", "课程"), "课程"));
                String weekday = CourseNotificationScheduler.weekdayOf(courseDate);
                views.setTextViewText(R.id.widget_next_time, (weekday.isEmpty() ? "" : "周" + weekday + " ") + session.optString("startTime", ""));
                views.setTextViewText(R.id.widget_next_loc, CourseNotificationScheduler.clean(session.optString("location", ""), ""));
            }
            views.setOnClickPendingIntent(R.id.widget_next_root, openDayIntent(context, courseDate, 3100));
            manager.updateAppWidget(ids, views);
        } catch (Exception ignored) {
        }
    }

    static PendingIntent openDayIntent(Context context, String courseDate, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("courseDate", courseDate);
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
