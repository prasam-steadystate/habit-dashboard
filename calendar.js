/* Shared GitHub-style calendar grid: 7 weekday rows, one column per week.
   Used by the dashboard's top tracker and by the trends page. */

const CAL_ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

// Squares shrink as the range grows so a year still fits on screen.
function calCellSize(dayCount) {
  if (dayCount <= 45) return 17;
  if (dayCount <= 120) return 13;
  if (dayCount <= 250) return 10;
  return 8;
}

function calDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday-first weekday index: Mon=0 … Sun=6
function calWeekdayIndex(dateStr) {
  return (new Date(dateStr + "T00:00:00").getDay() + 6) % 7;
}

function calMonthLabel(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short" });
}

/**
 * @param container   element to render into
 * @param dates       ordered 'YYYY-MM-DD' strings
 * @param classForDate (date) => extra css class ('g' | 'y' | 'r' | '')
 * @param opts        { showLabels, showMonths, todayDate }
 */
function buildCalendarGrid(container, dates, classForDate, opts = {}) {
  const { showLabels = false, showMonths = false, todayDate = calDateKey(new Date()) } = opts;

  if (!dates.length) {
    container.innerHTML = "";
    return;
  }

  const size = calCellSize(dates.length);
  const gap = size >= 13 ? 4 : 3;
  const rows = `repeat(7, ${size}px)`;
  const pad = calWeekdayIndex(dates[0]);

  let monthRow = "";
  if (showMonths) {
    // one label per month, positioned at the column where that month starts
    const seen = new Set();
    const marks = [];
    dates.forEach((d, i) => {
      const m = d.slice(0, 7);
      if (seen.has(m)) return;
      seen.add(m);
      marks.push({ col: Math.floor((i + pad) / 7), label: calMonthLabel(d) });
    });
    monthRow = `<div class="cal-months" style="height:${Math.max(11, size - 3)}px">${
      marks.map((m) => `<span style="left:${m.col * (size + gap)}px">${m.label}</span>`).join("")
    }</div>`;
  }

  const labels = showLabels
    ? `<div class="cal-labels" style="grid-template-rows:${rows};gap:${gap}px;font-size:${Math.max(8, size - 5)}px">${
        CAL_ROW_LABELS.map((l) => `<span>${l}</span>`).join("")
      }</div>`
    : "";

  const cells = [];
  for (let i = 0; i < pad; i++) {
    cells.push(`<div class="cal-pad" style="width:${size}px;height:${size}px"></div>`);
  }
  for (const d of dates) {
    const cls = classForDate(d);
    cells.push(
      `<div class="cell cal-cell ${cls}${d === todayDate ? " today" : ""}" title="${d}" style="width:${size}px;height:${size}px"></div>`
    );
  }

  container.innerHTML = `
    <div class="cal-outer">
      ${monthRow}
      <div class="cal-body">
        ${labels}
        <div class="cal-grid" style="grid-template-rows:${rows};gap:${gap}px">${cells.join("")}</div>
      </div>
    </div>`;
}
