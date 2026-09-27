package com.local.courseschedule;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CourseBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        CourseNotificationScheduler.reschedule(context);
        CourseNotificationScheduler.updateNextClassShortcut(context);
        AppWidgetManager widgetManager = AppWidgetManager.getInstance(context);
        NextClassWidgetProvider.refresh(context, widgetManager);
        TodayWidgetProvider.refresh(context, widgetManager);
    }
}
