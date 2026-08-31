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
        self.assertIn("prefers-color-scheme: dark", styles)
        self.assertIn("prefers-reduced-motion: reduce", styles)
        self.assertIn('name="theme-color" content="#243F7A"', html)
        self.assertIn('CACHE_NAME = "course-app-v7"', service_worker)

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

    def test_android_supports_private_campus_maps_and_pdf_crop(self):
        activity = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "MainActivity.java").read_text(encoding="utf-8")
        pdf_editor = (ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "local" / "courseschedule" / "PdfMapImportActivity.java").read_text(encoding="utf-8")
        manifest = (ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="mapView"', html)
        self.assertIn('name="campusMapId"', html)
        self.assertIn("ACTION_OPEN_DOCUMENT", activity)
        self.assertIn('new File(context.getFilesDir(), "campus_maps")', activity)
        self.assertIn("MAX_MAP_BYTES", activity)
        self.assertIn("PdfRenderer", pdf_editor)
        self.assertIn("createCroppedBitmap", pdf_editor)
        self.assertIn('android:name=".PdfMapImportActivity"', manifest)
        self.assertIn("window.onNativeCampusMapImported", script)
        self.assertIn("session.campusMapId", script)
        self.assertNotIn("recognizeSchedule", pdf_editor)

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
        self.assertIn('id="notificationView"', html)
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
