package com.local.courseschedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class TodayWidgetProvider extends AppWidgetProvider {
    private static final int MAX_ROWS = 6;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        refresh(context, manager);
    }

    static void refresh(Context context, AppWidgetManager manager) {
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidgetProvider.class));
        if (ids.length == 0) return;
        try {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
            Calendar today = Calendar.getInstance();
            int day = today.get(Calendar.DAY_OF_WEEK) - 1;
            if (day == 0) day = 7;
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
            format.setLenient(false);
            String dateStr = format.format(today.getTime());
            views.setTextViewText(R.id.widget_today_title,
                    "今天课表 · " + (today.get(Calendar.MONTH) + 1) + "月" + today.get(Calendar.DAY_OF_MONTH) + "日");

            List<String> lines = new ArrayList<>();
            String emptyText = "今天没有课";
            String saved = context.getApplicationContext()
                    .getSharedPreferences("course_schedule", Context.MODE_PRIVATE).getString("state_json", null);
            if (saved != null) {
                JSONObject state = new JSONObject(saved);
                JSONObject semester = state.getJSONObject("semester");
                JSONArray periods = state.optJSONArray("periods");
                JSONArray sessions = state.getJSONArray("sessions");
                Calendar weekOne = Calendar.getInstance();
                weekOne.setTime(format.parse(semester.optString("weekOneStart", semester.optString("firstDay"))));
                Calendar midnight = Calendar.getInstance();
                midnight.set(Calendar.HOUR_OF_DAY, 0);
                midnight.set(Calendar.MINUTE, 0);
                midnight.set(Calendar.SECOND, 0);
                midnight.set(Calendar.MILLISECOND, 0);
                int week = (int) ((midnight.getTimeInMillis() - weekOne.getTimeInMillis()) / 86_400_000L / 7) + 1;
                Date classStart = format.parse(semester.optString("classStartDate", semester.optString("firstDay")));
                boolean inTerm = !midnight.getTime().before(classStart)
                        && week >= 1 && week <= semester.optInt("totalWeeks", 19);
                if (!inTerm) {
                    emptyText = "假期中，今天没有安排";
                } else {
                    List<JSONObject> matches = new ArrayList<>();
                    for (int index = 0; index < sessions.length(); index++) {
                        JSONObject session = sessions.getJSONObject(index);
                        if (session.optInt("day") != day) continue;
                        JSONArray weeks = session.optJSONArray("weeks");
                        for (int j = 0; weeks != null && j < weeks.length(); j++) {
                            if (weeks.optInt(j) == week) {
                                matches.add(session);
                                break;
                            }
                        }
                    }
                    matches.sort((a, b) -> Integer.compare(a.optInt("periodStart"), b.optInt("periodStart")));
                    for (JSONObject session : matches) {
                        lines.add(periodLabel(periods, session.optInt("periodStart"), session.optInt("periodEnd"))
                                + "  " + session.optString("name", "课程")
                                + (session.optString("location", "").isEmpty() ? "" : " · " + session.optString("location", "")));
                    }
                }
            }
            if (lines.size() > MAX_ROWS - 1) {
                lines.set(MAX_ROWS - 1, "还有 " + (lines.size() - MAX_ROWS + 1) + " 门课程…");
                lines = new ArrayList<>(lines.subList(0, MAX_ROWS));
            }
            for (int row = 1; row <= MAX_ROWS; row += 1) {
                int rowId = context.getResources().getIdentifier("widget_today_row_" + row, "id", context.getPackageName());
                if (rowId == 0) continue;
                boolean shown = row <= lines.size();
                views.setViewVisibility(rowId, shown ? View.VISIBLE : View.GONE);
                if (shown) {
                    views.setTextViewText(rowId, lines.get(row - 1));
                    views.setOnClickPendingIntent(rowId, NextClassWidgetProvider.openDayIntent(context, dateStr, 3200 + row));
                }
            }
            views.setViewVisibility(R.id.widget_today_empty, lines.isEmpty() ? View.VISIBLE : View.GONE);
            if (lines.isEmpty()) views.setTextViewText(R.id.widget_today_empty, emptyText);
            manager.updateAppWidget(ids, views);
        } catch (Exception ignored) {
        }
    }

    private static String periodLabel(JSONArray periods, int start, int end) {
        String startTime = "";
        String endTime = "";
        try {
            for (int index = 0; periods != null && index < periods.length(); index++) {
                JSONObject period = periods.getJSONObject(index);
                if (period.optInt("number") == start) startTime = period.optString("start", "");
                if (period.optInt("number") == end) endTime = period.optString("end", "");
            }
        } catch (Exception ignored) {
        }
        if (!startTime.isEmpty() && !endTime.isEmpty()) return startTime + "–" + endTime;
        return "第" + start + "-" + end + "节";
    }
}
