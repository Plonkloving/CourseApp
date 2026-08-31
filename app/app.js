const DAY_NAMES = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const SHORT_DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const DEFAULT_COLOR = "#3157A4";

let state;
let selectedWeek = 1;
let selectedDay = 1;
let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let activeView = "schedule";
let toastTimer;
let lastClockMinute = "";
let availableUpdateUrl = "";
let selectedVisionFile;
let recognizedSchedule;
let visionPreviewUrl = "";
let campusMaps = [];
let mapScale = 1;
let mapBaseScale = 1;
let mapTranslateX = 0;
let mapTranslateY = 0;
const mapPointers = new Map();
let mapGesture;

const $ = (selector) => document.querySelector(selector);
const elements = {
  semesterName: $("#semesterName"), termStatus: $("#termStatus"), weekNumber: $("#weekNumber"), weekRange: $("#weekRange"),
  dayStrip: $("#dayStrip"), selectedDateLabel: $("#selectedDateLabel"), classCount: $("#classCount"),
  courseList: $("#courseList"), manageList: $("#manageList"), scheduleView: $("#scheduleView"),
  monthView: $("#monthView"), monthGrid: $("#monthGrid"), visibleMonthLabel: $("#visibleMonthLabel"),
  dayScheduleDialog: $("#dayScheduleDialog"), dayScheduleMeta: $("#dayScheduleMeta"), dayScheduleTitle: $("#dayScheduleTitle"), dayScheduleCourses: $("#dayScheduleCourses"),
  manageView: $("#manageView"), previousWeek: $("#previousWeek"), nextWeek: $("#nextWeek"),
  todayButton: $("#todayButton"), weekSelect: $("#weekSelect"), courseDialog: $("#courseDialog"), courseForm: $("#courseForm"),
  deleteCourse: $("#deleteCourse"), formError: $("#formError"), toast: $("#toast"),
  infoDialog: $("#infoDialog"), lanUrls: $("#lanUrls"), excelFile: $("#excelFile"),
  weekOneStart: $("#weekOneStart"), classStartDate: $("#classStartDate"), teachingDateError: $("#teachingDateError"),
  visionView: $("#visionView"), deepSeekApiKey: $("#deepSeekApiKey"), deepSeekKeyStatus: $("#deepSeekKeyStatus"),
  scheduleImage: $("#scheduleImage"), scheduleImagePreview: $("#scheduleImagePreview"),
  recognizeScheduleImage: $("#recognizeScheduleImage"), visionStatus: $("#visionStatus"),
  visionResultCard: $("#visionResultCard"), visionResults: $("#visionResults"),
  mapView: $("#mapView"), campusMapList: $("#campusMapList"), campusMapDialog: $("#campusMapDialog"),
  mapCanvas: $("#mapCanvas"), mapViewerImage: $("#mapViewerImage")
};

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dateFor(week, day) {
  return addDays(parseLocalDate(state.semester.weekOneStart), (week - 1) * 7 + (day - 1));
}

function teachingPosition() {
  const weekStart = parseLocalDate(state.semester.weekOneStart);
  const classStart = parseLocalDate(state.semester.classStartDate);
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const difference = Math.floor((current - weekStart) / 86400000);
  const termDays = state.semester.totalWeeks * 7;
  if (current < classStart) {
    const startDifference = Math.floor((classStart - weekStart) / 86400000);
    const nativeDay = classStart.getDay();
    return {
      phase: "before", week: Math.floor(startDifference / 7) + 1,
      day: nativeDay === 0 ? 7 : nativeDay,
      daysUntilStart: Math.floor((classStart - current) / 86400000)
    };
  }
  if (difference >= termDays) return {phase: "after", week: state.semester.totalWeeks, day: 7, daysAfterEnd: difference - termDays + 1};
  const nativeDay = current.getDay();
  return {phase: "in", week: Math.floor(difference / 7) + 1, day: nativeDay === 0 ? 7 : nativeDay};
}

function isTeachingDate(date) {
  const classStart = parseLocalDate(state.semester.classStartDate);
  const termEnd = addDays(parseLocalDate(state.semester.weekOneStart), state.semester.totalWeeks * 7);
  return date >= classStart && date < termEnd;
}

function normalizeStateDates() {
  const legacyFirstDay = state.semester.firstDay;
  state.semester.weekOneStart ||= legacyFirstDay || "2026-08-31";
  state.semester.classStartDate ||= legacyFirstDay || state.semester.weekOneStart;
  delete state.semester.firstDay;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function teachingInfoForDate(date) {
  const weekStart = parseLocalDate(state.semester.weekOneStart);
  const difference = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate())) / 86400000);
  const nativeDay = date.getDay();
  const inTerm = difference >= 0 && difference < state.semester.totalWeeks * 7;
  return {
    week: Math.floor(difference / 7) + 1,
    day: nativeDay === 0 ? 7 : nativeDay,
    inTerm,
    teaching: inTerm && isTeachingDate(date)
  };
}

function sessionsForDate(date) {
  const info = teachingInfoForDate(date);
  if (!info.teaching) return [];
  return state.sessions
    .filter((item) => item.day === info.day && item.weeks.includes(info.week))
    .sort((a, b) => a.periodStart - b.periodStart);
}

function monthGridDates(year, month) {
  const first = new Date(year, month, 1);
  const leadingDays = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.max(35, Math.ceil((leadingDays + daysInMonth) / 7) * 7);
  return Array.from({length: cellCount}, (_, index) => addDays(first, index - leadingDays));
}

function formatDate(date, withYear = false) {
  const prefix = withYear ? `${date.getFullYear()}年` : "";
  return `${prefix}${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTime(date) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

function periodTime(session) {
  const start = state.periods.find((item) => item.number === session.periodStart)?.start || "";
  const end = state.periods.find((item) => item.number === session.periodEnd)?.end || "";
  return start && end ? `${start}–${end}` : `第${session.periodStart}–${session.periodEnd}节`;
}

function totalPeriods(sessions) {
  return sessions.reduce((sum, item) => sum + item.periodEnd - item.periodStart + 1, 0);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]);
}

function nativePlatform() {
  return window.CourseAppNative?.getPlatform?.() || "";
}

function render() {
  elements.semesterName.textContent = state.semester.name;
  elements.weekOneStart.value = state.semester.weekOneStart;
  elements.classStartDate.value = state.semester.classStartDate;
  elements.teachingDateError.textContent = "";
  renderTermStatus();
  renderWeekHeader();
  renderDays();
  renderCourses();
  renderMonthView();
  renderManageList();
}

function renderTermStatus() {
  const today = new Date();
  const position = teachingPosition();
  const actualDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const actualDay = actualDate.getDay() === 0 ? 7 : actualDate.getDay();
  const systemTime = `手机系统时间：${formatDate(actualDate, true)} · ${DAY_NAMES[actualDay - 1]} · ${formatTime(today)}`;
  elements.termStatus.className = `term-status ${position.phase === "in" ? "in-term" : position.phase === "after" ? "after-term" : ""}`;
  if (position.phase === "before") {
    elements.termStatus.textContent = `${systemTime}｜尚未开课，距实际开课 ${position.daysUntilStart} 天`;
  } else if (position.phase === "after") {
    elements.termStatus.textContent = `${systemTime}｜本学期教学周已结束`;
  } else {
    elements.termStatus.textContent = `${systemTime}｜当前为第 ${position.week} 教学周`;
  }
  elements.todayButton.textContent = position.phase === "before" ? "查看开课日" : position.phase === "after" ? "查看学期末" : "回到今天";
}

function refreshSystemClock() {
  renderTermStatus();
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (minuteKey !== lastClockMinute) {
    lastClockMinute = minuteKey;
    renderCourses();
    if (activeView === "month") renderMonthView();
  }
}

function renderWeekHeader() {
  const monday = dateFor(selectedWeek, 1);
  const sunday = dateFor(selectedWeek, 7);
  elements.weekNumber.textContent = `第 ${selectedWeek} 周`;
  elements.weekRange.textContent = `${formatDate(monday)}—${formatDate(sunday)}`;
  const position = teachingPosition();
  elements.todayButton.textContent = position.phase === "before" ? "查看开课日" : position.phase === "after" ? "查看学期末" : "回到今天";
  if (!elements.weekSelect.options.length) {
    elements.weekSelect.innerHTML = Array.from({length: state.semester.totalWeeks}, (_, index) => `<option value="${index + 1}">第 ${index + 1} 周</option>`).join("");
  }
  elements.weekSelect.value = String(selectedWeek);
  elements.previousWeek.disabled = selectedWeek <= 1;
  elements.nextWeek.disabled = selectedWeek >= state.semester.totalWeeks;
}

function renderDays() {
  elements.dayStrip.innerHTML = DAY_NAMES.map((_, index) => {
    const day = index + 1;
    const date = dateFor(selectedWeek, day);
    const hasClass = isTeachingDate(date) && state.sessions.some((item) => item.day === day && item.weeks.includes(selectedWeek));
    return `<button class="day-button ${day === selectedDay ? "active" : ""} ${hasClass ? "has-class" : ""}" data-day="${day}">
      <span>周${SHORT_DAYS[index]}</span><strong>${date.getDate()}</strong>
    </button>`;
  }).join("");
  elements.dayStrip.querySelector(`[data-day="${selectedDay}"]`)?.scrollIntoView({inline: "center", block: "nearest"});
}

function liveStatus(session, courseDate = dateFor(selectedWeek, selectedDay)) {
  const now = new Date();
  if (courseDate.toDateString() !== now.toDateString()) return "";
  const [startHour, startMinute] = (state.periods.find((item) => item.number === session.periodStart)?.start || "0:0").split(":").map(Number);
  const [endHour, endMinute] = (state.periods.find((item) => item.number === session.periodEnd)?.end || "0:0").split(":").map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) return "上课中";
  if (currentMinutes < startMinutes && startMinutes - currentMinutes <= 60) return `${startMinutes - currentMinutes}分钟后`;
  return "";
}

function courseCard(session, courseDate = dateFor(selectedWeek, selectedDay), editable = true) {
  const status = liveStatus(session, courseDate);
  const linkedMap = campusMaps.find((item) => item.id === session.campusMapId);
  return `<article class="course-card" style="--course-color:${escapeHtml(session.color || DEFAULT_COLOR)}">
    <div class="course-accent"></div>
    <div class="course-content">
      <div class="course-topline"><span class="course-code">${escapeHtml(session.code || "自定义课程")}</span>${status ? `<span class="status-pill">${status}</span>` : ""}</div>
      <h3>${escapeHtml(session.name)}</h3>
      <div class="detail-row"><span class="detail-icon">◷</span><span>${periodTime(session)} · 第${session.periodStart}–${session.periodEnd}节</span></div>
      <div class="detail-row"><span class="detail-icon">⌖</span><span>${escapeHtml(session.location)}${session.campus ? `<br>${escapeHtml(session.campus)}` : ""}${linkedMap ? `<button class="map-link-button open-campus-map" type="button" data-map-id="${escapeHtml(linkedMap.id)}">查看地图</button>` : ""}</span></div>
      ${session.teacher ? `<div class="detail-row"><span class="detail-icon">人</span><span>${escapeHtml(session.teacher)}</span></div>` : ""}
      ${editable ? `<div class="card-actions"><button class="text-button edit-course" data-id="${escapeHtml(session.id)}">修改此安排 →</button></div>` : ""}
    </div>
  </article>`;
}

function renderCourses() {
  const date = dateFor(selectedWeek, selectedDay);
  const today = new Date();
  const actualDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isActualToday = date.toDateString() === actualDate.toDateString();
  const sessions = sessionsForDate(date);
  elements.selectedDateLabel.textContent = `${isActualToday ? "今天" : "课程日期"}：${DAY_NAMES[selectedDay - 1]} · ${formatDate(date, true)}`;
  const periods = totalPeriods(sessions);
  elements.classCount.textContent = sessions.length ? `${sessions.length} 门课 · 共 ${periods} 节` : `${isActualToday ? "今天" : "该日"}没有课`;
  const beforeClassStart = date < parseLocalDate(state.semester.classStartDate);
  elements.courseList.innerHTML = sessions.length
    ? sessions.map((session) => courseCard(session, date)).join("")
    : `<div class="empty-state"><strong>${beforeClassStart ? "尚未到实际开课日期" : `${isActualToday ? "今天" : "该日"}没有课程`}</strong><span>${beforeClassStart ? `实际开课日期为 ${formatDate(parseLocalDate(state.semester.classStartDate), true)}` : "可以安心安排阅读、实验或休息。"}</span></div>`;
}

function renderMonthView() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const today = new Date();
  const todayKey = localDateKey(today);
  elements.visibleMonthLabel.textContent = `${year}年${month + 1}月`;
  elements.monthGrid.innerHTML = monthGridDates(year, month).map((date) => {
    const sessions = sessionsForDate(date);
    const outside = date.getMonth() !== month;
    const dateKey = localDateKey(date);
    const label = `${formatDate(date, true)}，${sessions.length ? `${sessions.length}门课程` : "没有课程"}`;
    return `<button class="month-day ${outside ? "outside-month" : ""} ${dateKey === todayKey ? "today" : ""}" type="button" data-date="${dateKey}" aria-label="${label}">
      <span class="month-day-number">${date.getDate()}</span>
      ${sessions.length ? `<span class="month-course-marker">${sessions.length}</span>` : ""}
    </button>`;
  }).join("");
}

function openDaySchedule(date) {
  const info = teachingInfoForDate(date);
  const sessions = sessionsForDate(date);
  const classStart = parseLocalDate(state.semester.classStartDate);
  elements.dayScheduleTitle.textContent = `${formatDate(date, true)} · ${DAY_NAMES[info.day - 1]}`;
  elements.dayScheduleMeta.textContent = info.teaching
    ? `第 ${info.week} 教学周 · ${sessions.length} 门课程`
    : date < classStart ? "尚未到实际开课日期" : "本学期教学周范围之外";
  if (sessions.length) {
    elements.dayScheduleCourses.innerHTML = sessions.map((session) => courseCard(session, date, false)).join("");
  } else {
    const title = date < classStart ? "尚未到实际开课日期" : info.inTerm ? "当天没有课程" : "不在本学期教学周范围内";
    const detail = date < classStart ? `实际开课日期为 ${formatDate(classStart, true)}` : "没有可显示的课程安排。";
    elements.dayScheduleCourses.innerHTML = `<div class="empty-state"><strong>${title}</strong><span>${detail}</span></div>`;
  }
  elements.dayScheduleDialog.showModal();
}

function renderManageList() {
  const sessions = [...state.sessions].sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.weeks[0] - b.weeks[0] || a.day - b.day);
  elements.manageList.innerHTML = sessions.length ? sessions.map((session) => `<button class="manage-item edit-course" data-id="${escapeHtml(session.id)}">
    <div><h3>${escapeHtml(session.name)}</h3><p>${escapeHtml(session.weekLabel || formatWeeks(session.weeks))} · ${DAY_NAMES[session.day - 1]} · 第${session.periodStart}–${session.periodEnd}节<br>${escapeHtml(session.teacher || "未填写教师")} · ${escapeHtml(session.location)}</p></div>
    <span class="edit-mark">编辑</span>
  </button>`).join("") : '<div class="empty-state"><strong>还没有课程</strong><span>请新增课程，或导入 Excel／图片课表。</span></div>';
}

function formatWeeks(weeks) {
  if (!weeks?.length) return "";
  if (weeks.length === 1) return `第${weeks[0]}周`;
  const consecutive = weeks.every((week, index) => index === 0 || week === weeks[index - 1] + 1);
  if (consecutive) return `第${weeks[0]}–${weeks.at(-1)}周`;
  return `第${weeks.join("、")}周`;
}

function parseWeeks(text) {
  const normalized = text.trim().replace(/[第周\s（）()]/g, "").replace(/[—–~至]/g, "-").replace(/，/g, ",");
  const odd = normalized.includes("单") && !normalized.includes("双");
  const even = normalized.includes("双") && !normalized.includes("单");
  const numeric = normalized.replace(/[单双]/g, "");
  const result = new Set();
  for (const part of numeric.split(",")) {
    if (!part) continue;
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error("周次范围格式不正确");
      for (let week = start; week <= end; week += 1) result.add(week);
    } else {
      const week = Number(part);
      if (!Number.isInteger(week)) throw new Error("周次格式不正确");
      result.add(week);
    }
  }
  let weeks = [...result].sort((a, b) => a - b);
  if (odd) weeks = weeks.filter((week) => week % 2 === 1);
  if (even) weeks = weeks.filter((week) => week % 2 === 0);
  if (!weeks.length || weeks.some((week) => week < 1 || week > 30)) throw new Error("请输入 1–30 之间的有效周次");
  return weeks;
}

function openEditor(id = "") {
  const session = state.sessions.find((item) => item.id === id);
  const form = elements.courseForm;
  form.reset();
  elements.formError.textContent = "";
  $("#dialogTitle").textContent = session ? "编辑课程" : "新增课程";
  $("#dialogEyebrow").textContent = session ? "修改上课安排" : "添加上课安排";
  elements.deleteCourse.classList.toggle("hidden", !session);
  const values = session || {
    id: "", name: "", code: "", teacher: "", day: selectedDay, weeks: [selectedWeek],
    periodStart: 1, periodEnd: 2, location: "", campus: state.semester.campus, campusMapId: "", notes: ""
  };
  for (const name of ["id", "name", "code", "teacher", "day", "periodStart", "periodEnd", "location", "campus", "notes"]) {
    form.elements[name].value = values[name] ?? "";
  }
  form.elements.campusMapId.innerHTML = `<option value="">不关联地图</option>${campusMaps.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.campus ? `${item.campus} · ${item.name}` : item.name)}</option>`).join("")}`;
  form.elements.campusMapId.value = values.campusMapId || "";
  form.elements.weeksText.value = session?.weekLabel || formatWeeks(values.weeks).replace(/[第周]/g, "").replace("–", "-");
  elements.courseDialog.showModal();
}

async function saveState(message) {
  if (window.CourseAppNative?.saveState) {
    const result = JSON.parse(window.CourseAppNative.saveState(JSON.stringify(state)));
    if (!result.ok) throw new Error(result.error || "保存失败");
    showToast(message);
    return;
  }
  const response = await fetch("/api/state", {
    method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(state)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存失败");
  localStorage.setItem("course-schedule-cache", JSON.stringify(state));
  showToast(message);
}

async function submitCourse(event) {
  event.preventDefault();
  const form = new FormData(elements.courseForm);
  try {
    const weeksText = String(form.get("weeksText"));
    const weeks = parseWeeks(weeksText);
    const periodStart = Number(form.get("periodStart"));
    const periodEnd = Number(form.get("periodEnd"));
    if (periodStart > periodEnd) throw new Error("开始节次不能晚于结束节次");
    const existingId = String(form.get("id"));
    const previous = state.sessions.find((item) => item.id === existingId);
    const session = {
      id: existingId || `custom-${Date.now()}`,
      code: String(form.get("code")).trim(), name: String(form.get("name")).trim(),
      teacher: String(form.get("teacher")).trim(), day: Number(form.get("day")),
      periodStart, periodEnd, weeks, weekLabel: weeksText.trim(),
      location: String(form.get("location")).trim(), campus: String(form.get("campus")).trim(),
      campusMapId: String(form.get("campusMapId") || ""),
      notes: String(form.get("notes")).trim(), color: previous?.color || DEFAULT_COLOR
    };
    if (previous) state.sessions = state.sessions.map((item) => item.id === existingId ? session : item);
    else state.sessions.push(session);
    await saveState(previous ? "课程修改已保存" : "课程已添加");
    elements.courseDialog.close();
    render();
  } catch (error) {
    elements.formError.textContent = error.message.includes("fetch") ? "无法连接电脑，修改尚未保存。" : error.message;
  }
}

async function deleteCurrentCourse() {
  const id = elements.courseForm.elements.id.value;
  const session = state.sessions.find((item) => item.id === id);
  if (!session || !confirm(`确定删除“${session.name}”这条上课安排吗？`)) return;
  const original = state.sessions;
  state.sessions = state.sessions.filter((item) => item.id !== id);
  try {
    await saveState("课程安排已删除");
    elements.courseDialog.close();
    render();
  } catch (error) {
    state.sessions = original;
    elements.formError.textContent = "删除失败，请确认电脑上的课程表服务仍在运行。";
  }
}

function validFirstTeachingDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseLocalDate(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
}

async function saveTeachingDates() {
  const nextWeekOneStart = elements.weekOneStart.value.trim();
  const nextClassStartDate = elements.classStartDate.value.trim();
  elements.teachingDateError.textContent = "";
  if (!validFirstTeachingDay(nextWeekOneStart) || !validFirstTeachingDay(nextClassStartDate)) {
    elements.teachingDateError.textContent = "请选择有效的教学周基准日和实际开课日期";
    return;
  }
  if (parseLocalDate(nextWeekOneStart).getDay() !== 1) {
    elements.teachingDateError.textContent = "第一教学周基准日必须是星期一";
    return;
  }
  const termEnd = addDays(parseLocalDate(nextWeekOneStart), state.semester.totalWeeks * 7);
  const classStart = parseLocalDate(nextClassStartDate);
  if (classStart < parseLocalDate(nextWeekOneStart) || classStart >= termEnd) {
    elements.teachingDateError.textContent = "实际开课日期必须位于本学期教学周范围内";
    return;
  }
  if (nextWeekOneStart === state.semester.weekOneStart && nextClassStartDate === state.semester.classStartDate) {
    showToast("日期未改变");
    return;
  }

  const previousWeekOneStart = state.semester.weekOneStart;
  const previousClassStartDate = state.semester.classStartDate;
  state.semester.weekOneStart = nextWeekOneStart;
  state.semester.classStartDate = nextClassStartDate;
  try {
    await saveState("教学日期已保存");
    elements.weekSelect.innerHTML = "";
    const position = teachingPosition();
    selectedWeek = position.week;
    selectedDay = position.day;
    render();
  } catch (error) {
    state.semester.weekOneStart = previousWeekOneStart;
    state.semester.classStartDate = previousClassStartDate;
    elements.weekOneStart.value = previousWeekOneStart;
    elements.classStartDate.value = previousClassStartDate;
    elements.teachingDateError.textContent = error.message || "教学日期保存失败";
  }
}

async function importExcel(file) {
  if (!file) return;
  const importButton = $("#importExcel");
  importButton.disabled = true;
  try {
    if (!window.XLSX || !window.CourseExcelImport) throw new Error("Excel 解析组件未能加载，请重新安装最新版应用");
    const buffer = file.arrayBuffer ? await file.arrayBuffer() : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取所选 Excel 文件"));
      reader.readAsArrayBuffer(file);
    });
    const workbook = XLSX.read(buffer, {type: "array"});
    let imported;
    let lastError;
    for (const sheetName of workbook.SheetNames) {
      try {
        imported = CourseExcelImport.parseWorksheet(workbook.Sheets[sheetName], XLSX, parseWeeks, file.name);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!imported) throw lastError || new Error("工作簿中没有可识别的课程表");
    const courseCount = new Set(imported.sessions.map((item) => `${item.code}|${item.name}`)).size;
    const confirmed = confirm(
      `识别结果：${courseCount} 门课程、${imported.sessions.length} 条上课安排。\n\n` +
      `第一教学周基准日：${state.semester.weekOneStart}（星期一）\n` +
      `实际开课日期：${state.semester.classStartDate}\n` +
      `教学周数：${imported.totalWeeks} 周\n\n` +
      "确认后将替换当前课程，是否继续？"
    );
    if (!confirmed) return;

    const previous = state;
    state = {
      version: 1,
      semester: {
        ...state.semester, name: imported.title,
        totalWeeks: imported.totalWeeks, sourceFile: file.name,
        campus: imported.sessions.find((item) => item.campus)?.campus || ""
      },
      periods: imported.periods,
      sessions: imported.sessions
    };
    try {
      await saveState(`已导入 ${courseCount} 门课程`);
    } catch (error) {
      state = previous;
      throw error;
    }
    elements.weekSelect.innerHTML = "";
    const position = teachingPosition();
    selectedWeek = position.week;
    selectedDay = position.day;
    render();
  } catch (error) {
    alert(`导入失败：${error.message}`);
  } finally {
    importButton.disabled = false;
    elements.excelFile.value = "";
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2300);
}

function mapUrl(id) {
  return `https://courseapp.local/maps/${encodeURIComponent(id)}`;
}

function refreshCampusMaps() {
  if (nativePlatform() !== "Android" || !window.CourseAppNative?.listCampusMaps) return;
  try {
    const result = nativeResult("listCampusMaps");
    if (!result.ok) throw new Error(result.error || "地图读取失败");
    campusMaps = Array.isArray(result.maps) ? result.maps : [];
    renderCampusMaps();
  } catch (error) {
    elements.campusMapList.innerHTML = `<div class="empty-state"><strong>无法读取地图</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderCampusMaps() {
  elements.campusMapList.innerHTML = campusMaps.length ? campusMaps.map((item) => `<article class="map-list-item">
    <img class="map-thumbnail" src="${mapUrl(item.id)}" alt="" />
    <div class="map-list-content">
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.campus || "未填写校区")}${item.source === "pdf" ? " · PDF 提取" : " · 本地图片"}</p>
      <div class="map-list-actions">
        <button class="open-campus-map" type="button" data-map-id="${escapeHtml(item.id)}">查看</button>
        <button class="rename-campus-map" type="button" data-map-id="${escapeHtml(item.id)}">重命名</button>
        <button class="delete-map delete-campus-map" type="button" data-map-id="${escapeHtml(item.id)}">删除</button>
      </div>
    </div>
  </article>`).join("") : '<div class="empty-state"><strong>还没有校区地图</strong><span>可以导入图片，或从学校通知 PDF 中提取。</span></div>';
}

function pickCampusMap(kind) {
  try {
    const name = $("#campusMapName").value.trim();
    const campus = $("#campusMapCampus").value.trim();
    const result = nativeResult("pickCampusMap", kind, name, campus);
    if (!result.ok) throw new Error(result.error || "无法打开文件选择器");
  } catch (error) {
    alert(error.message);
  }
}

window.onNativeCampusMapImported = function (payload) {
  const result = JSON.parse(payload);
  if (!result.ok) {
    alert(`地图导入失败：${result.error || "未知错误"}`);
    return;
  }
  $("#campusMapName").value = "";
  refreshCampusMaps();
  showToast("校区地图已保存在本机");
};

function openCampusMap(id) {
  const item = campusMaps.find((map) => map.id === id);
  if (!item) return;
  $("#mapViewerTitle").textContent = item.name;
  $("#mapViewerCampus").textContent = item.campus || "校区地图";
  elements.mapViewerImage.src = `${mapUrl(item.id)}?v=${encodeURIComponent(item.updatedAt || "")}`;
  elements.campusMapDialog.showModal();
}

function renderMapTransform() {
  const totalScale = mapBaseScale * mapScale;
  elements.mapViewerImage.style.transform = `translate(-50%, -50%) translate(${mapTranslateX}px, ${mapTranslateY}px) scale(${totalScale})`;
}

function resetMapViewer() {
  const image = elements.mapViewerImage;
  const canvas = elements.mapCanvas;
  if (!image.naturalWidth || !image.naturalHeight) return;
  mapBaseScale = Math.min(canvas.clientWidth / image.naturalWidth, canvas.clientHeight / image.naturalHeight);
  mapScale = 1;
  mapTranslateX = 0;
  mapTranslateY = 0;
  renderMapTransform();
}

function zoomMap(multiplier) {
  mapScale = Math.max(1, Math.min(6, mapScale * multiplier));
  if (mapScale === 1) {
    mapTranslateX = 0;
    mapTranslateY = 0;
  }
  renderMapTransform();
}

function renameCampusMap(id) {
  const item = campusMaps.find((map) => map.id === id);
  if (!item) return;
  const name = prompt("地图名称", item.name);
  if (name === null || !name.trim()) return;
  const campus = prompt("所属校区", item.campus || "");
  if (campus === null) return;
  const result = nativeResult("updateCampusMap", id, name.trim(), campus.trim());
  if (!result.ok) return alert(result.error || "地图更新失败");
  refreshCampusMaps();
  render();
}

async function deleteCampusMap(id) {
  const item = campusMaps.find((map) => map.id === id);
  if (!item || !confirm(`确定删除地图“${item.name}”吗？关联课程将保留地点文字，但不再显示地图入口。`)) return;
  const result = nativeResult("deleteCampusMap", id);
  if (!result.ok) return alert(result.error || "地图删除失败");
  state.sessions = state.sessions.map((session) => session.campusMapId === id ? {...session, campusMapId: ""} : session);
  await saveState("校区地图已删除");
  refreshCampusMaps();
  render();
}

function switchView(view) {
  activeView = view;
  elements.scheduleView.classList.toggle("hidden", view !== "schedule");
  elements.monthView.classList.toggle("hidden", view !== "month");
  elements.manageView.classList.toggle("hidden", view !== "manage");
  elements.visionView.classList.toggle("hidden", view !== "vision");
  elements.mapView.classList.toggle("hidden", view !== "map");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  if (view === "month") renderMonthView();
  if (view === "manage") renderManageList();
  if (view === "vision") refreshDeepSeekKeyStatus();
  if (view === "map") refreshCampusMaps();
  window.scrollTo({top: 0, behavior: "smooth"});
}

function setVisionStatus(message, error = false) {
  elements.visionStatus.textContent = message;
  elements.visionStatus.classList.toggle("error", error);
}

function nativeResult(method, ...args) {
  if (!window.CourseAppNative?.[method]) throw new Error("此功能仅支持 Android 应用");
  return JSON.parse(window.CourseAppNative[method](...args));
}

function refreshDeepSeekKeyStatus() {
  if (nativePlatform() !== "Android") return;
  try {
    const result = nativeResult("hasDeepSeekApiKey");
    elements.deepSeekKeyStatus.textContent = result.configured ? "已在本机加密保存 API Key" : "尚未配置 API Key";
    elements.deepSeekKeyStatus.classList.toggle("error", !result.configured);
  } catch (error) {
    elements.deepSeekKeyStatus.textContent = error.message;
    elements.deepSeekKeyStatus.classList.add("error");
  }
}

function saveDeepSeekKey() {
  try {
    const key = elements.deepSeekApiKey.value.trim();
    if (!key) throw new Error("请输入 DeepSeek API Key");
    const result = nativeResult("saveDeepSeekApiKey", key);
    if (!result.ok) throw new Error(result.error || "密钥保存失败");
    elements.deepSeekApiKey.value = "";
    refreshDeepSeekKeyStatus();
    showToast("API Key 已加密保存");
  } catch (error) {
    elements.deepSeekKeyStatus.textContent = error.message;
    elements.deepSeekKeyStatus.classList.add("error");
  }
}

function deleteDeepSeekKey() {
  if (!confirm("确定删除本机保存的 DeepSeek API Key 吗？")) return;
  const result = nativeResult("deleteDeepSeekApiKey");
  if (!result.ok) {
    elements.deepSeekKeyStatus.textContent = result.error || "删除失败";
    return;
  }
  refreshDeepSeekKeyStatus();
  showToast("API Key 已删除");
}

function chooseVisionImage(file) {
  recognizedSchedule = undefined;
  elements.visionResultCard.classList.add("hidden");
  if (!file) return;
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
    setVisionStatus("只支持 JPEG、PNG、GIF 或 WebP 图片", true);
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    setVisionStatus("图片超过 12 MB，请压缩后重试", true);
    return;
  }
  selectedVisionFile = file;
  if (visionPreviewUrl) URL.revokeObjectURL(visionPreviewUrl);
  visionPreviewUrl = URL.createObjectURL(file);
  elements.scheduleImagePreview.src = visionPreviewUrl;
  elements.scheduleImagePreview.classList.remove("hidden");
  elements.recognizeScheduleImage.disabled = false;
  setVisionStatus(`已选择 ${file.name}，请确认图片清晰后开始识别`);
}

function recognizeVisionImage() {
  if (!selectedVisionFile) return;
  elements.recognizeScheduleImage.disabled = true;
  setVisionStatus("正在读取并上传图片，识别可能需要几十秒…");
  const reader = new FileReader();
  reader.onerror = () => {
    elements.recognizeScheduleImage.disabled = false;
    setVisionStatus("无法读取所选图片", true);
  };
  reader.onload = () => {
    try {
      const result = nativeResult("recognizeSchedule", String(reader.result));
      if (!result.ok) throw new Error(result.error || "无法开始识别");
    } catch (error) {
      elements.recognizeScheduleImage.disabled = false;
      setVisionStatus(error.message, true);
    }
  };
  reader.readAsDataURL(selectedVisionFile);
}

window.onNativeVisionResult = function (payload) {
  elements.recognizeScheduleImage.disabled = false;
  try {
    const result = JSON.parse(payload);
    if (!result.ok) throw new Error(result.error || "识别失败");
    recognizedSchedule = result.schedule;
    const sessions = Array.isArray(recognizedSchedule.sessions) ? recognizedSchedule.sessions : [];
    if (!sessions.length) throw new Error("图片中没有识别到课程安排");
    elements.visionResults.innerHTML = [
      `<div><strong>识别到 ${sessions.length} 条课程安排</strong></div>`,
      ...sessions.slice(0, 12).map((item) => `<div class="vision-result-item"><strong>${escapeHtml(item.name || "未命名课程")}</strong><br>${escapeHtml(DAY_NAMES[Number(item.day) - 1] || "星期未知")} · 第${Number(item.periodStart) || "?"}–${Number(item.periodEnd) || "?"}节 · ${escapeHtml(item.location || "地点未识别")}</div>`),
      sessions.length > 12 ? `<div>另有 ${sessions.length - 12} 条，请导入后继续核对。</div>` : ""
    ].join("");
    elements.visionResultCard.classList.remove("hidden");
    setVisionStatus("识别完成，请仔细核对下方结果");
  } catch (error) {
    recognizedSchedule = undefined;
    elements.visionResultCard.classList.add("hidden");
    setVisionStatus(error.message, true);
  }
};

async function importVisionSchedule() {
  try {
    if (!recognizedSchedule?.sessions?.length) throw new Error("没有可导入的识别结果");
    const inferredWeeks = recognizedSchedule.sessions.flatMap((item) => Array.isArray(item.weeks) ? item.weeks : []);
    const totalWeeks = Math.max(1, Math.min(30, Number(recognizedSchedule.totalWeeks) || Math.max(0, ...inferredWeeks) || state.semester.totalWeeks));
    const sessions = recognizedSchedule.sessions.map((item, index) => {
      const day = Number(item.day), periodStart = Number(item.periodStart), periodEnd = Number(item.periodEnd);
      const weeks = [...new Set((Array.isArray(item.weeks) ? item.weeks : []).map(Number).filter((week) => week >= 1 && week <= totalWeeks))].sort((a, b) => a - b);
      if (!String(item.name || "").trim() || day < 1 || day > 7 || periodStart < 1 || periodEnd < periodStart || !weeks.length) {
        throw new Error(`第 ${index + 1} 条课程缺少名称、星期、节次或周次，请重新识别`);
      }
      return {
        id: `vision-${Date.now()}-${index}`, name: String(item.name).trim(), code: String(item.code || "").trim(),
        teacher: String(item.teacher || "").trim(), day, periodStart, periodEnd, weeks, weekLabel: formatWeeks(weeks),
        location: String(item.location || "").trim(), campus: String(item.campus || "").trim(),
        notes: String(item.notes || "图片识别导入，需人工核对").trim(), color: DEFAULT_COLOR
      };
    });
    if (!confirm(`将用识别到的 ${sessions.length} 条安排替换当前课程。第一教学周基准日仍为 ${state.semester.weekOneStart}，实际开课日期仍为 ${state.semester.classStartDate}。是否继续？`)) return;
    const previous = state;
    state = {
      ...state,
      semester: {...state.semester, name: String(recognizedSchedule.title || state.semester.name), totalWeeks},
      periods: Array.isArray(recognizedSchedule.periods) && recognizedSchedule.periods.length ? recognizedSchedule.periods : state.periods,
      sessions
    };
    try { await saveState(`已导入 ${sessions.length} 条识别结果`); } catch (error) { state = previous; throw error; }
    elements.weekSelect.innerHTML = "";
    selectedWeek = teachingPosition().week;
    render();
    switchView("manage");
  } catch (error) {
    setVisionStatus(error.message, true);
  }
}

async function showInfo() {
  elements.infoDialog.showModal();
  if (window.CourseAppNative?.loadState) {
    const platform = nativePlatform();
    $("#infoLead").textContent = "课程查看、编辑和 Excel 导入均在本机完成，不需要连接电脑。";
    $("#infoNote").textContent = platform === "iOS"
      ? "仅在你主动检查更新时连接 GitHub。iOS 开发构建需要使用你自己的苹果签名后才能侧载；卸载应用会清除本机课程修改。"
      : "仅在你主动点击“检查更新”或“下载并安装”时连接 GitHub。正常覆盖安装会保留本机课程修改；卸载应用会清除数据。";
    elements.lanUrls.innerHTML = "<span>本地模式 · 课程数据不上传</span>";
    $("#updatePanel").classList.remove("hidden");
    $("#appVersion").textContent = `当前版本 ${window.CourseAppNative.getAppVersion?.() || ""}${platform ? ` · ${platform}` : ""}`;
    return;
  }
  try {
    const response = await fetch("/api/info");
    const info = await response.json();
    elements.lanUrls.innerHTML = info.lanUrls.length
      ? info.lanUrls.map((url) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`).join("")
      : "<span>未检测到局域网地址，请确认电脑已连接 Wi‑Fi。</span>";
  } catch {
    elements.lanUrls.textContent = "暂时无法读取局域网地址。";
  }
}

function versionParts(value) {
  return String(value).replace(/^[vV]/, "").split(".").map((part) => Number(part.match(/^\d+/)?.[0] || 0));
}

function isNewerVersion(latest, current) {
  const left = versionParts(latest);
  const right = versionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return false;
}

window.onNativeUpdateCheck = function (payload) {
  const result = JSON.parse(payload);
  const status = $("#updateStatus");
  const downloadButton = $("#downloadUpdate");
  $("#checkUpdate").disabled = false;
  availableUpdateUrl = "";
  downloadButton.classList.add("hidden");
  if (!result.ok) {
    status.textContent = result.error || "暂时无法检查更新";
    return;
  }
  if (!isNewerVersion(result.latestVersion, result.currentVersion)) {
    status.textContent = `已是最新版（${result.currentVersion}）`;
    return;
  }
  const platform = nativePlatform();
  const packageUrl = platform === "iOS" ? result.ipaUrl : result.apkUrl;
  const packageName = platform === "iOS" ? "IPA" : "APK";
  if (!packageUrl) {
    status.textContent = `发现 ${result.latestVersion}，但该版本未附带 ${packageName}`;
    return;
  }
  availableUpdateUrl = packageUrl;
  status.textContent = `发现新版本 ${result.latestVersion}`;
  downloadButton.textContent = platform === "iOS" ? "打开安装文件" : "下载并安装";
  downloadButton.classList.remove("hidden");
};

window.onNativeUpdateStatus = function (message, isError) {
  $("#updateStatus").textContent = message;
  if (isError) $("#downloadUpdate").disabled = false;
};

function checkForUpdate() {
  if (!window.CourseAppNative?.checkForUpdate) return;
  $("#checkUpdate").disabled = true;
  $("#updateStatus").textContent = "正在连接 GitHub 检查…";
  window.CourseAppNative.checkForUpdate();
}

function downloadUpdate() {
  if (!availableUpdateUrl || !window.CourseAppNative?.downloadUpdate) return;
  $("#downloadUpdate").disabled = true;
  window.CourseAppNative.downloadUpdate(availableUpdateUrl);
}

function bindEvents() {
  elements.previousWeek.addEventListener("click", () => { selectedWeek = Math.max(1, selectedWeek - 1); render(); });
  elements.nextWeek.addEventListener("click", () => { selectedWeek = Math.min(state.semester.totalWeeks, selectedWeek + 1); render(); });
  elements.weekSelect.addEventListener("change", () => { selectedWeek = Number(elements.weekSelect.value); render(); });
  elements.todayButton.addEventListener("click", () => { const position = teachingPosition(); selectedWeek = position.week; selectedDay = position.day; render(); });
  elements.dayStrip.addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    selectedDay = Number(button.dataset.day); renderDays(); renderCourses();
  });
  $("#previousMonth").addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    renderMonthView();
  });
  $("#nextMonth").addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    renderMonthView();
  });
  $("#currentMonth").addEventListener("click", () => {
    const today = new Date();
    visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    renderMonthView();
  });
  elements.monthGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    const date = parseLocalDate(button.dataset.date);
    if (date.getMonth() !== visibleMonth.getMonth() || date.getFullYear() !== visibleMonth.getFullYear()) {
      visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderMonthView();
    }
    openDaySchedule(date);
  });
  document.body.addEventListener("click", (event) => {
    const editor = event.target.closest(".edit-course");
    if (editor) openEditor(editor.dataset.id);
    const mapOpener = event.target.closest(".open-campus-map");
    if (mapOpener) openCampusMap(mapOpener.dataset.mapId);
    const mapRenamer = event.target.closest(".rename-campus-map");
    if (mapRenamer) renameCampusMap(mapRenamer.dataset.mapId);
    const mapDeleter = event.target.closest(".delete-campus-map");
    if (mapDeleter) deleteCampusMap(mapDeleter.dataset.mapId);
  });
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#addCourse").addEventListener("click", () => openEditor());
  $("#importExcel").addEventListener("click", () => elements.excelFile.click());
  elements.excelFile.addEventListener("change", () => importExcel(elements.excelFile.files[0]));
  $("#saveTeachingDates").addEventListener("click", saveTeachingDates);
  $("#saveDeepSeekKey").addEventListener("click", saveDeepSeekKey);
  $("#deleteDeepSeekKey").addEventListener("click", deleteDeepSeekKey);
  $("#chooseScheduleImage").addEventListener("click", () => elements.scheduleImage.click());
  elements.scheduleImage.addEventListener("change", () => chooseVisionImage(elements.scheduleImage.files[0]));
  elements.recognizeScheduleImage.addEventListener("click", recognizeVisionImage);
  $("#importVisionResult").addEventListener("click", importVisionSchedule);
  $("#importMapImage").addEventListener("click", () => pickCampusMap("image"));
  $("#importMapPdf").addEventListener("click", () => pickCampusMap("pdf"));
  $("#closeCampusMap").addEventListener("click", () => elements.campusMapDialog.close());
  $("#mapZoomOut").addEventListener("click", () => zoomMap(0.8));
  $("#mapZoomIn").addEventListener("click", () => zoomMap(1.25));
  $("#mapReset").addEventListener("click", resetMapViewer);
  elements.mapViewerImage.addEventListener("load", resetMapViewer);
  elements.mapCanvas.addEventListener("pointerdown", (event) => {
    elements.mapCanvas.setPointerCapture(event.pointerId);
    mapPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (mapPointers.size === 1) mapGesture = {x: event.clientX, y: event.clientY, translateX: mapTranslateX, translateY: mapTranslateY};
    if (mapPointers.size === 2) {
      const [first, second] = [...mapPointers.values()];
      mapGesture = {distance: Math.hypot(second.x - first.x, second.y - first.y), scale: mapScale};
    }
  });
  elements.mapCanvas.addEventListener("pointermove", (event) => {
    if (!mapPointers.has(event.pointerId)) return;
    mapPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (mapPointers.size === 1 && mapScale > 1 && mapGesture?.translateX !== undefined) {
      mapTranslateX = mapGesture.translateX + event.clientX - mapGesture.x;
      mapTranslateY = mapGesture.translateY + event.clientY - mapGesture.y;
      renderMapTransform();
    } else if (mapPointers.size === 2 && mapGesture?.distance) {
      const [first, second] = [...mapPointers.values()];
      mapScale = Math.max(1, Math.min(6, mapGesture.scale * Math.hypot(second.x - first.x, second.y - first.y) / mapGesture.distance));
      renderMapTransform();
    }
  });
  const endMapPointer = (event) => {
    mapPointers.delete(event.pointerId);
    if (mapPointers.size === 1) {
      const point = [...mapPointers.values()][0];
      mapGesture = {x: point.x, y: point.y, translateX: mapTranslateX, translateY: mapTranslateY};
    } else if (!mapPointers.size) mapGesture = undefined;
  };
  elements.mapCanvas.addEventListener("pointerup", endMapPointer);
  elements.mapCanvas.addEventListener("pointercancel", endMapPointer);
  $("#closeDialog").addEventListener("click", () => elements.courseDialog.close());
  $("#cancelDialog").addEventListener("click", () => elements.courseDialog.close());
  $("#closeDaySchedule").addEventListener("click", () => elements.dayScheduleDialog.close());
  elements.dayScheduleDialog.addEventListener("click", (event) => {
    if (event.target === elements.dayScheduleDialog) elements.dayScheduleDialog.close();
  });
  elements.courseForm.addEventListener("submit", submitCourse);
  elements.deleteCourse.addEventListener("click", deleteCurrentCourse);
  $("#infoButton").addEventListener("click", showInfo);
  $("#closeInfo").addEventListener("click", () => elements.infoDialog.close());
  $("#checkUpdate").addEventListener("click", checkForUpdate);
  $("#downloadUpdate").addEventListener("click", downloadUpdate);
}

async function initialize() {
  if (!localStorage.getItem("privacy-reset-1-3")) {
    localStorage.removeItem("course-schedule-cache");
    localStorage.setItem("privacy-reset-1-3", "done");
  }
  try {
    if (window.CourseAppNative?.loadState) {
      state = JSON.parse(window.CourseAppNative.loadState());
    } else {
      const response = await fetch("/api/state", {cache: "no-store"});
      if (!response.ok) throw new Error("加载失败");
      state = await response.json();
      localStorage.setItem("course-schedule-cache", JSON.stringify(state));
    }
  } catch {
    const cached = localStorage.getItem("course-schedule-cache");
    if (!cached) {
      document.body.innerHTML = '<div class="empty-state" style="margin:40px"><strong>无法加载课程表</strong><span>请在电脑上重新双击“打开课程表”。</span></div>';
      return;
    }
    state = JSON.parse(cached);
    showToast("当前为离线只读缓存");
  }
  normalizeStateDates();
  const position = teachingPosition();
  selectedWeek = position.week;
  selectedDay = position.day;
  bindEvents();
  if (nativePlatform() === "Android" && window.CourseAppNative?.recognizeSchedule) {
    document.querySelectorAll(".android-only").forEach((item) => item.classList.remove("hidden"));
    refreshCampusMaps();
  }
  render();
  refreshSystemClock();
  setInterval(refreshSystemClock, 1000);
  window.__courseAppReady = true;
  if (!window.CourseAppNative && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initialize();
