const STORAGE_KEY = "arg_crm_kanban_v1";
const SIDEBAR_KEY = "arg_crm_sidebar_collapsed";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const OPPORTUNITY_STAGES = [
  "Lead",
  "Offer Sent",
  "Approved",
  "Countered",
  "Settlement Sent",
  "Settlement Signed",
  "Payment Plan Made",
];

const OPPORTUNITY_STAGE_CONFIDENCE = {
  Lead: 0.2,
  "Offer Sent": 0.35,
  Approved: 0.6,
  Countered: 0.5,
  "Settlement Sent": 0.7,
  "Settlement Signed": 0.85,
  "Payment Plan Made": 1,
};

const STATUS_HEADERS = [
  "SETTLED",
  "Good Faith",
  "Daily",
  "MONDAYS",
  "TUESDAYS",
  "Wednesday",
  "Thursday",
  "Fridays",
  "Bi-Weekly",
  "Monthly",
  "DEFAULTED ACCOUNTS",
  "Forms out- Need Returned",
  "FOLLOW UPS- OFFERS OUT/ IN",
  "NEW ACCOUNTS DAILY FOLLOW UPS - first 14 days",
  "FOLLOW UPS / BKY ACCOUNTS (15-60) (Mon & Thursday)",
  "FOLLOW UPS / BKY ACCOUNTS (60-179) (Tues + Friday)",
  "FOLLOW UPS / BKY ACCOUNTS (180 +) (Wed - Sat)",
];

const DEFAULT_STATUSES = Array.from(new Set(STATUS_HEADERS.concat(["Unsorted"])));

const HEADER_KEY_MAP = {
  merchant: "merchant",
  account: "merchant",
  business: "merchant",
  "business name": "merchant",
  client: "client",
  status: "status",
  "start date": "startDate",
  start: "startDate",
  amount: "amount",
  type: "type",
  frequency: "frequency",
  "increase date": "increaseDate",
  "increase date or fixed until paid": "increaseDate",
  "increase / fixed until paid": "increaseDate",
  increase: "increaseDate",
  notes: "notes",
  "account age": "accountAgeDays",
  "account age days": "accountAgeDays",
  age: "accountAgeDays",
  "account added": "accountAddedDate",
  "account added date": "accountAddedDate",
  "added date": "accountAddedDate",
  "last touched": "lastTouched",
  "last worked": "lastTouched",
  "last contact": "lastTouched",
  "last activity": "lastTouched",
};

const getToday = () => new Date();

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayKey = () => toDateKey(getToday());

const currentMonthKey = () => {
  const now = getToday();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const getMonthDateRange = (monthKey) => {
  const [yearRaw, monthRaw] = String(monthKey || "").split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end, year, month };
};

const formatMoney = (value) => {
  if (Number.isNaN(value) || value === null || value === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
};

const parseMoney = (value) => {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeHeader = (header) => String(header || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (char === '"' && nextChar === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((item) => item.some((cell) => String(cell || "").trim() !== ""));
};

const normalizeFrequency = (value) => {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return "";
  if (normalized.startsWith("daily")) return "Daily";
  if (normalized.startsWith("weekly")) return "Weekly";
  if (normalized.includes("biweekly")) return "Bi-Weekly";
  if (normalized.includes("semimonthly")) return "Semi-Monthly";
  if (normalized.includes("monthly")) return "Monthly";
  if (normalized.includes("lumpsum") || normalized.includes("settle")) return "Lump Sum";
  return raw;
};

const getOpportunityConfidence = (stage) => OPPORTUNITY_STAGE_CONFIDENCE[stage] ?? 0.2;

const buildDate = (year, month, day) => {
  const candidate = new Date(year, month, day);
  if (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month &&
    candidate.getDate() === day
  ) {
    return candidate;
  }
  return null;
};

const parseDayOfMonth = (value) => {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  if (day >= 1 && day <= 31) return day;
  return null;
};

const parseDate = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10) - 1;
    const day = Number.parseInt(isoMatch[3], 10);
    return buildDate(year, month, day);
  }
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const month = Number.parseInt(slashMatch[1], 10) - 1;
    const day = Number.parseInt(slashMatch[2], 10);
    const yearRaw = slashMatch[3];
    const year = yearRaw
      ? Number.parseInt(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw, 10)
      : getToday().getFullYear();
    return buildDate(year, month, day);
  }
  return null;
};

const formatDisplayDate = (date) => {
  if (!date) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
};

const displayDateValue = (value) => {
  if (!value) return "-";
  const parsed = parseDate(value);
  return parsed ? formatDisplayDate(parsed) : value;
};

const toMidnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const diffInDays = (dateA, dateB) => {
  const utcA = toMidnight(dateA);
  const utcB = toMidnight(dateB);
  return Math.round((utcA - utcB) / MS_PER_DAY);
};

const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const getAccountAgeDays = (merchant) => {
  if (!merchant.addedDate) return 0;
  const added = parseDate(merchant.addedDate);
  if (!added) return 0;
  return Math.max(0, diffInDays(getToday(), added));
};

const getDaysSinceTouched = (merchant) => {
  const lastTouched = parseDate(merchant.lastTouched || "");
  const added = parseDate(merchant.addedDate || "");
  const base = lastTouched || added;
  if (!base) return null;
  return Math.max(0, diffInDays(getToday(), base));
};

const getPriorityBucket = (ageDays) => {
  if (ageDays <= 14) return "p0";
  if (ageDays <= 60) return "p1";
  if (ageDays <= 179) return "p2";
  return "p3";
};

const getPriorityLabel = (ageDays) => {
  const bucket = getPriorityBucket(ageDays);
  if (bucket === "p0") return "Priority 0 (0-14)";
  if (bucket === "p1") return "Priority 1 (15-60)";
  if (bucket === "p2") return "Priority 2 (61-179)";
  return "Priority 3 (180+)";
};

const getFollowUpIntervalDays = (ageDays) => (ageDays <= 14 ? 1 : 3);

const getNextFollowUpDate = (merchant) => {
  const ageDays = getAccountAgeDays(merchant);
  const interval = getFollowUpIntervalDays(ageDays);
  const lastTouched = parseDate(merchant.lastTouched || "");
  const added = parseDate(merchant.addedDate || "");
  const base = lastTouched || added;
  if (!base) return null;
  return new Date(base.getTime() + interval * MS_PER_DAY);
};

const getFollowUpStatus = (merchant) => {
  const ageDays = getAccountAgeDays(merchant);
  const daysSinceTouched = getDaysSinceTouched(merchant);
  if (daysSinceTouched === null) {
    return { label: "No activity", className: "bg-slate-100 text-slate-600" };
  }
  if (daysSinceTouched >= 7) {
    return { label: "Public risk", className: "bg-red-100 text-red-700" };
  }
  const interval = getFollowUpIntervalDays(ageDays);
  if (daysSinceTouched >= interval) {
    return { label: "Due", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "On track", className: "bg-emerald-100 text-emerald-700" };
};

const isFollowUpOverdue = (merchant) => {
  const ageDays = getAccountAgeDays(merchant);
  const daysSinceTouched = getDaysSinceTouched(merchant);
  if (daysSinceTouched === null) return true;
  return daysSinceTouched >= getFollowUpIntervalDays(ageDays);
};

const getTouchBadge = (merchant) => {
  const daysSinceTouched = getDaysSinceTouched(merchant);
  if (daysSinceTouched === null) {
    return { label: "No activity", className: "bg-slate-100 text-slate-600" };
  }
  if (daysSinceTouched === 0) return { label: "Today", className: "bg-emerald-100 text-emerald-700" };
  if (daysSinceTouched <= 2) return { label: `${daysSinceTouched} days`, className: "bg-lime-100 text-lime-700" };
  if (daysSinceTouched <= 4) return { label: `${daysSinceTouched} days`, className: "bg-amber-100 text-amber-700" };
  if (daysSinceTouched <= 6) return { label: `${daysSinceTouched} days`, className: "bg-orange-100 text-orange-700" };
  return { label: `${daysSinceTouched}+ days`, className: "bg-red-100 text-red-700" };
};

const nextDateForDayOfMonth = (day, fromDate) => {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const lastDayCurrent = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayCurrent);
  const candidate = new Date(year, month, clampedDay);
  if (candidate >= toMidnight(fromDate)) return candidate;
  const nextMonth = new Date(year, month + 1, 1);
  const lastDayNext = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(day, lastDayNext));
};

const getNextDueDate = (merchant) => {
  const frequency = normalizeFrequency(merchant.frequency);
  if (!frequency || frequency === "Lump Sum") return null;
  const today = getToday();
  if (frequency === "Daily") return today;

  const startDate = parseDate(merchant.startDate);
  const dayOfMonth = parseDayOfMonth(merchant.startDate);

  if (frequency === "Weekly") {
    const anchor = startDate || today;
    const diff = (anchor.getDay() - today.getDay() + 7) % 7;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
  }

  if (frequency === "Bi-Weekly") {
    if (!startDate) return null;
    const diff = diffInDays(today, startDate);
    const offset = diff <= 0 ? 0 : (14 - (diff % 14)) % 14;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  }

  if (frequency === "Semi-Monthly") {
    const anchorDay = dayOfMonth || 1;
    const first = nextDateForDayOfMonth(anchorDay, today);
    const second = nextDateForDayOfMonth(Math.min(anchorDay + 15, 28), today);
    return first <= second ? first : second;
  }

  if (frequency === "Monthly") {
    const anchorDay = dayOfMonth || (startDate ? startDate.getDate() : null);
    if (!anchorDay) return null;
    return nextDateForDayOfMonth(anchorDay, today);
  }

  return null;
};

const getFirstWeekdayOnOrAfter = (date, weekday) => {
  const diff = (weekday - date.getDay() + 7) % 7;
  return addDays(date, diff);
};

const getMonthlyDueDates = (merchant, monthKey) => {
  const range = getMonthDateRange(monthKey);
  if (!range) return [];
  const { start, end, year, month } = range;
  const frequency = normalizeFrequency(merchant.frequency);
  if (!frequency || frequency === "Lump Sum") return [];

  const startDate = parseDate(merchant.startDate);
  if (startDate && startDate > end) return [];
  const effectiveStart = startDate && startDate > start ? startDate : start;
  const dates = [];

  if (frequency === "Daily") {
    for (let cursor = effectiveStart; cursor <= end; cursor = addDays(cursor, 1)) {
      dates.push(cursor);
    }
    return dates;
  }

  if (frequency === "Weekly") {
    const weekday = (startDate || start).getDay();
    let cursor = getFirstWeekdayOnOrAfter(effectiveStart, weekday);
    while (cursor <= end) {
      dates.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return dates;
  }

  if (frequency === "Bi-Weekly") {
    if (!startDate) return [];
    let cursor = startDate;
    while (cursor < effectiveStart) {
      cursor = addDays(cursor, 14);
    }
    while (cursor <= end) {
      dates.push(cursor);
      cursor = addDays(cursor, 14);
    }
    return dates;
  }

  if (frequency === "Semi-Monthly") {
    const anchorDay = parseDayOfMonth(merchant.startDate) || 1;
    const first = new Date(year, month - 1, anchorDay);
    const second = new Date(year, month - 1, Math.min(anchorDay + 15, 28));
    [first, second].forEach((date) => {
      if (date >= effectiveStart && date <= end) dates.push(date);
    });
    return dates;
  }

  if (frequency === "Monthly") {
    const anchorDay = parseDayOfMonth(merchant.startDate) || (startDate ? startDate.getDate() : null);
    if (!anchorDay) return [];
    const lastDay = new Date(year, month, 0).getDate();
    const date = new Date(year, month - 1, Math.min(anchorDay, lastDay));
    if (date >= effectiveStart && date <= end) dates.push(date);
    return dates;
  }

  return dates;
};

const getMonthlyProjectedAmount = (merchant, monthKey) => {
  const amount = parseMoney(merchant.amount);
  if (amount <= 0) return 0;
  const dueDates = getMonthlyDueDates(merchant, monthKey);
  return dueDates.length * amount;
};

const getAccountRiskCategory = (merchant) => {
  const status = String(merchant.status || "").toLowerCase();
  if (status.includes("settled")) return "settled";
  if (status.includes("defaulted")) return "defaulted";
  return "active";
};

const getMonthlyProjectionTotals = (merchants, monthKey) => {
  let expected = 0;
  let atRisk = 0;
  let settledLoss = 0;
  let defaultedLoss = 0;
  let activeCount = 0;
  let settledCount = 0;
  let defaultedCount = 0;

  merchants.forEach((merchant) => {
    const projected = getMonthlyProjectedAmount(merchant, monthKey);
    if (!projected) return;
    const category = getAccountRiskCategory(merchant);
    if (category === "settled") {
      settledLoss += projected;
      settledCount += 1;
      return;
    }
    if (category === "defaulted") {
      atRisk += projected;
      defaultedLoss += projected;
      defaultedCount += 1;
      return;
    }
    expected += projected;
    activeCount += 1;
  });

  return {
    expected,
    atRisk,
    settledLoss,
    defaultedLoss,
    activeCount,
    settledCount,
    defaultedCount,
  };
};

const isDueThisWeek = (merchant) => {
  const nextDue = getNextDueDate(merchant);
  if (!nextDue) return false;
  const daysAway = diffInDays(nextDue, getToday());
  return daysAway >= 0 && daysAway <= 7;
};

const getIncreaseStatus = (merchant) => {
  const increaseDate = parseDate(merchant.increaseDate);
  if (!increaseDate) return null;
  const daysAway = diffInDays(increaseDate, getToday());
  if (daysAway < 0) return { label: "Past due", className: "bg-red-100 text-red-700" };
  if (daysAway <= 1) return { label: "Increase now", className: "bg-red-100 text-red-700" };
  if (daysAway === 2) return { label: "Increase soon", className: "bg-yellow-100 text-yellow-700" };
  if (daysAway <= 4) return { label: "Increase soon", className: "bg-emerald-100 text-emerald-700" };
  return null;
};

const ensureUnsortedStatus = (statuses) => {
  if (!statuses.includes("Unsorted")) statuses.push("Unsorted");
  return statuses;
};

const normalizeMerchantData = (data) => {
  const accountAdded = parseDate(data.accountAddedDate);
  const ageDays = Number.isFinite(Number(data.accountAgeDays)) ? Number(data.accountAgeDays) : null;
  const addedDate =
    (accountAdded && toDateKey(accountAdded)) ||
    (ageDays !== null ? toDateKey(new Date(getToday().getTime() - ageDays * MS_PER_DAY)) : todayKey());
  const lastTouched = parseDate(data.lastTouched);
  return {
    id: crypto.randomUUID(),
    status: data.status ? data.status.trim() : "Unsorted",
    merchant: data.merchant ? data.merchant.trim() : "",
    startDate: data.startDate ? data.startDate.trim() : "",
    amount: data.amount ? data.amount.trim() : "",
    type: data.type ? data.type.trim() : "",
    frequency: normalizeFrequency(data.frequency),
    client: data.client ? data.client.trim() : "",
    increaseDate: data.increaseDate ? data.increaseDate.trim() : "",
    notes: data.notes ? data.notes.trim() : "",
    addedDate,
    lastTouched: lastTouched ? toDateKey(lastTouched) : "",
    payments: [],
  };
};

const parseCsvImport = (text) => {
  const rows = parseCsv(text);
  if (!rows.length || rows.length < 2) {
    return { error: "CSV file is empty or missing data rows." };
  }

  if (rows[0] && rows[0][0]) {
    rows[0][0] = String(rows[0][0]).replace(/^\uFEFF/, "");
  }

  const headers = rows[0].map((header) => HEADER_KEY_MAP[normalizeHeader(header)] || "");
  const merchantIndex = headers.indexOf("merchant");
  if (merchantIndex === -1) {
    return { error: "CSV must include a Merchant column." };
  }

  const merchants = [];
  const statuses = new Set(DEFAULT_STATUSES);

  rows.slice(1).forEach((row) => {
    const data = {};
    headers.forEach((key, index) => {
      if (!key) return;
      data[key] = row[index] ? String(row[index]).trim() : "";
    });

    if (!data.merchant) return;
    const merchant = normalizeMerchantData(data);
    if (!merchant.merchant) return;
    statuses.add(merchant.status);
    merchants.push(merchant);
  });

  if (!merchants.length) {
    return { error: "CSV import completed but no merchants were found." };
  }

  return { merchants, statuses: Array.from(statuses) };
};

const exportTemplateCsv = () => {
  const headers = [
    "Merchant",
    "Client",
    "Status",
    "Start Date",
    "Amount",
    "Type",
    "Frequency",
    "Increase Date",
    "Notes",
    "Account Age Days",
    "Last Worked",
    "Account Added Date",
  ];
  return `${headers.join(",")}\n`;
};

const exportCsvData = (merchants, monthKey) => {
  const headers = [
    "Merchant",
    "Client",
    "Status",
    "Start Date",
    "Amount",
    "Type",
    "Frequency",
    "Increase Date",
    "Notes",
    "Account Added Date",
    "Account Age Days",
    "Last Worked",
    "Next Follow Up",
    "Next Payment",
    "Follow-up Status",
    `Payments (${monthKey})`,
  ];
  const rows = merchants.map((merchant) => {
    const ageDays = getAccountAgeDays(merchant);
    const nextFollowUp = getNextFollowUpDate(merchant);
    const nextDue = getNextDueDate(merchant);
    const followUpStatus = getFollowUpStatus(merchant);
    const total = merchant.payments
      .filter((payment) => payment.date.startsWith(monthKey))
      .reduce((acc, payment) => acc + payment.amount, 0);
    return [
      merchant.merchant,
      merchant.client,
      merchant.status,
      merchant.startDate,
      merchant.amount,
      merchant.type,
      merchant.frequency,
      merchant.increaseDate,
      merchant.notes,
      merchant.addedDate,
      ageDays,
      merchant.lastTouched,
      nextFollowUp ? formatDisplayDate(nextFollowUp) : "",
      nextDue ? formatDisplayDate(nextDue) : "",
      followUpStatus.label,
      total,
    ];
  });

  return [headers, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const cell = value === undefined || value === null ? "" : String(value);
          if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(",")
    )
    .join("\n");
};

const getOpportunityForecastTotal = (opportunities) => {
  return opportunities.reduce((sum, opportunity) => {
    const amount = parseMoney(opportunity.amount);
    return sum + amount * getOpportunityConfidence(opportunity.stage);
  }, 0);
};

const getMonthTotal = (merchants, monthKey) =>
  merchants.reduce((sum, merchant) => {
    const total = merchant.payments
      .filter((payment) => payment.date.startsWith(monthKey))
      .reduce((acc, payment) => acc + payment.amount, 0);
    return sum + total;
  }, 0);

const getPaymentsToday = (merchants) => {
  const today = todayKey();
  return merchants.reduce((sum, merchant) => {
    return (
      sum + merchant.payments.filter((payment) => payment.date === today).reduce((acc, payment) => acc + payment.amount, 0)
    );
  }, 0);
};

const getTouchedCount = (merchants) => merchants.filter((merchant) => merchant.lastTouched === todayKey()).length;

const loadStoredState = () => {
  if (typeof window === "undefined") return null;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
};

const persistState = (merchants, statuses, opportunities) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      merchants,
      statuses,
      opportunities: opportunities || [],
    })
  );
};

const loadSidebarState = () => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIDEBAR_KEY) === "1";
};

const persistSidebarState = (collapsed) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
};

export {
  STORAGE_KEY,
  SIDEBAR_KEY,
  MS_PER_DAY,
  DEFAULT_STATUSES,
  OPPORTUNITY_STAGES,
  HEADER_KEY_MAP,
  todayKey,
  currentMonthKey,
  getMonthDateRange,
  getOpportunityConfidence,
  getOpportunityForecastTotal,
  formatMoney,
  parseMoney,
  normalizeHeader,
  parseCsvImport,
  normalizeFrequency,
  parseDate,
  formatDisplayDate,
  displayDateValue,
  getAccountAgeDays,
  getPriorityBucket,
  getPriorityLabel,
  getFollowUpStatus,
  getNextFollowUpDate,
  isFollowUpOverdue,
  getTouchBadge,
  getNextDueDate,
  getMonthlyProjectedAmount,
  getMonthlyProjectionTotals,
  isDueThisWeek,
  getIncreaseStatus,
  ensureUnsortedStatus,
  exportCsvData,
  exportTemplateCsv,
  getMonthTotal,
  getPaymentsToday,
  getTouchedCount,
  loadStoredState,
  persistState,
  loadSidebarState,
  persistSidebarState,
  toDateKey,
  getToday,
};
