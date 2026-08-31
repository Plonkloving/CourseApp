package com.local.courseschedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CourseBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        CourseNotificationScheduler.reschedule(context);
    }
}
