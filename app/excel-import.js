(function (root) {
  "use strict";

  const DAY_PATTERN = /星期([一二三四五六日天])/;
  const DAY_NUMBER = {一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7};
  const COURSE_HEADING = /([A-Za-z0-9_-]*)【\*?([^】]+)】/g;
  const TIME_PATTERN = /^(\d{1,2}:\d{2})\s*[-—–~至]\s*(\d{1,2}:\d{2})$/;
  const COLORS = ["#3157A4", "#A94E3C", "#347A6A", "#9A6A23", "#774DA3", "#B45F72", "#2B738D", "#C05A35"];

  function findHeader(rows) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const periodColumn = row.findIndex((value) => String(value).trim() === "节次");
      if (periodColumn < 0) continue;
      const days = [];
      row.forEach((value, column) => {
        const match = String(value).match(DAY_PATTERN);
        if (match) days.push({column, day: DAY_NUMBER[match[1]]});
      });
      if (days.length) return {rowIndex, periodColumn, days};
    }
    throw new Error("未找到包含“节次”和“星期一”等列名的课表表头");
  }

  function splitCourseBlocks(cell) {
    const text = String(cell || "").replace(/\r/g, "").trim();
    const headings = [...text.matchAll(COURSE_HEADING)];
    return headings.map((heading, index) => ({
      code: heading[1].trim(),
      name: heading[2].trim(),
      body: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim()
    }));
  }

  function parseEntry(line, parseWeeks) {
    const fields = line.trim().split(/\s{2,}/).filter(Boolean);
    if (fields.length < 5 || !TIME_PATTERN.test(fields.at(-1))) return null;
    const weekLabel = fields[0];
    const weeks = parseWeeks(weekLabel);
    const time = fields.at(-1).match(TIME_PATTERN);
    return {
      weeks, weekLabel, teacher: fields[1], location: fields[2],
      campus: fields.slice(3, -1).join(" "), start: time[1], end: time[2]
    };
  }

  function colorFor(value) {
    let hash = 0;
    for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  }

  function parseWorksheet(worksheet, XLSX, parseWeeks, fileName) {
    const rows = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: "", raw: false});
    const header = findHeader(rows);
    const occurrences = [];
    const periodMap = new Map();

    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const period = Number(String(row[header.periodColumn]).trim());
      if (!Number.isInteger(period) || period < 1 || period > 30) continue;
      if (!periodMap.has(period)) periodMap.set(period, {number: period, start: "", end: ""});
      for (const {column, day} of header.days) {
        for (const course of splitCourseBlocks(row[column])) {
          for (const line of course.body.split("\n")) {
            const entry = parseEntry(line, parseWeeks);
            if (!entry) continue;
            if (!periodMap.get(period).start) {
              periodMap.set(period, {number: period, start: entry.start, end: entry.end});
            }
            occurrences.push({...course, ...entry, day, period});
          }
        }
      }
    }
    if (!occurrences.length) throw new Error("没有识别到课程。请确认表格使用“课程名 + 周次、教师、地点、校区、时间”的学校课表格式");

    const groups = new Map();
    for (const item of occurrences) {
      const key = [item.code, item.name, item.teacher, item.day, item.weeks.join(","), item.location, item.campus].join("|");
      if (!groups.has(key)) groups.set(key, {...item, periods: []});
      groups.get(key).periods.push(item.period);
    }

    const sessions = [];
    for (const group of groups.values()) {
      const periods = [...new Set(group.periods)].sort((a, b) => a - b);
      let start = periods[0];
      for (let index = 1; index <= periods.length; index += 1) {
        if (index < periods.length && periods[index] === periods[index - 1] + 1) continue;
        sessions.push({
          id: "imported", code: group.code, name: group.name, teacher: group.teacher, day: group.day,
          periodStart: start, periodEnd: periods[index - 1], weeks: group.weeks, weekLabel: group.weekLabel,
          location: group.location, campus: group.campus, notes: `从 ${fileName} 导入`, color: colorFor(group.code || group.name)
        });
        start = periods[index];
      }
    }
    sessions.sort((a, b) => a.day - b.day || a.periodStart - b.periodStart || a.name.localeCompare(b.name, "zh-CN"));
    sessions.forEach((session, index) => { session.id = `import-${Date.now()}-${index + 1}`; });
    return {
      title: String((rows.slice(0, header.rowIndex).flat().find((value) => String(value).trim()) || "导入课程表")).trim(),
      periods: [...periodMap.values()].sort((a, b) => a.number - b.number),
      sessions,
      totalWeeks: Math.max(...sessions.flatMap((session) => session.weeks))
    };
  }

  root.CourseExcelImport = {parseWorksheet, findHeader, splitCourseBlocks, parseEntry};
  if (typeof module !== "undefined" && module.exports) module.exports = root.CourseExcelImport;
})(typeof window !== "undefined" ? window : globalThis);
