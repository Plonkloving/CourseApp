import json
import re
import tempfile
import threading
import unittest
import urllib.request
from datetime import date
from pathlib import Path

import server


ROOT = Path(__file__).resolve().parents[1]


class ScheduleBehaviorTests(unittest.TestCase):
    def test_default_state_is_empty_and_dates_are_independent(self):
        semester = server.EMPTY_STATE["semester"]
        self.assertEqual(server.EMPTY_STATE["sessions"], [])
        self.assertEqual(server.EMPTY_STATE["periods"], [])
        self.assertEqual(date.fromisoformat(semester["weekOneStart"]), date(2026, 8, 31))
        self.assertEqual(date.fromisoformat(semester["classStartDate"]), date(2026, 8, 31))
        self.assertEqual(date.fromisoformat(semester["weekOneStart"]).strftime("%A"), "Monday")

    def test_midweek_class_start_keeps_calendar_week(self):
        week_one_start = date(2026, 8, 31)
        class_start = date(2026, 9, 2)
        self.assertEqual(class_start.strftime("%A"), "Wednesday")
        self.assertEqual((class_start - week_one_start).days, 2)
        self.assertLess(week_one_start, class_start)

    def test_client_uses_system_clock_and_filters_pre_start_courses(self):
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn("手机系统时间", script)
        self.assertIn("setInterval(refreshSystemClock, 1000)", script)
        self.assertIn("parseLocalDate(state.semester.weekOneStart)", script)
        self.assertIn("parseLocalDate(state.semester.classStartDate)", script)
        self.assertIn("function isTeachingDate(date)", script)
        self.assertIn("const sessions = sessionsForDate(date);", script)
        self.assertIn('localStorage.removeItem("course-schedule-cache")', script)

    def test_teaching_dates_can_be_saved_separately(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="weekOneStart"', html)
        self.assertIn('id="classStartDate"', html)
        self.assertIn('id="saveTeachingDates"', html)
        self.assertIn("async function saveTeachingDates()", script)
        self.assertIn("parseLocalDate(nextWeekOneStart).getDay() !== 1", script)
        self.assertNotIn('id="semesterFirstDay"', html)

    def test_month_view_opens_read_only_day_dialog(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="monthView"', html)
        self.assertIn('data-view="month"', html)
        self.assertIn('id="monthGrid"', html)
        self.assertIn('id="dayScheduleDialog"', html)
        self.assertIn("function monthGridDates(year, month)", script)
        self.assertIn("function sessionsForDate(date)", script)
        self.assertIn("function openDaySchedule(date)", script)
        self.assertIn("courseCard(session, date, false)", script)
        self.assertIn("repeat(7, minmax(0, 1fr))", styles)

    def test_liquid_glass_theme_has_accessible_fallbacks(self):
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        service_worker = (ROOT / "app" / "sw.js").read_text(encoding="utf-8")
        self.assertIn("--glass-blur", styles)
        self.assertIn("backdrop-filter: blur", styles)
        self.assertIn("@supports not", styles)
        self.assertIn("prefers-color-scheme: dark", html)
        self.assertIn("prefers-reduced-motion: reduce", styles)
        self.assertIn('name="theme-color" content="#243F7A"', html)
        self.assertIn('CACHE_NAME = "course-app-v15"', service_worker)

    def test_android_asset_entry_uses_classic_script(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        self.assertIn('<script src="./app.js" defer></script>', html)
        self.assertIn('<script src="./excel-import.js" defer></script>', html)
        self.assertIn('id="excelFile"', html)
        self.assertNotIn('src="./app.js" type="module"', html)
        self.assertIn("__courseAppReady", html)

    def test_android_supports_excel_file_chooser(self):
        activity = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        self.assertIn("onShowFileChooser", activity)
        self.assertIn("FileChooserParams.parseResult", activity)
        self.assertIn("setAllowContentAccess(true)", activity)

    def test_weekly_grid_view_shows_whole_week(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="weekView"', html)
        self.assertIn('data-view="week"', html)
        self.assertIn('id="weekGrid"', html)
        self.assertIn('id="weekGridPrevious"', html)
        self.assertIn('id="weekGridToday"', html)
        self.assertIn('id="weekGridDays"', html)
        self.assertIn("function renderWeekGrid()", script)
        self.assertIn("function weekGridCard(", script)
        self.assertIn("function weekGridPeriods()", script)
        self.assertIn("item.day === index + 1 && item.weeks.includes(selectedWeek)", script)
        self.assertIn("grid-row:${row}/span ${span}", script)
        self.assertIn("const rowFor = new Map(periods.map((period, index) => [period.number, index + 2]))", script)
        self.assertIn("const collapseWeekend = weekGridFiveDays && !daySessions[5].length && !daySessions[6].length", script)
        self.assertIn("30px repeat(${dayCount}, minmax(0, 1fr))", script)
        self.assertIn("minmax(48px, auto)", script)
        self.assertIn("course-app-week-days", script)
        self.assertIn(".week-grid {", styles)
        self.assertIn(".week-card {", styles)
        self.assertIn(".week-view-actions", styles)
        self.assertNotIn("min-width: 500px", styles)
        self.assertIn("weekGridEmpty.classList.toggle", script)

    def test_dark_mode_supports_manual_override(self):
        root = ROOT / "android" / "app" / "src" / "main"
        activity = (root / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        controller = (ROOT / "ios" / "CourseSchedule" / "ViewController.swift").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("course-app-theme", html)
        self.assertIn("prefers-color-scheme: dark", html)
        self.assertIn('data-theme-choice="system"', html)
        self.assertIn('data-theme-choice="light"', html)
        self.assertIn('data-theme-choice="dark"', html)
        self.assertIn("function applyTheme()", script)
        self.assertIn("THEME_STORAGE_KEY", script)
        self.assertIn('classList.toggle("dark", dark)', script)
        self.assertIn("setSystemBars", script)
        self.assertIn(":root.dark {", styles)
        self.assertIn(":root.dark body {", styles)
        self.assertIn(":root.dark .week-grid-head {", styles)
        self.assertNotIn("@media (prefers-color-scheme: dark)", styles)
        self.assertIn("setSystemBars(boolean dark)", activity)
        self.assertIn("setAlgorithmicDarkeningAllowed(false)", activity)
        self.assertIn("applySystemBars(false)", activity)
        self.assertIn("userInterfaceStyle", controller)

    def test_android_campus_maps_removed(self):
        root = ROOT / "android" / "app" / "src" / "main"
        activity = (root / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        manifest = (root / "AndroidManifest.xml").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertFalse((root / "java" / "com" / "local" / "courseschedule" / "PdfMapImportActivity.java").exists())
        self.assertNotIn("PdfMapImportActivity", manifest)
        self.assertNotIn("pickCampusMap", activity)
        self.assertNotIn("listCampusMaps", activity)
        self.assertNotIn("campusMapFile", activity)
        self.assertNotIn("importImageMap", activity)
        self.assertNotIn("shouldInterceptRequest", activity)
        self.assertNotIn("campusMap", html)
        self.assertNotIn("campusMap", script)
        self.assertNotIn("open-campus-map", script)
        self.assertNotIn(".map-dialog", styles)
        self.assertNotIn(".map-list", styles)
        self.assertNotIn(".map-canvas", styles)
        self.assertNotIn('data-view="map"', html)
        self.assertIn("removeCampusMapData", activity)
        self.assertIn('"campus_maps_json"', activity)
        self.assertIn("deleteRecursively", activity)
        self.assertIn("maps_removed_1_5_0", activity)

    def test_android_has_signed_release_update_flow(self):
        activity = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        manifest = (ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn("/releases/latest", activity)
        self.assertIn("FileProvider.getUriForFile", activity)
        self.assertIn("canRequestPackageInstalls", activity)
        self.assertIn('return "Android"', activity)
        self.assertIn('id="usageNoticeDialog"', html)
        self.assertIn('id="startupUpdateDialog"', html)
        self.assertIn("USAGE_NOTICE_VERSION", script)
        self.assertIn("runStartupPrompts", script)
        self.assertIn('result.put("releaseNotes"', activity)
        self.assertIn('result.put("publishedAt"', activity)
        self.assertIn("android.permission.REQUEST_INSTALL_PACKAGES", manifest)

    def test_android_removes_vision_and_cleans_legacy_key(self):
        activity = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertNotIn('id="visionView"', html)
        self.assertNotIn("window.onNativeVisionResult", script)
        self.assertNotIn("recognizeSchedule", activity)
        self.assertNotIn("api.deepseek.com", activity)
        self.assertNotIn("deepseek-v4-flash-vision-exp", activity)
        self.assertIn("removeLegacyVisionSecrets", activity)
        self.assertIn('deleteSharedPreferences("deepseek_secrets")', activity)
        self.assertIn('KeyStore.getInstance("AndroidKeyStore")', activity)
        self.assertNotIn("System.out", activity)

    def test_android_course_notifications_follow_schedule_changes(self):
        root = ROOT / "android" / "app" / "src" / "main"
        activity = (root / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        scheduler = (root / "java" / "com" / "local" / "courseschedule" / "CourseNotificationScheduler.java").read_text(encoding="utf-8")
        manifest = (root / "AndroidManifest.xml").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="reminderSettings"', html)
        self.assertNotIn('id="notificationView"', html)
        self.assertIn("refreshNotificationSettings", script)
        self.assertIn("openCourseDateFromNotification", script)
        self.assertIn("CourseNotificationScheduler.reschedule(context)", activity)
        self.assertIn("nextOccurrence", scheduler)
        self.assertIn("classStartDate", scheduler)
        self.assertIn("setExactAndAllowWhileIdle", scheduler)
        self.assertIn("setAndAllowWhileIdle", scheduler)
        self.assertIn("android.permission.POST_NOTIFICATIONS", manifest)
        self.assertIn("android.permission.SCHEDULE_EXACT_ALARM", manifest)
        self.assertIn('android:name=".CourseAlarmReceiver"', manifest)
        self.assertIn('android:name=".CourseBootReceiver"', manifest)
        self.assertIn("android.intent.action.BOOT_COMPLETED", manifest)

    def test_repository_contains_no_api_key_literal(self):
        candidates = [ROOT / "app", ROOT / "android", ROOT / "ios", ROOT / ".github", ROOT / "README.md"]
        key_pattern = re.compile(r"sk-[A-Za-z0-9_-]{20,}")
        leaks = []
        for candidate in candidates:
            files = candidate.rglob("*") if candidate.is_dir() else [candidate]
            for path in files:
                if path.is_file() and "build" not in path.parts:
                    try:
                        if key_pattern.search(path.read_text(encoding="utf-8")):
                            leaks.append(str(path.relative_to(ROOT)))
                    except UnicodeDecodeError:
                        continue
        self.assertEqual(leaks, [], f"发现疑似 API Key：{leaks}")

    def test_no_course_dataset_can_be_bundled(self):
        build = (ROOT / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
        project = (ROOT / "ios" / "CourseSchedule.xcodeproj" / "project.pbxproj").read_text(encoding="utf-8")
        android = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        ios = (ROOT / "ios" / "CourseSchedule" / "ViewController.swift").read_text(encoding="utf-8")
        self.assertFalse(any((ROOT / "data").glob("schedule*.json")))
        self.assertFalse(any(ROOT.glob("*.xls")))
        self.assertFalse(any(ROOT.glob("*.xlsx")))
        self.assertIn('assets.srcDirs = ["../../app"]', build)
        self.assertNotIn("../../data", build)
        self.assertNotIn("schedule.example.json", project)
        self.assertNotIn("Copy Schedule Data", project)
        self.assertIn("PRIVACY_RESET_KEY", android)
        self.assertIn("privacyResetKey", ios)

    def test_ios_native_wrapper_supports_local_features(self):
        controller = (ROOT / "ios" / "CourseSchedule" / "ViewController.swift").read_text(encoding="utf-8")
        self.assertIn('case "loadState"', controller)
        self.assertIn('case "saveState"', controller)
        self.assertIn('return "iOS"', controller)
        self.assertIn("WKWebView", controller)

    def test_mobile_workflow_builds_platforms_separately(self):
        workflow = (ROOT / ".github" / "workflows" / "mobile-builds.yml").read_text(encoding="utf-8")
        self.assertIn("android:", workflow)
        self.assertIn("ios:", workflow)
        self.assertIn("CourseSchedule-Android-debug", workflow)
        self.assertIn("CourseSchedule-iOS-unsigned", workflow)
        self.assertIn("CODE_SIGNING_ALLOWED=NO", workflow)

    def test_ai_assistant_is_byok_and_stays_provider_agnostic(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        assistant = (ROOT / "app" / "ai-assistant.js").read_text(encoding="utf-8")
        activity = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        server = (ROOT / "server.py").read_text(encoding="utf-8")
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "mobile-builds.yml").read_text(encoding="utf-8")
        self.assertIn('id="aiBall"', html)
        self.assertIn('id="aiWindow"', html)
        self.assertIn('id="aiCapsule"', html)
        self.assertIn("AI 助手默认关闭", html)
        self.assertIn("AI_PRESETS", assistant)
        self.assertIn("api.deepseek.com", assistant)
        self.assertNotIn("api.deepseek.com", activity)
        self.assertNotIn("sk-", assistant)
        self.assertNotIn("showModal", assistant)
        self.assertIn("visualViewport", assistant)
        self.assertIn("reasoning_content", assistant)
        self.assertIn("[DONE]", assistant)
        self.assertIn("prompt_cache_hit_tokens", assistant)
        self.assertIn("MAX_CONTEXT_SESSIONS", assistant)
        self.assertIn("全部课程安排共", assistant)
        self.assertIn("未列出的日期没有课程", assistant)
        self.assertIn("【今天是", assistant)
        self.assertIn("附带课表 · ", assistant)
        self.assertIn("aiChatRequest", activity)
        self.assertIn("Authorization", activity)
        self.assertIn("AndroidKeyStore", activity)
        self.assertIn("getStoredAiKey", activity)
        self.assertIn("192.168.", activity)
        self.assertIn("/api/ai/chat", server)
        self.assertIn("/api/ai/config", server)
        self.assertIn("hasKey", server)
        self.assertIn("data/ai_config.json", gitignore)
        self.assertIn("node --check app/ai-assistant.js", workflow)

    def test_manage_list_groups_and_filters(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="manageDayChips"', html)
        self.assertIn('id="manageToggleAll"', html)
        self.assertIn('id="manageSettingsToggle"', html)
        self.assertIn('id="semesterSettings"', html)
        self.assertIn("function manageGroupKey(", script)
        self.assertIn("manageExpanded.has(manageGroupKey(", script)
        self.assertIn("manageFilterDay", script)
        self.assertIn("manageSettingsOpen", script)
        self.assertIn("scrollIntoView", script)
        self.assertIn('data-group-key="${escapeHtml(group.key)}"', script)
        self.assertIn("manage-group-head", script)
        self.assertIn("周${SHORT_DAYS[session.day - 1]} 第${session.periodStart}–${session.periodEnd}节", script)
        self.assertIn("manage-group-head", styles)
        self.assertIn(".manage-day-chip", styles)
        self.assertIn(".manage-group {", styles)
        self.assertIn(".manage-settings-toggle", styles)

    def test_android_app_shortcuts_route_to_views(self):
        root = ROOT / "android" / "app" / "src" / "main"
        shortcuts = (root / "res" / "xml" / "shortcuts.xml").read_text(encoding="utf-8")
        strings = (root / "res" / "values" / "strings.xml").read_text(encoding="utf-8")
        manifest = (root / "AndroidManifest.xml").read_text(encoding="utf-8")
        activity = (root / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        scheduler = (root / "java" / "com" / "local" / "courseschedule" / "CourseNotificationScheduler.java").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        for name in ("ic_sc_today", "ic_sc_week", "ic_sc_month", "ic_sc_add", "ic_sc_next"):
            self.assertTrue((root / "res" / "drawable" / f"{name}.xml").exists(), name)
        self.assertIn('android:name="android.app.shortcuts"', manifest)
        self.assertIn("@xml/shortcuts", manifest)
        self.assertIn('android:launchMode="singleTask"', manifest)
        for target in ("today", "week", "month", "add"):
            self.assertIn(f'android:value="{target}"', shortcuts)
        self.assertIn("shortcut_today", strings)
        self.assertIn("getLaunchShortcut", activity)
        self.assertIn("sendShortcutTarget", activity)
        self.assertIn("updateNextClassShortcut", activity)
        self.assertIn("updateNextClassShortcut", scheduler)
        self.assertIn("ShortcutManagerCompat", scheduler)
        self.assertIn("Intent.ACTION_MAIN", scheduler)
        self.assertIn("courseName", scheduler)
        self.assertIn("window.onNativeShortcut", script)
        self.assertIn("function applyShortcutTarget(", script)
        self.assertIn('target === "week"', script)
        self.assertIn('target === "add"', script)
        self.assertIn("getLaunchShortcut", script)

    def test_visual_design_tokens_and_icons(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("--radius-s", styles)
        self.assertIn("--radius-m", styles)
        self.assertIn("--radius-l", styles)
        self.assertIn("--text-secondary", styles)
        self.assertNotIn("letter-spacing: .09em", styles)
        self.assertNotIn("◷", script)
        self.assertNotIn("⌖", script)
        self.assertIn('id="i-cal-day"', html)
        self.assertIn('id="i-grid"', html)
        self.assertIn('id="i-bell"', html)
        self.assertIn('href="#i-clock"', script)
        self.assertIn('href="#i-pin"', script)
        self.assertIn('href="#i-user"', script)
        self.assertIn("course-dot", script)
        self.assertIn("CourseExcelImport.colorFor", script)

    def test_backup_conflict_and_home_widgets(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        root = ROOT / "android" / "app" / "src" / "main"
        manifest = (root / "AndroidManifest.xml").read_text(encoding="utf-8")
        activity = (root / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        scheduler = (root / "java" / "com" / "local" / "courseschedule" / "CourseNotificationScheduler.java").read_text(encoding="utf-8")
        next_provider = (root / "java" / "com" / "local" / "courseschedule" / "NextClassWidgetProvider.java").read_text(encoding="utf-8")
        today_provider = (root / "java" / "com" / "local" / "courseschedule" / "TodayWidgetProvider.java").read_text(encoding="utf-8")
        self.assertIn('id="exportBackup"', html)
        self.assertIn('id="importBackup"', html)
        self.assertIn('id="backupFile"', html)
        self.assertIn("function exportBackup()", script)
        self.assertIn("function validateBackupState(", script)
        self.assertIn("function importBackupFile(", script)
        self.assertIn("findConflicts", script)
        self.assertIn("conflictAcknowledge", script)
        self.assertIn(".week-now-line", styles)
        self.assertIn(".backup-actions", styles)
        self.assertIn("findNextSession", scheduler)
        self.assertIn("daysUntil", scheduler)
        self.assertIn("weekdayOf", scheduler)
        self.assertIn("ACTION_CREATE_DOCUMENT", activity)
        self.assertIn("EXPORT_FILE_REQUEST", activity)
        self.assertNotIn("BACKUP_EXPORT_REQUEST", activity)
        self.assertIn(".NextClassWidgetProvider", manifest)
        self.assertIn(".TodayWidgetProvider", manifest)
        self.assertIn("next_class_widget_info", manifest)
        self.assertIn("today_widget_info", manifest)
        self.assertTrue((root / "res" / "xml" / "next_class_widget_info.xml").exists())
        self.assertTrue((root / "res" / "xml" / "today_widget_info.xml").exists())
        self.assertTrue((root / "res" / "layout" / "widget_next_class.xml").exists())
        self.assertTrue((root / "res" / "layout" / "widget_today.xml").exists())
        self.assertIn("findNextSession", next_provider)
        self.assertIn("widget_today_row_", today_provider)
        self.assertIn("MAX_ROWS", today_provider)

    def test_countdown_and_period_editor(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="eventCountdown"', html)
        self.assertIn('id="periodEditor"', html)
        self.assertIn('id="eventEditor"', html)
        self.assertIn("function nearestEventCountdown()", script)
        self.assertIn("function renderPeriodsEditor()", script)
        self.assertIn("function renderEventsEditor()", script)
        self.assertIn("倒计时事件最多 10 个", script)
        self.assertIn("events: (previous.events || [])", script)
        self.assertIn("Array.isArray(candidate.events)", script)
        self.assertNotIn("version: 1", script)
        self.assertIn(".event-countdown", styles)
        self.assertIn(".period-row", styles)
        self.assertIn(".event-add-row", styles)

    def test_multi_semester_and_day_timeline(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="semesterSelect"', html)
        self.assertIn('id="addSemester"', html)
        self.assertIn('id="deleteSemester"', html)
        self.assertIn("function normalizeState()", script)
        self.assertIn("function applyActiveSemester()", script)
        self.assertIn("function syncActiveSemesterEntry()", script)
        self.assertIn("function renderSemesterSwitcher()", script)
        self.assertIn("state.semesters.length >= 20", script)
        self.assertIn("version: 3", script)
        self.assertNotIn("version: 1", script)
        self.assertIn("function renderDayTimeline()", script)
        self.assertIn("function dayTimelineBlock(", script)
        self.assertIn("function positionDayNowLine()", script)
        self.assertIn("day-now-line", script)
        self.assertIn(".day-timeline", styles)
        self.assertIn(".day-axis", styles)
        self.assertIn(".day-block", styles)
        self.assertIn(".semester-switcher", styles)

    def test_export_image_and_ics(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="exportWeekImage"', html)
        self.assertIn('id="exportIcs"', html)
        self.assertIn("function exportWeekImage()", script)
        self.assertIn("function drawWeekImage()", script)
        self.assertIn("function buildIcs()", script)
        self.assertIn("function icsWeekRuns(", script)
        self.assertIn("RRULE:FREQ=WEEKLY", script)
        self.assertIn("DTSTART:", script)
        self.assertIn("BEGIN:VCALENDAR", script)
        self.assertIn("exportFile", script)

    def test_diary_feature_is_local_and_gated(self):
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        assistant = (ROOT / "app" / "ai-assistant.js").read_text(encoding="utf-8")
        self.assertIn('data-view="diary"', html)
        self.assertIn('id="diaryCalendar"', html)
        self.assertIn('id="diaryMood"', html)
        self.assertIn('id="diaryPinInput"', html)
        self.assertIn('id="diaryQuoteCourses"', html)
        self.assertIn("function renderDiary()", script)
        self.assertIn("function saveDiary()", script)
        self.assertIn("state.diaries", script)
        self.assertIn("crypto.subtle", script)
        self.assertIn("引用当天课程", html)
        self.assertIn("function quoteTodayCourses()", script)
        self.assertNotIn("diaries", assistant)

    def test_state_validation(self):
        server.validate_state(server.EMPTY_STATE)


class ServerSmokeTests(unittest.TestCase):
    def test_get_and_put_empty_state(self):
        original_data_file = server.DATA_FILE
        with tempfile.TemporaryDirectory() as temporary_directory:
            server.DATA_FILE = Path(temporary_directory) / "schedule.json"
            httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.CourseHandler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{httpd.server_port}"
                with urllib.request.urlopen(base_url + "/api/state") as response:
                    state = json.load(response)
                self.assertEqual(state["sessions"], [])
                request = urllib.request.Request(
                    base_url + "/api/state",
                    data=json.dumps(state, ensure_ascii=False).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="PUT",
                )
                with urllib.request.urlopen(request) as response:
                    result = json.load(response)
                self.assertTrue(result["ok"])
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.DATA_FILE = original_data_file


if __name__ == "__main__":
    unittest.main()
