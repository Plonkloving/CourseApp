const DAY_NAMES = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const SHORT_DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const DEFAULT_COLOR = "#3157A4";
const USAGE_NOTICE_VERSION = "4";
const USAGE_NOTICE_STORAGE_KEY = "course-app-usage-notice";
const IGNORED_UPDATE_STORAGE_KEY = "course-app-ignored-update";

let state;
let selectedWeek = 1;
let selectedDay = 1;
let visibleMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let activeView = "schedule";
let toastTimer;
let lastClockMinute = "";
let availableUpdateUrl = "";
let availableUpdateVersion = "";
let updateCheckMode = "manual";
let resolveNoticeAcceptance;
let weekGridFiveDays = localStorage.getItem("course-app-week-days") !== "7";
let manageExpanded = new Set();
let manageFilterDay = 0;
let manageSettingsOpen = false;
let weekGridDayCount = 7;
let conflictAcknowledge = false;

const $ = (selector) => document.querySelector(selector);
const elements = {
  semesterName: $("#semesterName"), termStatus: $("#termStatus"), weekNumber: $("#weekNumber"), weekRange: $("#weekRange"),
  dayStrip: $("#dayStrip"), selectedDateLabel: $("#selectedDateLabel"), classCount: $("#classCount"),
  courseList: $("#courseList"), manageList: $("#manageList"), scheduleView: $("#scheduleView"),
  weekView: $("#weekView"), weekGrid: $("#weekGrid"), weekGridNumber: $("#weekGridNumber"), weekGridRange: $("#weekGridRange"),
  weekGridPrevious: $("#weekGridPrevious"), weekGridNext: $("#weekGridNext"), weekGridToday: $("#weekGridToday"), weekGridEmpty: $("#weekGridEmpty"),
  weekGridDays: $("#weekGridDays"),
  monthView: $("#monthView"), monthGrid: $("#monthGrid"), visibleMonthLabel: $("#visibleMonthLabel"),
  dayScheduleDialog: $("#dayScheduleDialog"), dayScheduleMeta: $("#dayScheduleMeta"), dayScheduleTitle: $("#dayScheduleTitle"), dayScheduleCourses: $("#dayScheduleCourses"),
  manageView: $("#manageView"), previousWeek: $("#previousWeek"), nextWeek: $("#nextWeek"),
  manageDayChips: $("#manageDayChips"), manageToggleAll: $("#manageToggleAll"),
  manageSettingsToggle: $("#manageSettingsToggle"), semesterSettings: $("#semesterSettings"),
  backupFile: $("#backupFile"), exportBackupBtn: $("#exportBackup"), importBackupBtn: $("#importBackup"),
  exportIcsBtn: $("#exportIcs"), exportWeekImageBtn: $("#exportWeekImage"),
  eventCountdown: $("#eventCountdown"), periodEditor: $("#periodEditor"), eventEditor: $("#eventEditor"),
  attendanceStats: $("#attendanceStats"),
  semesterSelect: $("#semesterSelect"), addSemester: $("#addSemester"), deleteSemester: $("#deleteSemester"),
  diaryMonthLabel: $("#diaryMonthLabel"), diaryPrevMonth: $("#diaryPrevMonth"), diaryNextMonth: $("#diaryNextMonth"),
  todayButton: $("#todayButton"), weekSelect: $("#weekSelect"), courseDialog: $("#courseDialog"), courseForm: $("#courseForm"),
  deleteCourse: $("#deleteCourse"), formError: $("#formError"), toast: $("#toast"),
  infoDialog: $("#infoDialog"), lanUrls: $("#lanUrls"), excelFile: $("#excelFile"),
  weekOneStart: $("#weekOneStart"), classStartDate: $("#classStartDate"), teachingDateError: $("#teachingDateError"),
  diaryView: $("#diaryView"), diaryLockBtn: $("#diaryLockBtn"), diaryLockCard: $("#diaryLockCard"),
  diaryLockTitle: $("#diaryLockTitle"), diaryPinInput: $("#diaryPinInput"), diaryUnlock: $("#diaryUnlock"),
  diaryResetPin: $("#diaryResetPin"), diaryPinStatus: $("#diaryPinStatus"), diaryContent: $("#diaryContent"),
  diarySearch: $("#diarySearch"), diaryCalendar: $("#diaryCalendar"), diarySearchResults: $("#diarySearchResults"),
  diaryDateLabel: $("#diaryDateLabel"), diaryQuoteCourses: $("#diaryQuoteCourses"), diaryMood: $("#diaryMood"),
  diaryTitle: $("#diaryTitle"), diaryText: $("#diaryText"), diaryDelete: $("#diaryDelete"), diarySave: $("#diarySave"),
  notificationEnabled: $("#notificationEnabled"),
  notificationLeadMinutes: $("#notificationLeadMinutes"), notificationShowDetails: $("#notificationShowDetails"),
  usageNoticeDialog: $("#usageNoticeDialog"), startupUpdateDialog: $("#startupUpdateDialog")
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

function applyActiveSemester() {
  const active = state.semesters.find((item) => item.id === state.activeSemesterId) || state.semesters[0];
  state.activeSemesterId = active.id;
  state.semester = active.semester;
  state.periods = active.periods || [];
  state.sessions = active.sessions || [];
  state.events = active.events || [];
  state.diaries = Array.isArray(state.diaries) ? state.diaries : [];
  state.attendance = state.attendance && !Array.isArray(state.attendance) && typeof state.attendance === "object"
    ? state.attendance : {};
  normalizeStateDates();
}

function normalizeState() {
  normalizeStateDates();
  if (!Array.isArray(state.semesters) || !state.semesters.length) {
    const id = `sem-${Date.now()}`;
    state.semesters = [{id, semester: state.semester, periods: state.periods || [], sessions: state.sessions || [], events: state.events || []}];
    state.activeSemesterId = id;
  }
  state.version = 3;
  if (!state.semesters.some((item) => item.id === state.activeSemesterId)) {
    state.activeSemesterId = state.semesters[0].id;
  }
  applyActiveSemester();
}

function syncActiveSemesterEntry() {
  const entry = (state.semesters || []).find((item) => item.id === state.activeSemesterId);
  if (entry) {
    entry.semester = state.semester;
    entry.periods = state.periods;
    entry.sessions = state.sessions;
    entry.events = state.events || [];
  }
}

function renderSemesterSwitcher() {
  if (!state) return;
  elements.semesterSelect.innerHTML = state.semesters.map((item) =>
    `<option value="${escapeHtml(item.id)}"${item.id === state.activeSemesterId ? " selected" : ""}>${escapeHtml(item.semester.name || "未命名学期")}</option>`).join("");
  elements.deleteSemester.disabled = state.semesters.length <= 1;
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
  renderDayTimeline();
  renderWeekGrid();
  renderMonthView();
  renderManageList();
  refreshSettingsEditors();
}

function nearestEventCountdown() {
  if (!state || !Array.isArray(state.events) || !state.events.length) return "";
  const today = parseLocalDate(localDateKey(new Date()));
  const upcoming = state.events
    .filter((item) => item && item.name && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")))
    .map((item) => ({name: String(item.name).slice(0, 30), target: parseLocalDate(item.date)}))
    .filter((item) => item.target >= today)
    .sort((a, b) => a.target - b.target)[0];
  if (!upcoming) return "";
  const days = Math.round((upcoming.target - today) / 86400000);
  return days === 0 ? `「${upcoming.name}」就是今天！` : `距「${upcoming.name}」还有 ${days} 天`;
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
  elements.todayButton.textContent = position.phase === "before" ? "查看开课日" : position.phase === "after" ? "查看学期末" : "回到本周";
  const countdown = nearestEventCountdown();
  elements.eventCountdown.textContent = countdown;
  elements.eventCountdown.classList.toggle("hidden", !countdown);
}

function refreshSystemClock() {
  renderTermStatus();
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (minuteKey !== lastClockMinute) {
    lastClockMinute = minuteKey;
    renderDayTimeline();
    if (activeView === "month") renderMonthView();
    if (activeView === "week") {
      if (document.getElementById("weekNowLine")) positionWeekNowLine();
      else renderWeekGrid();
    }
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
  return `<article class="course-card" style="--course-color:${escapeHtml(session.color || DEFAULT_COLOR)}">
    <div class="course-accent"></div>
    <div class="course-content">
      <div class="course-topline"><span class="course-code">${escapeHtml(session.code || "自定义课程")}</span>${status ? `<span class="status-pill">${status}</span>` : ""}</div>
      <h3><span class="course-dot" aria-hidden="true"></span>${escapeHtml(session.name)}</h3>
      <div class="detail-row"><span class="detail-icon"><svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg></span><span>${periodTime(session)} · 第${session.periodStart}–${session.periodEnd}节</span></div>
      <div class="detail-row"><span class="detail-icon"><svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg></span><span>${escapeHtml(session.location)}${session.campus ? `<br>${escapeHtml(session.campus)}` : ""}</span></div>
      ${session.teacher ? `<div class="detail-row"><span class="detail-icon"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg></span><span>${escapeHtml(session.teacher)}</span></div>` : ""}
      ${editable ? `<div class="card-actions"><button class="text-button edit-course" data-id="${escapeHtml(session.id)}">修改此安排 →</button></div>` : ""}
    </div>
  </article>`;
}

function dayTimelineBlock(session, rowFor, date) {
  const color = session.color || DEFAULT_COLOR;
  const status = liveStatus(session, date);
  const startRow = rowFor.get(session.periodStart) ?? (rowFor.size + 1);
  const endRow = rowFor.get(session.periodEnd) ?? startRow;
  const span = Math.max(1, endRow - startRow + 1);
  const attendKey = `${localDateKey(date)}|${session.id}`;
  const attendStatus = (state.attendance || {})[attendKey] || "";
  const attendInfo = ATTEND_STATUSES.find((item) => item.key === attendStatus);
  const attendChip = `<span class="attend-chip${attendInfo ? " has" : ""}" data-attend="${escapeHtml(session.id)}" data-date="${escapeHtml(localDateKey(date))}"${attendInfo ? ` style="--attend-color:${attendInfo.color}"` : ""} role="button" aria-label="考勤">${attendInfo ? attendInfo.label : "记"}</span>`;
  return `<button class="day-block edit-course" type="button" data-id="${escapeHtml(session.id)}"
    style="grid-column:2;grid-row:${startRow}/span ${span};--course-color:${escapeHtml(color)};--course-soft:${hexToRgba(color, 0.16)}">
    <span class="day-block-top"><strong>${escapeHtml(session.name)}</strong>${status ? `<span class="status-pill">${status}</span>` : ""}</span>
    <span>${escapeHtml(periodTime(session))}${session.location ? ` · ${escapeHtml(session.location)}` : ""}</span>
    ${span >= 2 && session.teacher ? `<span>${escapeHtml(session.teacher)}</span>` : ""}
    ${attendChip}
  </button>`;
}

function positionDayNowLine() {
  const previous = document.getElementById("dayNowLine");
  if (previous) previous.remove();
  if (!elements.courseList.offsetParent) return;
  const date = dateFor(selectedWeek, selectedDay);
  const today = new Date();
  if (date.toDateString() !== today.toDateString() || !state.periods.length) return;
  const now = today.getHours() * 60 + today.getMinutes();
  const anchors = [];
  for (const cell of [...elements.courseList.querySelectorAll(".day-axis")]) {
    const number = Number(cell.querySelector("strong").textContent);
    const period = state.periods.find((item) => item.number === number);
    if (!period || !period.start || !period.end) continue;
    const [h, m] = period.start.split(":").map(Number);
    const [eh, em] = period.end.split(":").map(Number);
    anchors.push({start: h * 60 + m, end: eh * 60 + em, top: cell.offsetTop, height: cell.offsetHeight});
  }
  if (!anchors.length || now < anchors[0].start - 20 || now > anchors[anchors.length - 1].end + 20) return;
  let top = null;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (now >= anchor.start && now <= anchor.end) {
      top = anchor.top + (now - anchor.start) / (anchor.end - anchor.start || 1) * anchor.height;
      break;
    }
    const next = anchors[index + 1];
    if (next && now > anchor.end && now < next.start) {
      top = anchor.top + anchor.height + (now - anchor.end) / (next.start - anchor.end || 1) * (next.top - (anchor.top + anchor.height));
      break;
    }
  }
  if (top === null) return;
  const line = document.createElement("div");
  line.id = "dayNowLine";
  line.className = "week-now-line day-now-line";
  elements.courseList.appendChild(line);
  line.style.top = top + "px";
}

function renderDayTimeline() {
  const date = dateFor(selectedWeek, selectedDay);
  const today = new Date();
  const actualDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isActualToday = date.toDateString() === actualDate.toDateString();
  const sessions = sessionsForDate(date);
  const periods = weekGridPeriods();
  const rowFor = new Map(periods.map((period, index) => [period.number, index + 1]));
  elements.selectedDateLabel.textContent = `${isActualToday ? "今天" : "课程日期"}：${DAY_NAMES[selectedDay - 1]} · ${formatDate(date, true)}`;
  elements.classCount.textContent = sessions.length
    ? `${sessions.length} 门课 · 共 ${totalPeriods(sessions)} 节`
    : `${isActualToday ? "今天" : "该日"}没有课`;
  const cells = [];
  for (const period of periods) {
    const time = period.start && period.end ? `${period.start}–${period.end}` : "";
    cells.push(`<div class="day-axis" style="grid-row:${rowFor.get(period.number)}"><strong>${period.number}</strong><span>${escapeHtml(time)}</span></div>`);
  }
  for (const session of sessions) {
    cells.push(dayTimelineBlock(session, rowFor, date));
  }
  if (!sessions.length) {
    const beforeClassStart = date < parseLocalDate(state.semester.classStartDate);
    const title = beforeClassStart ? "尚未到实际开课日期" : `${isActualToday ? "今天" : "该日"}没有课程`;
    const detail = beforeClassStart
      ? `实际开课日期为 ${formatDate(parseLocalDate(state.semester.classStartDate), true)}`
      : "可以安心安排阅读、实验或休息。";
    cells.push(`<div class="day-empty" style="grid-column:2;grid-row:1 / ${periods.length + 1}"><div class="empty-state"><strong>${title}</strong><span>${detail}</span></div></div>`);
  }
  elements.courseList.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-attend]");
    if (!chip) return;
    event.stopPropagation();
    const key = `${chip.dataset.date}|${chip.dataset.attend}`;
    const order = ["", ...ATTEND_STATUSES.map((item) => item.key)];
    const current = (state.attendance || {})[key] || "";
    const next = order[(order.indexOf(current) + 1) % order.length];
    if (next) state.attendance = {...(state.attendance || {}), [key]: next};
    else {
      const clone = {...(state.attendance || {})};
      delete clone[key];
      state.attendance = clone;
    }
    const label = (ATTEND_STATUSES.find((item) => item.key === next) || {}).label;
    saveState(next ? `考勤已记录：${label}` : "考勤已清除").then(() => {
      renderDayTimeline();
      renderAttendanceStats();
    }).catch(() => {});
  }, true);
  elements.courseList.className = "day-timeline";
  elements.courseList.style.gridTemplateRows = `repeat(${periods.length}, minmax(52px, auto))`;
  elements.courseList.innerHTML = cells.join("");
  positionDayNowLine();
}

function weekGridPeriods() {
  if (state.periods.length) return [...state.periods].sort((a, b) => a.number - b.number);
  const maxPeriod = state.sessions.reduce((max, item) => Math.max(max, item.periodEnd), 0);
  return Array.from({length: Math.max(maxPeriod, 12)}, (_, index) => ({number: index + 1, start: "", end: ""}));
}

function weekGridOverlapCount(list, session) {
  return list.filter((item) => item !== session
    && item.periodStart <= session.periodEnd && session.periodStart <= item.periodEnd).length;
}

function hexToRgba(hex, alpha) {
  const value = String(hex || DEFAULT_COLOR).replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return `rgba(49,87,164,${alpha})`;
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha})`;
}

function weekGridCard(session, list, rowFor) {
  const color = session.color || DEFAULT_COLOR;
  const row = rowFor.get(session.periodStart) ?? rowFor.size + 1;
  const span = Math.max(1, (rowFor.get(session.periodEnd) ?? row) - row + 1);
  const placement = `grid-column:${session.day + 1};grid-row:${row}/span ${span};`
    + `--course-color:${escapeHtml(color)};--course-soft:${hexToRgba(color, 0.16)}`;
  const overlap = weekGridOverlapCount(list, session) ? " week-card-overlap" : "";
  return `<button class="week-card edit-course${overlap}" type="button" data-id="${escapeHtml(session.id)}" style="${placement}">
    <strong>${escapeHtml(session.name)}</strong>
    ${session.location ? `<span>${escapeHtml(session.location)}</span>` : ""}
  </button>`;
}

function renderWeekGrid() {
  const periods = weekGridPeriods();
  const rowFor = new Map(periods.map((period, index) => [period.number, index + 2]));
  const daySessions = Array.from({length: 7}, (_, index) =>
    state.sessions.filter((item) => item.day === index + 1 && item.weeks.includes(selectedWeek))
      .sort((a, b) => a.periodStart - b.periodStart));
  const collapseWeekend = weekGridFiveDays && !daySessions[5].length && !daySessions[6].length;
  const dayCount = collapseWeekend ? 5 : 7;
  elements.weekGridNumber.textContent = `第 ${selectedWeek} 周`;
  elements.weekGridRange.textContent = `${formatDate(dateFor(selectedWeek, 1))}—${formatDate(dateFor(selectedWeek, 7))}`;
  elements.weekGridPrevious.disabled = selectedWeek <= 1;
  elements.weekGridNext.disabled = selectedWeek >= state.semester.totalWeeks;
  elements.weekGridDays.textContent = dayCount === 5 ? "5天" : "7天";
  const todayKey = localDateKey(new Date());
  const cells = ['<div class="week-grid-corner" aria-hidden="true"></div>'];
  for (let day = 1; day <= dayCount; day += 1) {
    const date = dateFor(selectedWeek, day);
    const today = localDateKey(date) === todayKey ? " today" : "";
    cells.push(`<div class="week-grid-head${today}" style="grid-column:${day + 1};grid-row:1"><span>周${SHORT_DAYS[day - 1]}</span><strong>${date.getDate()}</strong></div>`);
  }
  for (const period of periods) {
    cells.push(`<div class="week-grid-time" style="grid-column:1;grid-row:${rowFor.get(period.number)}"><strong>${period.number}</strong><span>${escapeHtml(period.start || "")}</span></div>`);
  }
  for (let day = 0; day < dayCount; day += 1) {
    for (const session of daySessions[day]) cells.push(weekGridCard(session, daySessions[day], rowFor));
  }
  elements.weekGrid.style.gridTemplateColumns = `30px repeat(${dayCount}, minmax(0, 1fr))`;
  elements.weekGrid.style.gridTemplateRows = `auto repeat(${periods.length}, minmax(48px, auto))`;
  elements.weekGrid.innerHTML = cells.join("");
  elements.weekGridEmpty.classList.toggle("hidden", daySessions.some((list) => list.length));
  weekGridDayCount = dayCount;
  const previousLine = document.getElementById("weekNowLine");
  if (previousLine) previousLine.remove();
  const todayInfo = teachingInfoForDate(new Date());
  if (state.periods.length && todayInfo.week === selectedWeek && todayInfo.day <= dayCount) {
    const line = document.createElement("div");
    line.id = "weekNowLine";
    line.className = "week-now-line";
    const label = document.createElement("span");
    label.className = "week-now-time";
    line.appendChild(label);
    elements.weekGrid.appendChild(line);
    positionWeekNowLine();
  }
}

function nowLineTop() {
  const rows = [...elements.weekGrid.querySelectorAll(".week-grid-time")];
  if (!rows.length) return null;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const anchors = [];
  for (const cell of rows) {
    const number = Number(cell.querySelector("strong").textContent);
    const period = state.periods.find((item) => item.number === number);
    if (!period || !period.start || !period.end) continue;
    const [h, m] = period.start.split(":").map(Number);
    const [eh, em] = period.end.split(":").map(Number);
    anchors.push({start: h * 60 + m, end: eh * 60 + em, top: cell.offsetTop, height: cell.offsetHeight});
  }
  if (!anchors.length) return null;
  if (minutes < anchors[0].start - 20 || minutes > anchors[anchors.length - 1].end + 20) return null;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (minutes >= anchor.start && minutes <= anchor.end) {
      return anchor.top + (minutes - anchor.start) / (anchor.end - anchor.start || 1) * anchor.height;
    }
    const next = anchors[index + 1];
    if (next && minutes > anchor.end && minutes < next.start) {
      const span = next.top - (anchor.top + anchor.height);
      return anchor.top + anchor.height + (minutes - anchor.end) / (next.start - anchor.end || 1) * span;
    }
  }
  return null;
}

function positionWeekNowLine() {
  const line = document.getElementById("weekNowLine");
  if (!line || !elements.weekGrid.offsetParent) return;
  const top = nowLineTop();
  if (top === null) {
    line.remove();
    return;
  }
  line.style.top = top + "px";
  const label = line.querySelector(".week-now-time");
  if (label) {
    const now = new Date();
    label.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
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
    const diaryMark = diaryEntryFor(dateKey)?.mood ? `<span class="month-diary-mark">${DIARY_MOODS[diaryEntryFor(dateKey).mood] || "✍"}</span>` : "";
    return `<button class="month-day ${outside ? "outside-month" : ""} ${dateKey === todayKey ? "today" : ""}" type="button" data-date="${dateKey}" aria-label="${label}">
      <span class="month-day-number">${date.getDate()}</span>
      ${sessions.length ? `<span class="month-course-marker">${sessions.length}</span>` : ""}${diaryMark}
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

function manageGroupKey(session) {
  return `${session.code || ""}|${session.name}`;
}

function renderManageChips() {
  const chips = [`<button class="manage-day-chip${manageFilterDay === 0 ? " active" : ""}" data-day="0" type="button">全部</button>`];
  for (let day = 1; day <= 7; day += 1) {
    chips.push(`<button class="manage-day-chip${manageFilterDay === day ? " active" : ""}" data-day="${day}" type="button">周${SHORT_DAYS[day - 1]}</button>`);
  }
  elements.manageDayChips.innerHTML = chips.join("");
}

function renderManageList() {
  renderSemesterSwitcher();
  const filtered = manageFilterDay
    ? state.sessions.filter((item) => item.day === manageFilterDay)
    : state.sessions;
  const groups = new Map();
  for (const session of filtered) {
    const key = manageGroupKey(session);
    if (!groups.has(key)) groups.set(key, {key, name: session.name, color: session.color || DEFAULT_COLOR, items: []});
    groups.get(key).items.push(session);
  }
  const attendanceSummary = (items) => {
    let recorded = 0;
    let attended = 0;
    for (const session of items) {
      for (const [key, status] of Object.entries(state.attendance || {})) {
        if (!key.endsWith("|" + session.id)) continue;
        recorded += 1;
        if (status === "present" || status === "late") attended += 1;
      }
    }
    return recorded ? ` · 出勤 ${attended}/${recorded}` : "";
  };
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.day - b.day || a.periodStart - b.periodStart || (a.weeks[0] || 0) - (b.weeks[0] || 0));
  }
  renderManageChips();
  if (!groups.size) {
    elements.manageList.innerHTML = manageFilterDay
      ? `<div class="empty-state"><strong>周${SHORT_DAYS[manageFilterDay - 1]}没有课程</strong><span>可以换一个星期查看，或新增课程。</span></div>`
      : '<div class="empty-state"><strong>还没有课程</strong><span>请新增课程，或导入 Excel 课表。</span></div>';
    elements.manageToggleAll.classList.add("hidden");
    return;
  }
  elements.manageToggleAll.classList.remove("hidden");
  elements.manageToggleAll.textContent = filtered.some((item) => !manageExpanded.has(manageGroupKey(item))) ? "全部展开" : "全部收起";
  elements.manageList.innerHTML = [...groups.values()].map((group) => {
    const expanded = manageExpanded.has(group.key);
    return `<section class="manage-group">
      <button class="manage-group-head" type="button" data-group-key="${escapeHtml(group.key)}" aria-expanded="${expanded}">
        <span class="manage-dot" style="--course-color:${escapeHtml(group.color)}"></span>
        <span class="manage-group-name">${escapeHtml(group.name)}</span>
        <span class="manage-count">${group.items.length} 个安排${attendanceSummary(group.items)}</span>
        <span class="manage-caret">${expanded ? "⌄" : "›"}</span>
      </button>
      ${expanded ? `<div class="manage-group-items">${group.items.map((session) => `<button class="manage-item edit-course" data-id="${escapeHtml(session.id)}">
        <div>
          <p>周${SHORT_DAYS[session.day - 1]} 第${session.periodStart}–${session.periodEnd}节 · ${escapeHtml(session.weekLabel || formatWeeks(session.weeks))}</p>
          <p>${[session.teacher, session.location].filter(Boolean).map((part) => escapeHtml(part)).join(" · ") || "未填写地点"}</p>
        </div>
        <span class="edit-mark">编辑</span>
      </button>`).join("")}</div>` : ""}
    </section>`;
  }).join("");
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
  conflictAcknowledge = false;
  elements.formError.textContent = "";
  $("#dialogTitle").textContent = session ? "编辑课程" : "新增课程";
  $("#dialogEyebrow").textContent = session ? "修改上课安排" : "添加上课安排";
  elements.deleteCourse.classList.toggle("hidden", !session);
  const values = session || {
    id: "", name: "", code: "", teacher: "", day: selectedDay, weeks: [selectedWeek],
    periodStart: 1, periodEnd: 2, location: "", campus: state.semester.campus, notes: ""
  };
  for (const name of ["id", "name", "code", "teacher", "day", "periodStart", "periodEnd", "location", "campus", "notes"]) {
    form.elements[name].value = values[name] ?? "";
  }
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
      notes: String(form.get("notes")).trim(), color: previous?.color || DEFAULT_COLOR
    };
    if (!previous && window.CourseExcelImport?.colorFor) {
      session.color = CourseExcelImport.colorFor(session.name || session.code || "课程");
    }
    const conflicts = findConflicts(session);
    if (conflicts.length && !conflictAcknowledge) {
      conflictAcknowledge = true;
      elements.formError.textContent = `该时段与「${conflicts.map((item) => item.name).join("」「")}」重叠，确认无误请再点一次保存`;
      return;
    }
    conflictAcknowledge = false;
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
  state.attendance = Object.fromEntries(Object.entries(state.attendance || {})
    .filter(([key]) => !key.endsWith("|" + id)));
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
      version: 3,
      activeSemesterId: previous.activeSemesterId,
      semesters: previous.semesters,
      semester: {
        ...state.semester, name: imported.title,
        totalWeeks: imported.totalWeeks, sourceFile: file.name,
        campus: imported.sessions.find((item) => item.campus)?.campus || ""
      },
      periods: imported.periods,
      sessions: imported.sessions,
      events: (previous.events || []).filter((item) => item && item.name && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ""))),
      attendance: {}
    };
    if (!Array.isArray(state.semesters) || !state.semesters.length) {
      const id = `sem-${Date.now()}`;
      state.semesters = [{id, semester: state.semester, periods: state.periods, sessions: state.sessions, events: state.events}];
      state.activeSemesterId = id;
    }
    syncActiveSemesterEntry();
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

const THEME_STORAGE_KEY = "course-app-theme";
const THEME_TOASTS = {system: "外观已跟随系统", light: "已切换到浅色模式", dark: "已切换到深色模式"};

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function themeMode() {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function applyTheme() {
  const mode = themeMode();
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = mode === "system" ? "" : mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#101b33" : "#243F7A");
  document.querySelectorAll(".theme-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === mode);
  });
  if (window.CourseAppNative?.setSystemBars) {
    try { JSON.parse(window.CourseAppNative.setSystemBars(dark)); } catch (error) {}
  }
}

function bindThemeControls() {
  document.querySelectorAll(".theme-option").forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.themeChoice || "system";
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    applyTheme();
    showToast(THEME_TOASTS[mode] || "外观已更新");
  }));
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => { if (themeMode() === "system") applyTheme(); };
  if (query.addEventListener) query.addEventListener("change", onSystemChange);
  else if (query.addListener) query.addListener(onSystemChange);
}

function switchView(view) {
  activeView = view;
  elements.scheduleView.classList.toggle("hidden", view !== "schedule");
  elements.weekView.classList.toggle("hidden", view !== "week");
  elements.monthView.classList.toggle("hidden", view !== "month");
  elements.manageView.classList.toggle("hidden", view !== "manage");
  elements.diaryView.classList.toggle("hidden", view !== "diary");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  if (view === "week") renderWeekGrid();
  if (view === "month") renderMonthView();
  if (view === "manage") renderManageList();
  if (view === "diary") renderDiary();
  if (view === "notification") refreshNotificationSettings();
  positionWeekNowLine();
  positionDayNowLine();
  window.scrollTo({top: 0, behavior: "smooth"});
}

function nativeResult(method, ...args) {
  if (!window.CourseAppNative?.[method]) throw new Error("此功能仅支持 Android 应用");
  return JSON.parse(window.CourseAppNative[method](...args));
}

function setPermissionStatus(element, granted, successText, missingText) {
  element.textContent = granted ? successText : missingText;
  element.classList.toggle("ok", granted);
  element.classList.toggle("error", !granted);
}

function refreshNotificationSettings() {
  if (nativePlatform() !== "Android") return;
  try {
    const result = nativeResult("getNotificationSettings");
    if (!result.ok) throw new Error(result.error || "无法读取提醒设置");
    elements.notificationEnabled.checked = Boolean(result.enabled);
    elements.notificationLeadMinutes.value = String(result.leadMinutes);
    elements.notificationShowDetails.checked = Boolean(result.showDetails);
    setPermissionStatus($("#notificationPermissionStatus"), result.notificationGranted,
      "通知权限：已允许", "通知权限：未允许，系统不会显示课程提醒");
    setPermissionStatus($("#exactAlarmStatus"), result.exactAlarmGranted,
      "精确闹钟：已允许", "精确闹钟：未允许，将使用可能延迟的普通提醒");
    $("#openExactAlarmSettings").disabled = Boolean(result.exactAlarmGranted);
  } catch (error) {
    $("#notificationPermissionStatus").textContent = error.message;
    $("#notificationPermissionStatus").classList.add("error");
  }
}

function saveNotificationSettings() {
  try {
    const result = nativeResult("saveNotificationSettings", elements.notificationEnabled.checked,
      Number(elements.notificationLeadMinutes.value), elements.notificationShowDetails.checked);
    if (!result.ok) throw new Error(result.error || "提醒设置保存失败");
    showToast("课程提醒设置已保存");
    if (elements.notificationEnabled.checked) nativeResult("requestNotificationPermission");
    window.setTimeout(refreshNotificationSettings, 300);
  } catch (error) {
    alert(error.message);
  }
}

function requestNotificationPermission() {
  try {
    const result = nativeResult("requestNotificationPermission");
    if (!result.ok) throw new Error(result.error || "无法申请通知权限");
    if (result.openedSettings) showToast("请在系统设置中允许通知");
    else if (!result.requested) showToast("系统通知权限已经允许");
  } catch (error) {
    alert(error.message);
  }
}

function openExactAlarmSettings() {
  const result = nativeResult("openExactAlarmSettings");
  if (!result.ok) alert(result.error || "无法打开精确闹钟设置");
}

function sendTestNotification() {
  const result = nativeResult("sendTestNotification");
  if (!result.ok) return alert(result.error || "测试通知发送失败");
  showToast("测试通知已发送");
}

function openCourseDateFromNotification(value) {
  if (!state || !/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return;
  const date = parseLocalDate(value);
  const difference = Math.floor((date - parseLocalDate(state.semester.weekOneStart)) / 86400000);
  const week = Math.floor(difference / 7) + 1;
  if (week < 1 || week > state.semester.totalWeeks) return;
  selectedWeek = week;
  selectedDay = date.getDay() === 0 ? 7 : date.getDay();
  render();
  switchView("schedule");
}

function applyShortcutTarget(target) {
  if (!state || !target) return;
  if (target === "week") {
    switchView("week");
  } else if (target === "month") {
    switchView("month");
  } else if (target === "add") {
    switchView("manage");
    openEditor();
  } else if (target === "today") {
    const position = teachingPosition();
    selectedWeek = position.week;
    selectedDay = position.day;
    render();
    switchView("schedule");
  }
}

function exportBackup() {
  if (!state) return;
  const payload = {
    app: "course-schedule", version: 3, exportedAt: new Date().toISOString(),
    semester: state.semester, periods: state.periods, sessions: state.sessions,
    events: state.events || [], attendance: state.attendance || {},
    activeSemesterId: state.activeSemesterId, semesters: state.semesters || []
  };
  const json = JSON.stringify(payload, null, 2);
  if (window.CourseAppNative?.exportFile) {
    const result = JSON.parse(window.CourseAppNative.exportFile(toBase64Utf8(json), "application/json",
      `CourseSchedule-backup-${localDateKey(new Date()).replace(/-/g, "")}.json`));
    if (!result.ok) showToast(result.error || "导出失败");
    return;
  }
  const blob = new Blob([json], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `CourseSchedule-backup-${localDateKey(new Date()).replace(/-/g, "")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("备份已生成，请选择保存位置");
}

function validateBackupState(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("备份文件结构不正确");
  const semester = candidate.semester;
  if (!semester || typeof semester.weekOneStart !== "string" || typeof semester.classStartDate !== "string") {
    throw new Error("备份缺少学期信息");
  }
  if (!Array.isArray(candidate.sessions) || candidate.sessions.length > 500) throw new Error("课程数据不合法");
  if (!Array.isArray(candidate.periods)) throw new Error("节次数据不合法");
  const required = ["id", "name", "day", "periodStart", "periodEnd", "weeks", "location"];
  candidate.sessions.forEach((session, index) => {
    if (typeof session !== "object" || !required.every((field) => field in session)) {
      throw new Error(`第 ${index + 1} 条课程数据不完整`);
    }
  });
  const normalized = {
    version: 3,
    semester: {
      name: String(semester.name || "课程表"), weekOneStart: semester.weekOneStart,
      classStartDate: semester.classStartDate, totalWeeks: Number(semester.totalWeeks) || 19,
      campus: String(semester.campus || ""),
      ...(semester.sourceFile ? {sourceFile: semester.sourceFile} : {})
    },
    periods: candidate.periods,
    sessions: candidate.sessions,
    events: Array.isArray(candidate.events) ? candidate.events : [],
    attendance: candidate.attendance && !Array.isArray(candidate.attendance) && typeof candidate.attendance === "object"
      ? candidate.attendance : {}
  };
  if (Array.isArray(candidate.semesters) && candidate.semesters.length) {
    normalized.semesters = candidate.semesters.filter((item) => item && item.id && item.semester);
    normalized.activeSemesterId = candidate.semesters.some((item) => item.id === candidate.activeSemesterId)
      ? candidate.activeSemesterId : normalized.semesters[0].id;
  }
  return normalized;
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const text = file.text ? await file.text() : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取备份文件"));
      reader.readAsText(file);
    });
    const restored = validateBackupState(JSON.parse(text));
    if (!confirm(`备份包含 ${restored.sessions.length} 条课程安排（${restored.semester.name || "未命名"}）。\n导入将替换当前课程，是否继续？`)) return;
    const rollback = state;
    state = restored;
    normalizeStateDates();
    try {
      await saveState("备份已恢复");
    } catch (error) {
      state = rollback;
      throw error;
    }
    elements.weekSelect.innerHTML = "";
    const position = teachingPosition();
    selectedWeek = position.week;
    selectedDay = position.day;
    render();
  } catch (error) {
    showToast(error.message.includes("JSON") ? "备份文件格式不正确" : error.message);
  }
}

window.onNativeBackupResult = function (ok, message) {
  showToast(message || (ok ? "备份已保存" : "备份保存失败"));
};

function renderPeriodsEditor() {
  if (!state) return;
  const periods = [...(state.periods || [])].sort((a, b) => a.number - b.number);
  const rows = periods.map((period) => `<div class="period-row" data-number="${period.number}">
    <span class="period-number">第 ${period.number} 节</span>
    <input type="time" value="${escapeHtml(period.start || "")}" data-field="start" aria-label="第 ${period.number} 节开始时间" />
    <span class="period-sep">–</span>
    <input type="time" value="${escapeHtml(period.end || "")}" data-field="end" aria-label="第 ${period.number} 节结束时间" />
    <button class="period-remove" type="button" data-remove="${period.number}" aria-label="删除第 ${period.number} 节">×</button>
  </div>`).join("");
  elements.periodEditor.innerHTML = (rows || '<p class="editor-empty">尚未设置节次时间，导入课表可自动带出。</p>')
    + '<div class="editor-actions"><button class="ai-btn" id="addPeriod" type="button">＋ 添加一节</button><button class="ai-btn primary" id="savePeriods" type="button">保存节次时间</button></div>';
}

function renderEventsEditor() {
  if (!state) return;
  const events = [...(state.events || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rows = events.map((event) => `<div class="period-row" data-event="${escapeHtml(event.id)}">
    <span class="period-number">${escapeHtml(event.date)}</span>
    <span class="event-name">${escapeHtml(event.name)}</span>
    <button class="period-remove" type="button" data-remove-event="${escapeHtml(event.id)}" aria-label="删除 ${escapeHtml(event.name)}">×</button>
  </div>`).join("");
  elements.eventEditor.innerHTML = (rows || '<p class="editor-empty">还没有倒计时事件，添加后会在日课表顶部显示。</p>')
    + '<div class="event-add-row"><input id="eventName" maxlength="30" placeholder="名称，如 期末考" /><input id="eventDate" type="date" aria-label="事件日期" /><button class="ai-btn primary" id="addEvent" type="button">添加</button></div>';
}

function refreshSettingsEditors() {
  if (!manageSettingsOpen) return;
  if (!elements.periodEditor.contains(document.activeElement)) renderPeriodsEditor();
  if (!elements.eventEditor.contains(document.activeElement)) renderEventsEditor();
  renderAttendanceStats();
}

function renderAttendanceStats() {
  if (!state) return;
  const records = Object.entries(state.attendance || {});
  if (!records.length) {
    elements.attendanceStats.innerHTML = "";
    return;
  }
  const counts = {present: 0, late: 0, leave: 0, absent: 0};
  for (const [, status] of records) {
    if (counts[status] !== undefined) counts[status] += 1;
  }
  elements.attendanceStats.innerHTML = `<p class="editor-title">考勤</p>`
    + `<p class="editor-empty">已记录 ${records.length} 节：到课 ${counts.present} · 迟到 ${counts.late} · 请假 ${counts.leave} · 旷课 ${counts.absent}</p>`;
}

window.onNativeBackupResult = function (ok, message) {
  showToast(message || (ok ? "备份已保存" : "备份保存失败"));
};

function findConflicts(session) {
  return state.sessions.filter((item) => item.id !== session.id
    && item.day === session.day
    && item.weeks.some((week) => session.weeks.includes(week))
    && item.periodStart <= session.periodEnd && session.periodStart <= item.periodEnd);
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function icsEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsFold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 74) return line;
  let out = "";
  let current = "";
  for (const char of line) {
    if (encoder.encode(current + char).length > 72) {
      out += current + "\r\n ";
      current = "";
    }
    current += char;
  }
  return out + current;
}

function icsWeekRuns(weeks) {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const runs = [];
  for (const week of sorted) {
    const last = runs[runs.length - 1];
    const step = last ? week - last.last : 0;
    if (last && (last.step === null || step === last.step) && (step === 1 || step === 2)) {
      if (last.step === null) last.step = step;
      last.last = week;
      last.weeks.push(week);
    } else {
      runs.push({first: week, last: week, step: null, weeks: [week]});
    }
  }
  return runs.map((run) => ({first: run.first, count: run.weeks.length, step: run.step || 1}));
}

function stampUTC() {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}Z`;
}

function buildIcs() {
  if (!state.sessions.length) throw new Error("当前学期没有课程");
  const pad2 = (value) => String(value).padStart(2, "0");
  const byDay = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const weekOne = parseLocalDate(state.semester.weekOneStart);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CourseSchedule//CN", "CALSCALE:GREGORIAN"];
  let eventCount = 0;
  let skipped = 0;
  for (const session of state.sessions) {
    const startTime = (state.periods.find((p) => p.number === session.periodStart) || {}).start || "";
    const endTime = (state.periods.find((p) => p.number === session.periodEnd) || {}).end || "";
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
      skipped += 1;
      continue;
    }
    for (const run of icsWeekRuns(session.weeks || [])) {
      const firstDate = addDays(weekOne, (run.first - 1) * 7 + session.day - 1);
      const compact = (date) => `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${session.id}-${run.first}@courseapp.local`);
      lines.push(`DTSTAMP:${stampUTC()}`);
      lines.push(`DTSTART:${compact(firstDate)}T${startTime.replace(":", "")}00`);
      lines.push(`DTEND:${compact(firstDate)}T${endTime.replace(":", "")}00`);
      if (run.count > 1) lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${byDay[session.day]};INTERVAL=${run.step};COUNT=${run.count}`);
      lines.push(`SUMMARY:${icsEscape(session.name)}`);
      if (session.location) lines.push(`LOCATION:${icsEscape(session.location)}`);
      const description = [session.teacher ? `教师：${session.teacher}` : "", session.weekLabel || formatWeeks(session.weeks)]
        .filter(Boolean).join("；");
      if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
      lines.push("END:VEVENT");
      eventCount += 1;
    }
  }
  lines.push("END:VCALENDAR");
  return {content: lines.map(icsFold).join("\r\n"), eventCount, skipped};
}

function exportIcs() {
  let result;
  try {
    result = buildIcs();
  } catch (error) {
    return showToast(error.message);
  }
  showToast(`已生成 ${result.eventCount} 个日历事件${result.skipped ? `（跳过 ${result.skipped} 条无时间课程）` : ""}`);
  const base64 = toBase64Utf8(result.content);
  if (window.CourseAppNative?.exportFile) {
    const saved = JSON.parse(window.CourseAppNative.exportFile(base64, "text/calendar", "CourseSchedule.ics"));
    if (!saved.ok) showToast(saved.error || "导出失败");
    return;
  }
  const blob = new Blob([result.content], {type: "text/calendar;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "CourseSchedule.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let current = "";
  for (const char of String(text)) {
    if (current && ctx.measureText(current + char).width > maxWidth) {
      lines.push(current);
      current = char;
      if (lines.length === maxLines) return lines;
    } else {
      current += char;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function drawWeekImage() {
  const periods = weekGridPeriods();
  const scale = 2;
  const pad = 24;
  const timeCol = 56;
  const colWidth = 128;
  const header = 56;
  const rowHeight = 96;
  const titleHeight = 64;
  const width = pad * 2 + timeCol + colWidth * 7;
  const height = pad * 2 + titleHeight + header + periods.length * rowHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#eaf0ff");
  background.addColorStop(1, "#eef7f5");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#18233f";
  ctx.font = "700 22px 'Microsoft YaHei', sans-serif";
  ctx.fillText(state.semester.name || "课程表", pad, pad + 26);
  ctx.fillStyle = "#65738d";
  ctx.font = "500 13px 'Microsoft YaHei', sans-serif";
  ctx.fillText(`第 ${selectedWeek} 教学周 · ${formatDate(dateFor(selectedWeek, 1))} — ${formatDate(dateFor(selectedWeek, 7))}`, pad, pad + 48);

  const gridTop = pad + titleHeight;
  const today = new Date();
  const todayInfo = teachingInfoForDate(today);
  for (let day = 1; day <= 7; day += 1) {
    const date = dateFor(selectedWeek, day);
    const x = pad + timeCol + (day - 1) * colWidth;
    ctx.fillStyle = todayInfo.day === day && todayInfo.week === selectedWeek ? "#31549c" : "rgba(255,255,255,.85)";
    roundRectPath(ctx, x + 2, gridTop + 2, colWidth - 4, header - 8, 8);
    ctx.fill();
    ctx.fillStyle = todayInfo.day === day && todayInfo.week === selectedWeek ? "#ffffff" : "#18233f";
    ctx.font = "800 14px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`周${SHORT_DAYS[day - 1]}`, x + colWidth / 2, gridTop + 22);
    ctx.font = "700 15px 'Microsoft YaHei', sans-serif";
    ctx.fillText(`${date.getMonth() + 1}/${date.getDate()}`, x + colWidth / 2, gridTop + 42);
    ctx.textAlign = "left";
  }

  const rowsTop = gridTop + header;
  ctx.strokeStyle = "rgba(49,84,156,.18)";
  ctx.lineWidth = 1;
  for (let index = 0; index <= periods.length; index += 1) {
    const y = rowsTop + index * rowHeight;
    ctx.beginPath();
    ctx.moveTo(pad + timeCol, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }
  for (let day = 0; day <= 7; day += 1) {
    const x = pad + timeCol + day * colWidth;
    ctx.beginPath();
    ctx.moveTo(x, rowsTop);
    ctx.lineTo(x, rowsTop + periods.length * rowHeight);
    ctx.stroke();
  }

  for (const period of periods) {
    const y = rowsTop + (period.number - 1) * rowHeight;
    ctx.fillStyle = "#18233f";
    ctx.font = "800 13px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${period.number}`, pad + timeCol / 2, y + 34);
    ctx.fillStyle = "#65738d";
    ctx.font = "500 10px 'Microsoft YaHei', sans-serif";
    if (period.start && period.end) {
      ctx.fillText(period.start, pad + timeCol / 2, y + 52);
      ctx.fillText(period.end, pad + timeCol / 2, y + 66);
    }
    ctx.textAlign = "left";
  }

  for (const session of state.sessions.filter((item) => (item.weeks || []).includes(selectedWeek))) {
    const x = pad + timeCol + (session.day - 1) * colWidth + 4;
    const y = rowsTop + (session.periodStart - 1) * rowHeight + 4;
    const blockWidth = colWidth - 8;
    const blockHeight = (session.periodEnd - session.periodStart + 1) * rowHeight - 8;
    const color = session.color || DEFAULT_COLOR;
    ctx.fillStyle = hexToRgba(color, 0.14);
    roundRectPath(ctx, x, y, blockWidth, blockHeight, 10);
    ctx.fill();
    ctx.fillStyle = color;
    roundRectPath(ctx, x, y, 4, blockHeight, 2);
    ctx.fill();
    ctx.fillStyle = "#18233f";
    ctx.font = "700 13px 'Microsoft YaHei', sans-serif";
    const nameLines = wrapCanvasText(ctx, session.name, blockWidth - 16, 3);
    nameLines.forEach((line, index) => ctx.fillText(line, x + 10, y + 22 + index * 18));
    let textY = y + 24 + nameLines.length * 18;
    ctx.fillStyle = "#53656f";
    ctx.font = "500 11px 'Microsoft YaHei', sans-serif";
    const locationLines = session.location ? wrapCanvasText(ctx, session.location, blockWidth - 16, blockHeight > 120 ? 2 : 1) : [];
    locationLines.forEach((line, index) => ctx.fillText(line, x + 10, textY + index * 15));
    textY += locationLines.length * 15;
    if (session.teacher && blockHeight > 150) {
      ctx.fillText(session.teacher, x + 10, textY + 2);
    }
  }

  ctx.fillStyle = "#65738d";
  ctx.font = "500 10px 'Microsoft YaHei', sans-serif";
  ctx.fillText("由 本地课程表 生成", pad, height - 8);
  return canvas;
}

async function exportWeekImage() {
  const canvas = drawWeekImage();
  if (window.CourseAppNative?.exportFile) {
    const result = JSON.parse(window.CourseAppNative.exportFile(canvas.toDataURL("image/png").split(",")[1], "image/png", `CourseSchedule-第${selectedWeek}周.png`));
    if (!result.ok) showToast(result.error || "导出失败");
    return;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `CourseSchedule-第${selectedWeek}周.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("周课表图片已生成");
}

const DIARY_MOODS = ["", "😄", "🙂", "😐", "😔", "😖"];
const ATTEND_STATUSES = [
  {key: "present", label: "到课", color: "#2f6c54"},
  {key: "late", label: "迟到", color: "#b07d2b"},
  {key: "leave", label: "请假", color: "#31549c"},
  {key: "absent", label: "旷课", color: "#a53d31"}
];
const DIARY_PIN_KEY = "course-app-diary-pin";
const DIARY_LOCK_KEY = "course-app-diary-lock";
let diaryState = {
  selectedDate: localDateKey(new Date()), month: new Date(),
  mood: 0, search: "", unlocked: false, cardMode: "hidden"
};

function diaryEntryFor(dateKey) {
  return (state.diaries || []).find((item) => item.date === dateKey) || null;
}

function isDiaryLocked() {
  return Boolean(localStorage.getItem(DIARY_PIN_KEY)) && !diaryState.unlocked;
}

async function diaryPinHash(pin, salt) {
  const text = salt + ":" + pin;
  try {
    if (window.crypto?.subtle) {
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch (error) { /* 非安全上下文退回轻量散列 */ }
  let hash = 5381;
  for (const char of text) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return "djb2-" + hash.toString(16);
}

function renderDiary() {
  if (!state) return;
  const pinEnabled = Boolean(localStorage.getItem(DIARY_PIN_KEY));
  const locked = isDiaryLocked();
  const showCard = locked || (!pinEnabled && diaryState.cardMode === "setup");
  elements.diaryLockCard.classList.toggle("hidden", !showCard);
  elements.diaryContent.classList.toggle("hidden", locked);
  if (showCard) {
    elements.diaryLockTitle.textContent = locked ? "日记已锁定" : "设置日记锁";
    elements.diaryUnlock.textContent = locked ? "解锁" : "启用日记锁";
    if (!locked) elements.diaryPinStatus.textContent = "设置 4 位数字 PIN，仅锁住日记视图";
  }
  if (locked) return;
  renderDiaryCalendar();
  loadDiaryEntry();
  renderDiarySearchResults();
}

function renderDiaryCalendar() {
  const year = diaryState.month.getFullYear();
  const month = diaryState.month.getMonth();
  elements.diaryMonthLabel.textContent = `${year}年${month + 1}月`;
  elements.diaryCalendar.innerHTML = monthGridDates(year, month).map((date) => {
    const key = localDateKey(date);
    const entry = diaryEntryFor(key);
    const outside = date.getMonth() !== month ? " outside-month" : "";
    const selected = key === diaryState.selectedDate ? " selected" : "";
    const mood = entry && entry.mood ? `<span class="diary-mood">${DIARY_MOODS[entry.mood] || "✍"}</span>` : "";
    return `<button class="diary-day${selected}${outside}" type="button" data-date="${key}"><span>${date.getDate()}</span>${mood}</button>`;
  }).join("");
}

function loadDiaryEntry() {
  const key = diaryState.selectedDate;
  const entry = diaryEntryFor(key);
  const date = parseLocalDate(key);
  const position = teachingPosition();
  elements.diaryDateLabel.textContent = `${key} ${DAY_NAMES[date.getDay() === 0 ? 6 : date.getDay() - 1]}`
    + (position.phase === "in" ? ` · 第 ${position.week} 教学周` : "");
  elements.diaryTitle.value = entry?.title || "";
  elements.diaryText.value = entry?.text || "";
  diaryState.mood = entry?.mood || 0;
  [...elements.diaryMood.children].forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.mood) === diaryState.mood);
  });
  elements.diaryDelete.classList.toggle("hidden", !entry);
}

function renderDiarySearchResults() {
  const query = diaryState.search.trim().toLowerCase();
  if (!query) {
    elements.diarySearchResults.innerHTML = "";
    return;
  }
  const matches = (state.diaries || [])
    .filter((item) => `${item.title || ""}${item.text || ""}`.toLowerCase().includes(query))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
  elements.diarySearchResults.innerHTML = matches.length
    ? matches.map((item) => `<button class="diary-result" type="button" data-date="${escapeHtml(item.date)}"><strong>${escapeHtml(item.date)}${item.title ? " · " + escapeHtml(item.title) : ""}</strong><span>${escapeHtml(String(item.text || "").replace(/\s+/g, " ").slice(0, 50))}</span></button>`).join("")
    : '<p class="editor-empty">没有匹配的日记</p>';
}

function saveDiary() {
  const key = diaryState.selectedDate;
  const title = elements.diaryTitle.value.trim();
  const text = elements.diaryText.value;
  const mood = diaryState.mood;
  const existing = diaryEntryFor(key);
  if (!mood && !title && !text.trim()) return showToast("选择心情或写点什么再保存");
  if (existing) {
    existing.title = title;
    existing.text = text;
    existing.mood = mood;
    existing.updatedAt = Date.now();
  } else {
    if ((state.diaries || []).length >= 2000) return showToast("日记已达 2000 篇上限");
    state.diaries = [...(state.diaries || []), {id: `diary-${Date.now()}`, date: key, mood, title, text, updatedAt: Date.now()}];
  }
  saveState("日记已保存").then(() => {
    loadDiaryEntry();
    renderDiaryCalendar();
  }).catch(() => {});
}

function deleteDiary() {
  const key = diaryState.selectedDate;
  if (!diaryEntryFor(key)) return;
  if (!confirm(`删除 ${key} 的日记？此操作不可恢复。`)) return;
  state.diaries = (state.diaries || []).filter((item) => item.date !== key);
  saveState("日记已删除").then(() => {
    loadDiaryEntry();
    renderDiaryCalendar();
  }).catch(() => {});
}

function quoteTodayCourses() {
  const sessions = sessionsForDate(parseLocalDate(diaryState.selectedDate));
  if (!sessions.length) return showToast("当天没有课程");
  const lines = sessions.map((session) =>
    `· ${periodTime(session)} ${session.name}${session.location ? ` @${session.location}` : ""}`);
  elements.diaryText.value = `今天的课：\n${lines.join("\n")}\n\n` + elements.diaryText.value;
}

window.onNativeShortcut = applyShortcutTarget;

window.onNativeNotificationSettingsChanged = refreshNotificationSettings;
window.onNativeNotificationOpen = openCourseDateFromNotification;

async function showInfo() {
  elements.infoDialog.showModal();
  if (window.CourseAppNative?.loadState) {
    const platform = nativePlatform();
    $("#infoLead").textContent = "课程查看、编辑和 Excel 导入均在本机完成，不需要连接电脑。";
    $("#infoNote").textContent = platform === "iOS"
      ? "仅在你主动检查更新时连接 GitHub。iOS 开发构建需要使用你自己的苹果签名后才能侧载；卸载应用会清除本机课程修改。"
      : "启动时会连接 GitHub 检查新版，也可手动检查；只有确认下载后才会获取 APK。正常覆盖安装会保留本机课程修改；卸载应用会清除数据。";
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

function showUsageNoticeIfNeeded() {
  if (localStorage.getItem(USAGE_NOTICE_STORAGE_KEY) === USAGE_NOTICE_VERSION) return Promise.resolve();
  elements.usageNoticeDialog.showModal();
  return new Promise((resolve) => { resolveNoticeAcceptance = resolve; });
}

function acceptUsageNotice() {
  localStorage.setItem(USAGE_NOTICE_STORAGE_KEY, USAGE_NOTICE_VERSION);
  elements.usageNoticeDialog.close();
  resolveNoticeAcceptance?.();
  resolveNoticeAcceptance = undefined;
}

function showStartupUpdate(result) {
  if (localStorage.getItem(IGNORED_UPDATE_STORAGE_KEY) === result.latestVersion) return;
  availableUpdateVersion = result.latestVersion;
  $("#startupUpdateVersions").textContent = `当前版本 ${result.currentVersion}，最新版本 ${result.latestVersion}`;
  $("#startupUpdateDate").textContent = result.publishedAt
    ? `发布时间：${new Date(result.publishedAt).toLocaleDateString("zh-CN")}`
    : "";
  $("#startupUpdateNotes").textContent = String(result.releaseNotes || "此版本包含功能改进和问题修复。可前往 GitHub Release 查看完整说明。").trim().slice(0, 2000);
  $("#installStartupUpdate").disabled = false;
  elements.startupUpdateDialog.showModal();
}

async function runStartupPrompts() {
  await showUsageNoticeIfNeeded();
  if (nativePlatform() === "Android" && window.CourseAppNative?.checkForUpdate) checkForUpdate(true);
}

window.onNativeUpdateCheck = function (payload) {
  const result = JSON.parse(payload);
  const mode = updateCheckMode;
  updateCheckMode = "manual";
  const status = $("#updateStatus");
  const downloadButton = $("#downloadUpdate");
  $("#checkUpdate").disabled = false;
  availableUpdateUrl = "";
  availableUpdateVersion = "";
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
  availableUpdateVersion = result.latestVersion;
  status.textContent = `发现新版本 ${result.latestVersion}`;
  downloadButton.textContent = platform === "iOS" ? "打开安装文件" : "下载并安装";
  downloadButton.classList.remove("hidden");
  if (mode === "startup" && platform === "Android") showStartupUpdate(result);
};

window.onNativeUpdateStatus = function (message, isError) {
  $("#updateStatus").textContent = message;
  if (isError) {
    $("#downloadUpdate").disabled = false;
    $("#installStartupUpdate").disabled = false;
  }
};

function checkForUpdate(automatic = false) {
  if (!window.CourseAppNative?.checkForUpdate) return;
  updateCheckMode = automatic ? "startup" : "manual";
  $("#checkUpdate").disabled = true;
  if (!automatic) $("#updateStatus").textContent = "正在连接 GitHub 检查…";
  window.CourseAppNative.checkForUpdate();
}

function downloadUpdate() {
  if (!availableUpdateUrl || !window.CourseAppNative?.downloadUpdate) return;
  $("#downloadUpdate").disabled = true;
  $("#installStartupUpdate").disabled = true;
  window.CourseAppNative.downloadUpdate(availableUpdateUrl);
}

function bindEvents() {
  elements.previousWeek.addEventListener("click", () => { selectedWeek = Math.max(1, selectedWeek - 1); render(); });
  elements.nextWeek.addEventListener("click", () => { selectedWeek = Math.min(state.semester.totalWeeks, selectedWeek + 1); render(); });
  elements.weekGridPrevious.addEventListener("click", () => { selectedWeek = Math.max(1, selectedWeek - 1); render(); });
  elements.weekGridNext.addEventListener("click", () => { selectedWeek = Math.min(state.semester.totalWeeks, selectedWeek + 1); render(); });
  elements.weekGridToday.addEventListener("click", () => { const position = teachingPosition(); selectedWeek = position.week; selectedDay = position.day; render(); });
  elements.weekGridDays.addEventListener("click", () => {
    weekGridFiveDays = !weekGridFiveDays;
    localStorage.setItem("course-app-week-days", weekGridFiveDays ? "5" : "7");
    renderWeekGrid();
  });
  elements.weekSelect.addEventListener("change", () => { selectedWeek = Number(elements.weekSelect.value); render(); });
  elements.todayButton.addEventListener("click", () => { const position = teachingPosition(); selectedWeek = position.week; selectedDay = position.day; render(); });
  elements.dayStrip.addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    selectedDay = Number(button.dataset.day); renderDays(); renderDayTimeline();
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
  });
  elements.manageList.addEventListener("click", (event) => {
    const head = event.target.closest("[data-group-key]");
    if (!head) return;
    const key = head.dataset.groupKey;
    if (manageExpanded.has(key)) manageExpanded.delete(key); else manageExpanded.add(key);
    renderManageList();
    const rendered = elements.manageList.querySelector(`[data-group-key="${CSS.escape(key)}"]`);
    rendered?.scrollIntoView({block: "nearest", behavior: "smooth"});
  });
  elements.manageSettingsToggle.addEventListener("click", () => {
    manageSettingsOpen = !manageSettingsOpen;
    elements.manageSettingsToggle.classList.toggle("open", manageSettingsOpen);
    elements.manageSettingsToggle.setAttribute("aria-expanded", String(manageSettingsOpen));
    elements.semesterSettings.classList.toggle("hidden", !manageSettingsOpen);
    if (manageSettingsOpen) {
      refreshSettingsEditors();
      refreshNotificationSettings();
    }
  });
  elements.exportBackupBtn.addEventListener("click", exportBackup);
  elements.exportIcsBtn.addEventListener("click", exportIcs);
  elements.exportWeekImageBtn.addEventListener("click", exportWeekImage);
  elements.diaryLockBtn.addEventListener("click", () => {
    if (!localStorage.getItem(DIARY_PIN_KEY)) {
      diaryState.cardMode = diaryState.cardMode === "setup" ? "hidden" : "setup";
    } else if (diaryState.unlocked) {
      diaryState.unlocked = false;
      localStorage.removeItem(DIARY_LOCK_KEY);
    }
    renderDiary();
  });
  elements.diaryUnlock.addEventListener("click", async () => {
    const pin = elements.diaryPinInput.value;
    if (!/^\d{4}$/.test(pin)) return elements.diaryPinStatus.textContent = "请输入 4 位数字 PIN";
    const stored = JSON.parse(localStorage.getItem(DIARY_PIN_KEY) || "null");
    if (stored) {
      const hash = await diaryPinHash(pin, stored.salt);
      if (hash !== stored.hash) return elements.diaryPinStatus.textContent = "PIN 不正确";
      diaryState.unlocked = true;
      showToast("已解锁");
    } else {
      const salt = Math.random().toString(16).slice(2, 10);
      localStorage.setItem(DIARY_PIN_KEY, JSON.stringify({salt, hash: await diaryPinHash(pin, salt)}));
      diaryState.unlocked = true;
      diaryState.cardMode = "hidden";
      showToast("日记锁已启用");
    }
    elements.diaryPinInput.value = "";
    renderDiary();
  });
  elements.diaryResetPin.addEventListener("click", () => {
    if (!confirm("将清除 PIN 并保持日记可见，确定？")) return;
    localStorage.removeItem(DIARY_PIN_KEY);
    localStorage.removeItem(DIARY_LOCK_KEY);
    diaryState.unlocked = true;
    diaryState.cardMode = "hidden";
    showToast("PIN 已清除");
    renderDiary();
  });
  elements.diarySearch.addEventListener("input", () => {
    diaryState.search = elements.diarySearch.value;
    renderDiarySearchResults();
  });
  elements.diaryCalendar.addEventListener("click", (event) => {
    const day = event.target.closest("[data-date]");
    if (!day) return;
    diaryState.selectedDate = day.dataset.date;
    diaryState.month = parseLocalDate(day.dataset.date);
    renderDiaryCalendar();
    loadDiaryEntry();
  });
  elements.diaryQuoteCourses.addEventListener("click", quoteTodayCourses);
  elements.diaryMood.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mood]");
    if (!button) return;
    diaryState.mood = Number(button.dataset.mood) === diaryState.mood ? 0 : Number(button.dataset.mood);
    [...elements.diaryMood.children].forEach((item) => {
      item.classList.toggle("active", Number(item.dataset.mood) === diaryState.mood);
    });
  });
  elements.diarySave.addEventListener("click", saveDiary);
  elements.diaryDelete.addEventListener("click", deleteDiary);
  elements.diaryPrevMonth.addEventListener("click", () => {
    diaryState.month = new Date(diaryState.month.getFullYear(), diaryState.month.getMonth() - 1, 1);
    renderDiaryCalendar();
  });
  elements.diaryNextMonth.addEventListener("click", () => {
    diaryState.month = new Date(diaryState.month.getFullYear(), diaryState.month.getMonth() + 1, 1);
    renderDiaryCalendar();
  });
  elements.diarySearchResults.addEventListener("click", (event) => {
    const result = event.target.closest("[data-date]");
    if (!result) return;
    diaryState.selectedDate = result.dataset.date;
    diaryState.month = parseLocalDate(result.dataset.date);
    diaryState.search = "";
    elements.diarySearch.value = "";
    renderDiary();
  });
  elements.importBackupBtn.addEventListener("click", () => elements.backupFile.click());
  elements.backupFile.addEventListener("change", () => {
    importBackupFile(elements.backupFile.files[0]).finally(() => { elements.backupFile.value = ""; });
  });
  elements.semesterSelect.addEventListener("change", async () => {
    state.activeSemesterId = elements.semesterSelect.value;
    applyActiveSemester();
    render();
    try { await saveState("已切换学期"); } catch (error) {}
  });
  elements.addSemester.addEventListener("click", async () => {
    if (state.semesters.length >= 20) return showToast("学期数量已达上限（20 个）");
    const name = prompt("新学期名称（如：2026-2027 春季学期）", "新学期");
    if (name === null) return;
    const id = `sem-${Date.now()}`;
    state.semesters.push({
      id,
      semester: {name: name.trim() || "新学期", weekOneStart: "2026-08-31", classStartDate: "2026-08-31", totalWeeks: 19, campus: ""},
      periods: [], sessions: [], events: []
    });
    state.activeSemesterId = id;
    applyActiveSemester();
    render();
    try { await saveState("新学期已创建"); } catch (error) {}
  });
  elements.deleteSemester.addEventListener("click", async () => {
    if (state.semesters.length <= 1) return showToast("至少保留一个学期");
    const active = state.semesters.find((item) => item.id === state.activeSemesterId);
    if (!confirm(`确定删除「${active.semester.name || "未命名学期"}」及其 ${active.sessions.length} 条课程吗？此操作不可恢复。`)) return;
    if (!confirm("再次确认：删除后无法找回。")) return;
    state.semesters = state.semesters.filter((item) => item.id !== state.activeSemesterId);
    state.activeSemesterId = state.semesters[0].id;
    applyActiveSemester();
    state.attendance = {};
    render();
    try { await saveState("学期已删除"); } catch (error) {}
  });
  elements.periodEditor.addEventListener("click", (event) => {
    if (event.target.closest("#addPeriod")) {
      const used = new Set((state.periods || []).map((item) => item.number));
      let number = 1;
      while (used.has(number) && number <= 13) number += 1;
      if (number > 13) return showToast("节次最多到第 13 节");
      state.periods = [...(state.periods || []), {number, start: "", end: ""}].sort((a, b) => a.number - b.number);
      renderPeriodsEditor();
      return;
    }
    if (event.target.closest("#savePeriods")) {
      saveState("节次时间已保存").then(() => render()).catch(() => {});
      return;
    }
    const remove = event.target.closest("[data-remove]");
    if (remove) {
      state.periods = (state.periods || []).filter((item) => item.number !== Number(remove.dataset.remove));
      renderPeriodsEditor();
    }
  });
  elements.periodEditor.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    const row = input.closest("[data-number]");
    if (!row) return;
    const number = Number(row.dataset.number);
    state.periods = (state.periods || []).map((item) => item.number === number
      ? {...item, [input.dataset.field]: input.value} : item);
  });
  elements.eventEditor.addEventListener("click", (event) => {
    if (event.target.closest("#addEvent")) {
      const name = document.getElementById("eventName").value.trim();
      const date = document.getElementById("eventDate").value;
      if (!name) return showToast("请填写事件名称");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast("请选择事件日期");
      const events = state.events || [];
      if (events.length >= 10) return showToast("倒计时事件最多 10 个");
      events.push({id: `evt-${Date.now()}`, name, date});
      state.events = events;
      renderEventsEditor();
      renderTermStatus();
      saveState("倒计时已添加").catch(() => {});
      return;
    }
    const remove = event.target.closest("[data-remove-event]");
    if (remove) {
      state.events = (state.events || []).filter((item) => item.id !== remove.dataset.removeEvent);
      renderEventsEditor();
      renderTermStatus();
      saveState("倒计时已删除").catch(() => {});
    }
  });
  elements.manageDayChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-day]");
    if (!chip) return;
    manageFilterDay = Number(chip.dataset.day) || 0;
    renderManageList();
  });
  elements.manageToggleAll.addEventListener("click", () => {
    const keys = new Set(state.sessions.map(manageGroupKey));
    const anyCollapsed = [...keys].some((key) => !manageExpanded.has(key));
    if (anyCollapsed) state.sessions.forEach((item) => manageExpanded.add(manageGroupKey(item)));
    else keys.forEach((key) => manageExpanded.delete(key));
    renderManageList();
  });
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#addCourse").addEventListener("click", () => openEditor());
  $("#importExcel").addEventListener("click", () => elements.excelFile.click());
  elements.excelFile.addEventListener("change", () => importExcel(elements.excelFile.files[0]));
  $("#saveTeachingDates").addEventListener("click", saveTeachingDates);
  $("#saveNotificationSettings").addEventListener("click", saveNotificationSettings);
  $("#requestNotificationPermission").addEventListener("click", requestNotificationPermission);
  $("#openExactAlarmSettings").addEventListener("click", openExactAlarmSettings);
  $("#sendTestNotification").addEventListener("click", sendTestNotification);
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
  $("#checkUpdate").addEventListener("click", () => checkForUpdate());
  $("#downloadUpdate").addEventListener("click", downloadUpdate);
  $("#acceptUsageNotice").addEventListener("click", acceptUsageNotice);
  elements.usageNoticeDialog.addEventListener("cancel", (event) => event.preventDefault());
  $("#laterStartupUpdate").addEventListener("click", () => elements.startupUpdateDialog.close());
  $("#ignoreStartupUpdate").addEventListener("click", () => {
    if (availableUpdateVersion) localStorage.setItem(IGNORED_UPDATE_STORAGE_KEY, availableUpdateVersion);
    elements.startupUpdateDialog.close();
  });
  $("#installStartupUpdate").addEventListener("click", () => {
    elements.startupUpdateDialog.close();
    downloadUpdate();
  });
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
  normalizeState();
  const position = teachingPosition();
  selectedWeek = position.week;
  selectedDay = position.day;
  bindEvents();
  bindThemeControls();
  applyTheme();
  if (nativePlatform() === "Android" && window.CourseAppNative?.getNotificationSettings) {
    document.querySelectorAll(".android-only").forEach((item) => item.classList.remove("hidden"));
  }
  render();
  refreshSystemClock();
  setInterval(refreshSystemClock, 1000);
  window.__courseAppReady = true;
  if (window.CourseAppNative?.getLaunchCourseDate) openCourseDateFromNotification(window.CourseAppNative.getLaunchCourseDate());
  if (window.CourseAppNative?.getLaunchShortcut) applyShortcutTarget(window.CourseAppNative.getLaunchShortcut());
  runStartupPrompts();
  if (!window.CourseAppNative && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initialize();
