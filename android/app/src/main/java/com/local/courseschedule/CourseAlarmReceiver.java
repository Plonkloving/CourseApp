package com.local.courseschedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CourseAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!CourseNotificationScheduler.ALARM_ACTION.equals(intent.getAction())) return;
        CourseNotificationScheduler.showCourseNotification(context, intent);
        CourseNotificationScheduler.reschedule(context);
    }
}
