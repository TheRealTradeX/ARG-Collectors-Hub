"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_STATUSES,
  currentMonthKey,
  displayDateValue,
  ensureUnsortedStatus,
  exportCsvData,
  exportTemplateCsv,
  formatDisplayDate,
  formatMoney,
  getAccountAgeDays,
  getFollowUpStatus,
  getIncreaseStatus,
  getMonthTotal,
  getNextDueDate,
  getNextFollowUpDate,
  getPaymentsToday,
  getPriorityLabel,
  getTouchBadge,
  getTouchedCount,
  isDueThisWeek,
  isFollowUpOverdue,
  loadSidebarState,
  loadStoredState,
  normalizeFrequency,
  parseCsvImport,
  parseMoney,
  persistSidebarState,
  persistState,
  toDateKey,
  todayKey,
} from "@/lib/arg-crm";

const createId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const downloadBlob = (content, filename) => {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function Home() {
  const [merchants, setMerchants] = useState([]);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES.slice());
  const [view, setView] = useState("accounts");
  const [search, setSearch] = useState("");
  const [touchedOnly, setTouchedOnly] = useState(false);
  const [needWorkOnly, setNeedWorkOnly] = useState(false);
  const [dueWeekOnly, setDueWeekOnly] = useState(false);
  const [increaseOnly, setIncreaseOnly] = useState(false);
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState("light");

  const [showMerchantModal, setShowMerchantModal] = useState(false);
  const [editingMerchant, setEditingMerchant] = useState(null);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMerchantId, setPaymentMerchantId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayKey());
  const [paymentAmount, setPaymentAmount] = useState("");

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusEdits, setStatusEdits] = useState({});
  const [newStatusName, setNewStatusName] = useState("");
  const [showControls, setShowControls] = useState(false);

  const boardRef = useRef(null);
  const topScrollRef = useRef(null);
  const topScrollInnerRef = useRef(null);
  const bottomScrollRef = useRef(null);
  const isScrollSyncingRef = useRef(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const saved = loadStoredState();
    if (saved && saved.merchants) {
      const savedStatuses = saved.statuses && saved.statuses.length ? saved.statuses : DEFAULT_STATUSES.slice();
      const merchantStatuses = saved.merchants.map((merchant) => merchant.status || "Unsorted");
      const mergedStatuses = ensureUnsortedStatus(Array.from(new Set(savedStatuses.concat(merchantStatuses))));
      setMerchants(saved.merchants);
      setStatuses(mergedStatuses);
      return;
    }
    setMerchants([]);
    setStatuses(ensureUnsortedStatus(DEFAULT_STATUSES.slice()));
  }, []);

  useEffect(() => {
    persistState(merchants, statuses);
  }, [merchants, statuses]);

  useEffect(() => {
    const collapsed = loadSidebarState();
    setSidebarCollapsed(collapsed);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    persistSidebarState(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    const savedTheme = typeof window !== "undefined" ? window.localStorage.getItem("collectors_hub_theme") : null;
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    if (typeof window !== "undefined") {
      window.localStorage.setItem("collectors_hub_theme", theme);
    }
  }, [theme]);

  const handleTopScroll = () => {
    if (view !== "payments") return;
    if (isScrollSyncingRef.current) {
      isScrollSyncingRef.current = false;
      return;
    }
    const topEl = topScrollRef.current;
    const bottomEl = bottomScrollRef.current;
    if (!topEl || !bottomEl) return;
    isScrollSyncingRef.current = true;
    bottomEl.scrollLeft = topEl.scrollLeft;
  };

  const handleBottomScroll = () => {
    if (view !== "payments") return;
    if (isScrollSyncingRef.current) {
      isScrollSyncingRef.current = false;
      return;
    }
    const topEl = topScrollRef.current;
    const bottomEl = bottomScrollRef.current;
    if (!topEl || !bottomEl) return;
    isScrollSyncingRef.current = true;
    topEl.scrollLeft = bottomEl.scrollLeft;
  };

  function updateKanbanScroll() {
    if (view !== "payments") return;
    const topInner = topScrollInnerRef.current;
    const bottomEl = bottomScrollRef.current;
    const boardEl = boardRef.current;
    if (!topInner || !bottomEl || !boardEl) return;
    const width = Math.max(boardEl.scrollWidth, bottomEl.scrollWidth);
    topInner.style.width = `${width}px`;
    topScrollRef.current.scrollLeft = bottomEl.scrollLeft;
  }

  useEffect(() => {
    if (view !== "payments") return;
    const raf = requestAnimationFrame(updateKanbanScroll);
    return () => cancelAnimationFrame(raf);
  }, [merchants, statuses, view, search, touchedOnly, needWorkOnly, dueWeekOnly, increaseOnly]);

  useEffect(() => {
    const handleResize = () => updateKanbanScroll();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [view]);

  const filteredMerchants = useMemo(() => {
    return merchants
      .filter((merchant) => {
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          merchant.merchant.toLowerCase().includes(term) ||
          (merchant.client || "").toLowerCase().includes(term)
        );
      })
      .filter((merchant) => (touchedOnly ? merchant.lastTouched === todayKey() : true))
      .filter((merchant) => (needWorkOnly ? isFollowUpOverdue(merchant) : true))
      .filter((merchant) => (dueWeekOnly ? isDueThisWeek(merchant) : true))
      .filter((merchant) => (increaseOnly ? Boolean(getIncreaseStatus(merchant)) : true))
      .sort((a, b) => (a.status || "").localeCompare(b.status || "") || a.merchant.localeCompare(b.merchant));
  }, [merchants, search, touchedOnly, needWorkOnly, dueWeekOnly, increaseOnly]);

  const monthTotal = useMemo(() => getMonthTotal(merchants, monthKey), [merchants, monthKey]);
  const paymentsToday = useMemo(() => getPaymentsToday(merchants), [merchants]);
  const touchedCount = useMemo(() => getTouchedCount(merchants), [merchants]);
  const overdueCount = useMemo(() => merchants.filter((merchant) => isFollowUpOverdue(merchant)).length, [merchants]);
  const dueWeekCount = useMemo(() => merchants.filter((merchant) => isDueThisWeek(merchant)).length, [merchants]);
  const increaseCount = useMemo(
    () => merchants.filter((merchant) => Boolean(getIncreaseStatus(merchant))).length,
    [merchants]
  );

  const handleToggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const handleToggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const applyQuickFilter = (type) => {
    if (type === "overdue") {
      setNeedWorkOnly(true);
      setDueWeekOnly(false);
      setIncreaseOnly(false);
      setTouchedOnly(false);
      return;
    }
    if (type === "dueWeek") {
      setNeedWorkOnly(false);
      setDueWeekOnly(true);
      setIncreaseOnly(false);
      setTouchedOnly(false);
      return;
    }
    if (type === "increase") {
      setNeedWorkOnly(false);
      setDueWeekOnly(false);
      setIncreaseOnly(true);
      setTouchedOnly(false);
    }
  };

  const handleFollowUpTilt = (event) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateX = ((y / rect.height) * 2 - 1) * -4;
    const rotateY = ((x / rect.width) * 2 - 1) * 4;
    card.style.transform = `translateY(-2px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const resetFollowUpTilt = (event) => {
    event.currentTarget.style.transform = "";
  };

  const openMerchantModal = (merchant = null) => {
    setEditingMerchant(merchant);
    setShowMerchantModal(true);
  };

  const closeMerchantModal = () => {
    setEditingMerchant(null);
    setShowMerchantModal(false);
  };

  const upsertMerchant = (event) => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const ageInput = String(formData.get("accountAgeDays") || "").trim();
    const ageDays = ageInput === "" ? null : Number.parseInt(ageInput, 10);
    const addedDate =
      Number.isFinite(ageDays) && ageDays >= 0
        ? toDateKey(new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000))
        : todayKey();

    const payload = {
      id: formData.get("merchantId") || "",
      merchant: String(formData.get("merchantName") || "").trim(),
      client: String(formData.get("clientName") || "").trim(),
      startDate: String(formData.get("startDate") || "").trim(),
      amount: String(formData.get("amount") || "").trim(),
      type: String(formData.get("type") || "").trim(),
      frequency: normalizeFrequency(String(formData.get("frequency") || "").trim()),
      increaseDate: String(formData.get("increaseDate") || "").trim(),
      status: String(formData.get("status") || "").trim() || "Unsorted",
      notes: String(formData.get("notes") || "").trim(),
      addedDate,
      lastTouched: String(formData.get("lastTouched") || "").trim(),
    };

    if (!payload.merchant) return;

    setMerchants((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === payload.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], ...payload, status: payload.status };
        return updated;
      }
      return [
        ...prev,
        {
          ...payload,
          id: createId(),
          status: payload.status,
          lastTouched: payload.lastTouched || todayKey(),
          payments: [],
        },
      ];
    });

    setStatuses((prev) => ensureUnsortedStatus(prev.includes(payload.status) ? [...prev] : [...prev, payload.status]));
    closeMerchantModal();
  };

  const deleteMerchant = (merchantId) => {
    const merchant = merchants.find((item) => item.id === merchantId);
    if (!merchant) return;
    if (!window.confirm(`Delete ${merchant.merchant}?`)) return;
    setMerchants((prev) => prev.filter((item) => item.id !== merchantId));
  };

  const addPayment = (event) => {
    event.preventDefault();
    const amount = parseMoney(paymentAmount);
    setMerchants((prev) =>
      prev.map((merchant) => {
        if (merchant.id !== paymentMerchantId) return merchant;
        return {
          ...merchant,
          payments: [...merchant.payments, { date: paymentDate, amount }],
          lastTouched: todayKey(),
        };
      })
    );
    setShowPaymentModal(false);
    setPaymentAmount("");
  };

  const markTouched = (merchantId) => {
    setMerchants((prev) =>
      prev.map((merchant) => (merchant.id === merchantId ? { ...merchant, lastTouched: todayKey() } : merchant))
    );
  };

  const moveMerchant = (merchantId, status) => {
    setMerchants((prev) =>
      prev.map((merchant) =>
        merchant.id === merchantId ? { ...merchant, status, lastTouched: todayKey() } : merchant
      )
    );
  };

  const handleImportCsv = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseCsvImport(reader.result || "");
      if (result.error) {
        window.alert(result.error);
        return;
      }
      if (!window.confirm("Replace current data with this CSV import?")) return;
      setMerchants(result.merchants);
      setStatuses(ensureUnsortedStatus(result.statuses));
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleExportCsv = () => {
    const csv = exportCsvData(merchants, monthKey);
    downloadBlob(csv, `arg-crm-${monthKey}.csv`);
  };

  const handleExportTemplate = () => {
    const csv = exportTemplateCsv();
    downloadBlob(csv, "Collectors Hub Template.csv");
  };

  const resetData = () => {
    if (!window.confirm("Reset local data and clear imported accounts?")) return;
    setMerchants([]);
    setStatuses(ensureUnsortedStatus(DEFAULT_STATUSES.slice()));
  };

  const openPaymentModal = (merchant) => {
    setPaymentMerchantId(merchant.id);
    setPaymentDate(todayKey());
    setPaymentAmount("");
    setShowPaymentModal(true);
  };

  const closePaymentModal = () => setShowPaymentModal(false);
  const closeControlsModal = () => setShowControls(false);

  const openStatusModal = () => {
    setStatusEdits({});
    setNewStatusName("");
    setShowStatusModal(true);
  };

  const closeStatusModal = () => setShowStatusModal(false);

  const handleRenameStatus = (status) => {
    const newValue = (statusEdits[status] || status).trim();
    if (!newValue || newValue === status) return;
    if (statuses.includes(newValue)) {
      window.alert("Status already exists.");
      return;
    }
    setMerchants((prev) => prev.map((merchant) => (merchant.status === status ? { ...merchant, status: newValue } : merchant)));
    setStatuses((prev) => ensureUnsortedStatus(prev.map((item) => (item === status ? newValue : item))));
    setStatusEdits((prev) => {
      const next = { ...prev };
      delete next[status];
      return next;
    });
  };

  const handleDeleteStatus = (status) => {
    if (status === "Unsorted") return;
    setMerchants((prev) => prev.map((merchant) => (merchant.status === status ? { ...merchant, status: "Unsorted" } : merchant)));
    setStatuses((prev) => ensureUnsortedStatus(prev.filter((item) => item !== status)));
  };

  const handleAddStatus = (event) => {
    event.preventDefault();
    const trimmed = newStatusName.trim();
    if (!trimmed) return;
    if (statuses.includes(trimmed)) {
      window.alert("Status already exists.");
      return;
    }
    setStatuses((prev) => ensureUnsortedStatus([...prev, trimmed]));
    setNewStatusName("");
  };

  const handleDrop = (event, status) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    moveMerchant(id, status);
  };

  const moveStatus = (status, direction) => {
    if (status === "Unsorted") return;
    setStatuses((prev) => {
      const list = [...prev];
      const index = list.indexOf(status);
      if (index === -1) return list;
      const unsortedIndex = list.indexOf("Unsorted");
      const maxIndex = unsortedIndex === -1 ? list.length - 1 : unsortedIndex - 1;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex > maxIndex) return list;
      const swap = list[targetIndex];
      list[targetIndex] = status;
      list[index] = swap;
      return list;
    });
  };

  const orderedStatuses = useMemo(() => {
    const list = [...statuses];
    const unsortedIndex = list.indexOf("Unsorted");
    if (unsortedIndex !== -1 && unsortedIndex !== list.length - 1) {
      list.splice(unsortedIndex, 1);
      list.push("Unsorted");
    }
    return list;
  }, [statuses]);
  return (
    <div className="min-h-screen lg:flex">
      <aside
        id="sidebar"
        className="glass min-h-screen w-full border-b border-white/70 px-6 py-6 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r flex flex-col"
      >
        <div id="sidebarHeader" className="flex items-center gap-3">
          <div className="sidebar-logo h-12 w-12 rounded-2xl bg-white/95 text-white grid place-items-center shadow-sm ring-1 ring-white/70">
            <img src="/ARG Hub Logo.svg" alt="ARG Hub Logo" className="h-11 w-11 object-contain drop-shadow-[0_6px_12px_rgba(10,15,26,0.35)]" />
          </div>
          <div id="sidebarHeaderText">
            <p className="text-sm font-semibold">Collections Hub</p>
          </div>
        </div>
        <nav className="mt-8 grid gap-2">
          {[
            {
              key: "accounts",
              label: "Accounts",
              icon: (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                  <path d="M7 8h10M7 12h10M7 16h6"></path>
                </svg>
              ),
            },
            {
              key: "payments",
              label: "Payments",
              icon: (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 4v16"></path>
                  <path d="M15.5 8.5c0-1.9-1.6-3.5-3.5-3.5s-3.5 1.2-3.5 2.8 1.3 2.6 3.4 2.9 3.6 1.2 3.6 3.1-1.6 3.2-3.5 3.2-3.5-1.1-3.5-2.8"></path>
                </svg>
              ),
            },
            {
              key: "dashboard",
              label: "Dashboard",
              icon: (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 12a8 8 0 1 0 16 0"></path>
                  <path d="M12 12V4"></path>
                  <path d="M12 12l6 2"></path>
                </svg>
              ),
            },
            {
              key: "settings",
              label: "Settings",
              icon: (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"></path>
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.6l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 21 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>
                </svg>
              ),
            },
          ].map((item) => (
            <button
              key={item.key}
              className={`nav-button flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                view === item.key ? "bg-ink text-white shadow-glow" : "text-steel/70 hover:bg-white/60"
              }`}
              data-view={item.key}
              onClick={() => setView(item.key)}
            >
              <span className="flex items-center gap-3">
                <span className="nav-icon text-current">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </span>
              <span className="nav-tooltip">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer mt-auto flex flex-col gap-4 items-stretch">
          <button
            data-action="toggleSidebar"
            className="sidebar-toggle grid h-11 w-11 place-items-center rounded-full border border-steel/10 bg-white/80 text-steel/80"
            aria-label={sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
            title={sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
            onClick={handleToggleSidebar}
          >
            <svg className="toggle-icon h-5 w-5 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 6l-6 6 6 6"></path>
              <path d="M19 6l-6 6 6 6"></path>
            </svg>
          </button>
          <div className="sidebar-tip rounded-2xl border border-steel/10 bg-white/70 p-4 text-xs text-steel/70">
            Tip: drag cards on the Kanban board to update status and track work automatically.
          </div>
          <div className="sidebar-profile flex items-center gap-3 rounded-2xl border border-steel/10 bg-white/70 p-3">
            <div className="sidebar-avatar h-10 w-10 rounded-full bg-ink text-white grid place-items-center text-sm font-semibold">
              JP
            </div>
            <div>
              <p className="sidebar-profile-name text-sm font-semibold text-ink">Jefrey Peralta</p>
              <p className="sidebar-profile-role text-xs text-steel/60">Accounts Manager</p>
            </div>
          </div>
        </div>
      </aside>

      <div id="mainContent" className="flex-1 min-w-0 px-6 py-6 md:px-10">
        <div className="top-header sticky top-0 z-20 -mx-6 border-b border-white/70 bg-white/85 px-6 pb-4 pt-5 backdrop-blur-xl md:-mx-10 md:px-10 md:pb-6 md:pt-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 id="pageTitle" className="text-2xl font-semibold">
                {view === "accounts"
                  ? "Accounts Overview"
                  : view === "dashboard"
                  ? "Dashboard Overview"
                  : view === "payments"
                  ? "Payments Overview"
                  : "Settings"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="csvInput"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleImportCsv}
              />
              <button
                id="openControls"
                className="rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => setShowControls(true)}
              >
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 6h9M4 12h14M4 18h6"></path>
                    <circle cx="17" cy="6" r="2"></circle>
                    <circle cx="11" cy="18" r="2"></circle>
                  </svg>
                  Controls
                </span>
              </button>
              <button
                id="importCsv"
                className="rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
              >
                Import CSV
              </button>
              <button
                data-action="toggleSidebar"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
              />
              <button
                id="exportCsv"
                className="rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                onClick={handleExportCsv}
              >
                Export
              </button>
              <button
                id="addMerchant"
                className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5"
                onClick={() => openMerchantModal()}
              >
                Add Merchant
              </button>
            </div>
          </header>
        </div>

        {view !== "settings" && (
        <section className="mt-4 space-y-3">
          {view !== "payments" && (
            <div className="stat-strip glass rounded-3xl px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Today</p>
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                    {touchedCount} worked
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="stat-chip rounded-2xl border border-steel/10 bg-white/70 px-3 py-2 min-w-[150px]">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Payments Logged</p>
                    <p className="text-base font-semibold">{formatMoney(paymentsToday)}</p>
                  </div>
                  <div className="stat-chip rounded-2xl border border-steel/10 bg-white/70 px-3 py-2 min-w-[150px]">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Month Total</p>
                    <p className="text-base font-semibold">{formatMoney(monthTotal)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </section>
        )}

        <main className="mt-6">
          {view === "dashboard" && (
            <section id="dashboardView">
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Accounts</p>
                  <p className="mt-2 text-3xl font-semibold">{merchants.length}</p>
                  <p className="mt-1 text-xs text-steel/60">Total tracked merchants</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Follow-ups</p>
                  <p className="mt-2 text-3xl font-semibold">{overdueCount}</p>
                  <p className="mt-1 text-xs text-steel/60">Overdue accounts</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Due This Week</p>
                  <p className="mt-2 text-3xl font-semibold">{dueWeekCount}</p>
                  <p className="mt-1 text-xs text-steel/60">Scheduled payments</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Increase Due</p>
                  <p className="mt-2 text-3xl font-semibold">{increaseCount}</p>
                  <p className="mt-1 text-xs text-steel/60">Upcoming increase dates</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Worked Today</p>
                  <p className="mt-2 text-3xl font-semibold">{touchedCount}</p>
                  <p className="mt-1 text-xs text-steel/60">Accounts updated today</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Month Total</p>
                  <p className="mt-2 text-3xl font-semibold">{formatMoney(monthTotal)}</p>
                  <p className="mt-1 text-xs text-steel/60">Logged payments</p>
                </div>
              </div>
            </section>
          )}

          {view === "accounts" && (
            <section id="accountsView">
              <div className="glass rounded-3xl p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">Accounts List</h2>
                    <p className="text-xs text-steel/60">List view of all merchants and statuses.</p>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wider text-steel/60">
                      <tr>
                        <th className="py-3 pr-4">Merchant</th>
                        <th className="py-3 pr-4">Client</th>
                        <th className="py-3 pr-4">Status</th>
                        <th className="py-3 pr-4">Start</th>
                        <th className="py-3 pr-4">Amount</th>
                        <th className="py-3 pr-4">Frequency</th>
                        <th className="py-3 pr-4">Age</th>
                        <th className="py-3 pr-4">Priority</th>
                        <th className="py-3 pr-4">Last Worked</th>
                        <th className="py-3 pr-4">Follow-up</th>
                        <th className="py-3 pr-4">Next Due</th>
                        <th className="py-3 pr-4">Increase</th>
                        <th className="py-3 pr-4">Month Total</th>
                        <th className="py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-steel/10">
                      {filteredMerchants.map((merchant) => {
                        const monthTotalRow = merchant.payments
                          .filter((payment) => payment.date.startsWith(monthKey))
                          .reduce((acc, payment) => acc + payment.amount, 0);
                        const ageDays = getAccountAgeDays(merchant);
                        const priority = getPriorityLabel(ageDays);
                        const touchBadge = getTouchBadge(merchant);
                        const followUpStatus = getFollowUpStatus(merchant);
                        const nextFollowUp = getNextFollowUpDate(merchant);
                        const nextDue = getNextDueDate(merchant);
                        const increaseStatus = getIncreaseStatus(merchant);
                        return (
                          <tr key={merchant.id}>
                            <td className="py-3 pr-4 font-semibold">
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => openMerchantModal(merchant)}
                              >
                                {merchant.merchant}
                              </button>
                            </td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.client || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.status}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.startDate || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.amount || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.frequency || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{ageDays}</td>
                            <td className="py-3 pr-4 text-steel/70">{priority}</td>
                            <td className="py-3 pr-4">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${touchBadge.className}`}>
                                {touchBadge.label}
                              </span>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex flex-col gap-1">
                                <span className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${followUpStatus.className}`}>
                                  {followUpStatus.label}
                                </span>
                                <span className="text-[11px] text-steel/60">Next: {formatDisplayDate(nextFollowUp)}</span>
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-steel/70">{nextDue ? formatDisplayDate(nextDue) : "-"}</td>
                            <td className="py-3 pr-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-steel/70">{displayDateValue(merchant.increaseDate)}</span>
                                {increaseStatus ? (
                                  <span className={`rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${increaseStatus.className}`}>
                                    {increaseStatus.label}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-3 pr-4 font-semibold">{formatMoney(monthTotalRow)}</td>
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  data-action="payment"
                                  className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white"
                                  onClick={() => openPaymentModal(merchant)}
                                >
                                  Add
                                </button>
                                <button
                                  data-action="worked"
                                  className="rounded-full border border-steel/10 px-2 py-1 text-xs"
                                  onClick={() => markTouched(merchant.id)}
                                >
                                  Worked
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredMerchants.length === 0 && (
                        <tr>
                          <td colSpan={14} className="py-8 text-center text-sm text-steel/60">
                            No accounts yet. Import a CSV or add a merchant.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
          {view === "payments" && (
            <section id="kanbanView">
              <div className="-mx-2 px-2 pb-2">
                <div ref={topScrollRef} id="kanbanScrollTop" className="overflow-x-auto" onScroll={handleTopScroll}>
                  <div ref={topScrollInnerRef} id="kanbanScrollTopInner" className="h-3 min-w-full"></div>
                </div>
              </div>
              <div
                ref={bottomScrollRef}
                id="kanbanScrollBottom"
                className="-mx-2 max-w-full overflow-x-auto px-2 pb-6"
                onScroll={handleBottomScroll}
              >
                <div ref={boardRef} id="board" className="flex min-w-max gap-5">
                  {orderedStatuses.map((status) => {
                    const statusMerchants = filteredMerchants.filter(
                      (merchant) => (merchant.status || "Unsorted") === status
                    );
                    return (
                      <div
                        key={status}
                        className="fade-in flex min-w-[320px] max-w-[320px] flex-1 flex-col rounded-3xl border border-white/60 bg-white/70 p-4 shadow-sm"
                        data-status={status}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, status)}
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold">{status}</h3>
                            <p className="text-xs text-steel/60">{statusMerchants.length} accounts</p>
                          </div>
                          <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                            {statusMerchants.length}
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {statusMerchants.map((merchant) => {
                            const ageDays = getAccountAgeDays(merchant);
                            const followUpStatus = getFollowUpStatus(merchant);
                            const touchBadge = getTouchBadge(merchant);
                            const monthTotalCard = merchant.payments
                              .filter((payment) => payment.date.startsWith(monthKey))
                              .reduce((acc, payment) => acc + payment.amount, 0);
                            const nextDue = getNextDueDate(merchant);
                            const increaseStatus = getIncreaseStatus(merchant);
                            return (
                              <div
                                key={merchant.id}
                                className="group relative cursor-pointer rounded-2xl border border-steel/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                draggable
                                onClick={() => openMerchantModal(merchant)}
                                onDragStart={(event) => event.dataTransfer.setData("text/plain", merchant.id)}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <h4 className="text-sm font-semibold">{merchant.merchant}</h4>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${touchBadge.className}`}>
                                    {touchBadge.label}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs text-steel/70">{merchant.client || "Client not listed"}</p>
                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-steel/70">
                                  <span className="rounded-full bg-ink/5 px-2 py-1">{merchant.amount || "No amount"}</span>
                                  <span className="rounded-full bg-ink/5 px-2 py-1">{merchant.frequency || "No frequency"}</span>
                                  <span className="rounded-full bg-ink/5 px-2 py-1">{merchant.type || "No type"}</span>
                                </div>
                                <div className="mt-3 text-xs text-steel/70 space-y-1">
                                  <p><span className="font-medium">Age:</span> {ageDays} days</p>
                                  <p><span className="font-medium">Next follow-up:</span> {formatDisplayDate(getNextFollowUpDate(merchant))}</p>
                                  <p><span className="font-medium">Next due:</span> {nextDue ? formatDisplayDate(nextDue) : "-"}</p>
                                  <p><span className="font-medium">Increase:</span> {displayDateValue(merchant.increaseDate)}</p>
                                  <p><span className="font-medium">Notes:</span> {merchant.notes || "None"}</p>
                                </div>
                                <div className="mt-3 rounded-2xl border border-steel/10 bg-white/90 px-3 py-2 text-xs text-ink shadow-sm">
                                  <p className="text-steel/70">Month total</p>
                                  <p className="text-sm font-semibold">{formatMoney(monthTotalCard)}</p>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                  <span className={`rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${followUpStatus.className}`}>
                                    {followUpStatus.label}
                                  </span>
                                  {isDueThisWeek(merchant) && (
                                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-sky-700">
                                      Due this week
                                    </span>
                                  )}
                                  {increaseStatus && (
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${increaseStatus.className}`}>
                                      {increaseStatus.label}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <button
                                    data-action="payment"
                                    className="w-full rounded-2xl bg-ink px-3 py-2 text-xs font-semibold text-white"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openPaymentModal(merchant);
                                    }}
                                  >
                                    Add Payment
                                  </button>
                                  <button
                                    data-action="worked"
                                    className="w-full rounded-2xl border border-steel/10 px-3 py-2 text-xs font-semibold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      markTouched(merchant.id);
                                    }}
                                  >
                                    Mark Worked
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {statusMerchants.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-steel/20 bg-white/50 p-4 text-xs text-steel/60">
                              No accounts in this status.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
          {view === "settings" && (
            <section id="settingsView">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="glass rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Data & Templates</p>
                      <h2 className="mt-2 text-lg font-semibold">CSV Imports & Exports</h2>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-steel/60">
                    Upload account data, export current records, or generate a template for your team.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      className="rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    >
                      Import CSV
                    </button>
                    <button
                      className="rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      onClick={handleExportCsv}
                    >
                      Export CSV
                    </button>
                    <button
                      className="rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      onClick={handleExportTemplate}
                    >
                      Generate Template
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-steel/60">
                    Template columns: Merchant, Client, Status, Start Date, Amount, Type, Frequency, Increase Date, Notes, Account Age Days,
                Last Worked, Account Added Date.
                  </p>
                </div>

                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Monthly Controls</p>
                  <h2 className="mt-2 text-lg font-semibold">Reporting Window</h2>
                  <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <input
                      type="month"
                      className="w-full rounded-2xl border border-steel/10 bg-white/80 px-4 py-2 text-sm focus:border-accent focus:outline-none"
                      value={monthKey}
                      onChange={(event) => setMonthKey(event.target.value)}
                    />
                    <button
                      className="w-full rounded-2xl border border-steel/10 bg-white/80 px-4 py-2 text-sm font-medium text-steel/80 sm:w-auto"
                      onClick={resetData}
                    >
                      Reset Data
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-steel/60">Reset clears local data so you can import a fresh CSV.</p>
                </div>

                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Appearance</p>
                  <h2 className="mt-2 text-lg font-semibold">Theme Mode</h2>
                  <p className="mt-2 text-sm text-steel/60">Toggle between light and dark mode for your workspace.</p>
                  <button
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-semibold text-steel/80 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    onClick={handleToggleTheme}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white text-xs">
                      {theme === "dark" ? "☾" : "☼"}
                    </span>
                    {theme === "dark" ? "Dark mode" : "Light mode"}
                  </button>
                </div>

                <div className="glass rounded-3xl p-6 shadow-sm lg:col-span-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Filters & Follow-up Focus</p>
                  <h2 className="mt-2 text-lg font-semibold">Prioritize Work</h2>
                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    <div className="space-y-4">
                      <input
                        type="search"
                        placeholder="Search merchant or client..."
                        className="w-full rounded-2xl border border-steel/10 bg-white/80 px-4 py-2 text-sm focus:border-accent focus:outline-none"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      <div className="grid gap-3">
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-accent"
                            checked={touchedOnly}
                            onChange={(event) => setTouchedOnly(event.target.checked)}
                          />
                          Show worked today
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-coral"
                            checked={needWorkOnly}
                            onChange={(event) => setNeedWorkOnly(event.target.checked)}
                          />
                          Follow-up due
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-sky-500"
                            checked={dueWeekOnly}
                            onChange={(event) => setDueWeekOnly(event.target.checked)}
                          />
                          Due this week
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-500"
                            checked={increaseOnly}
                            onChange={(event) => setIncreaseOnly(event.target.checked)}
                          />
                          Increase due
                        </label>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-steel/10 bg-white/70 p-4">
                        <p className="text-xs text-steel/60">Overdue follow-ups</p>
                        <p className="mt-2 text-2xl font-semibold">{overdueCount}</p>
                      </div>
                      <div className="rounded-2xl border border-steel/10 bg-white/70 p-4">
                        <p className="text-xs text-steel/60">Due this week</p>
                        <p className="mt-2 text-2xl font-semibold">{dueWeekCount}</p>
                      </div>
                      <div className="rounded-2xl border border-steel/10 bg-white/70 p-4">
                        <p className="text-xs text-steel/60">Increase due</p>
                        <p className="mt-2 text-2xl font-semibold">{increaseCount}</p>
                      </div>
                      <button
                        className="w-full rounded-full border border-steel/10 bg-white px-4 py-2 text-sm font-semibold text-steel/70"
                        onClick={openStatusModal}
                      >
                        Manage Statuses
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {showMerchantModal && (
        <div id="merchantModal" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="glass w-full max-w-2xl rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 id="modalTitle" className="text-xl font-semibold">
                {editingMerchant ? "Edit Merchant" : "Add Merchant"}
              </h2>
              <button id="closeMerchantModal" className="text-xl text-steel/60" onClick={closeMerchantModal}>
                &times;
              </button>
            </div>
            <form id="merchantForm" className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={upsertMerchant}>
              <input type="hidden" name="merchantId" value={editingMerchant?.id || ""} />
              <label className="text-sm">
                Merchant
                <input
                  name="merchantName"
                  required
                  defaultValue={editingMerchant?.merchant || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Client
                <input
                  name="clientName"
                  defaultValue={editingMerchant?.client || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Start Date
                <input
                  name="startDate"
                  defaultValue={editingMerchant?.startDate || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Amount
                <input
                  name="amount"
                  defaultValue={editingMerchant?.amount || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Type
                <input
                  name="type"
                  defaultValue={editingMerchant?.type || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Frequency
                <input
                  name="frequency"
                  defaultValue={editingMerchant?.frequency || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Increase / Fixed Until Paid
                <input
                  name="increaseDate"
                  defaultValue={editingMerchant?.increaseDate || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Status Column
                <input
                  name="status"
                  defaultValue={editingMerchant?.status || statuses[0] || "Unsorted"}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Account Age Days
                <input
                  name="accountAgeDays"
                  type="number"
                  min="0"
                  defaultValue={editingMerchant ? getAccountAgeDays(editingMerchant) : ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Last Worked
                <input
                  name="lastTouched"
                  type="date"
                  defaultValue={editingMerchant?.lastTouched || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm md:col-span-2">
                Notes
                <textarea
                  name="notes"
                  rows="3"
                  defaultValue={editingMerchant?.notes || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                ></textarea>
              </label>
              {editingMerchant && (
                <div className="md:col-span-2">
                  <details className="rounded-2xl border border-steel/10 bg-white/70 px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-steel/80">
                      Payment log ({editingMerchant.payments?.length || 0})
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-steel/70">
                      {editingMerchant.payments && editingMerchant.payments.length > 0 ? (
                        editingMerchant.payments
                          .slice()
                          .sort((a, b) => (a.date < b.date ? 1 : -1))
                          .map((payment, index) => (
                            <div key={`${payment.date}-${payment.amount}-${index}`} className="flex items-center justify-between">
                              <span>{displayDateValue(payment.date)}</span>
                              <span className="font-semibold text-ink">{formatMoney(payment.amount)}</span>
                            </div>
                          ))
                      ) : (
                        <p>No payments logged.</p>
                      )}
                    </div>
                  </details>
                </div>
              )}
              <div className="md:col-span-2 flex justify-end gap-3">
                {editingMerchant && (
                  <button
                    type="button"
                    className="rounded-2xl border border-coral/20 px-4 py-2 text-sm text-coral"
                    onClick={() => {
                      deleteMerchant(editingMerchant.id);
                      closeMerchantModal();
                    }}
                  >
                    Delete
                  </button>
                )}
                <button type="button" id="cancelMerchant" className="rounded-2xl border border-steel/10 px-4 py-2 text-sm" onClick={closeMerchantModal}>
                  Cancel
                </button>
                <button type="submit" className="rounded-2xl bg-ink px-5 py-2 text-sm font-semibold text-white">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showPaymentModal && (
        <div id="paymentModal" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="glass w-full max-w-lg rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Add Payment</h2>
              <button id="closePaymentModal" className="text-xl text-steel/60" onClick={closePaymentModal}>
                &times;
              </button>
            </div>
            <form id="paymentForm" className="mt-4 grid gap-4" onSubmit={addPayment}>
              <input type="hidden" value={paymentMerchantId} />
              <label className="text-sm">
                Payment Date
                <input
                  id="paymentDate"
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Amount
                <input
                  id="paymentAmount"
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <div className="flex justify-end gap-3">
                <button type="button" id="cancelPayment" className="rounded-2xl border border-steel/10 px-4 py-2 text-sm" onClick={closePaymentModal}>
                  Cancel
                </button>
                <button type="submit" className="rounded-2xl bg-ink px-5 py-2 text-sm font-semibold text-white">
                  Log Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStatusModal && (
        <div id="statusModal" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="glass w-full max-w-lg rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Manage Statuses</h2>
              <button id="closeStatusModal" className="text-xl text-steel/60" onClick={closeStatusModal}>
                &times;
              </button>
            </div>
            <form id="addStatusForm" className="mt-4 flex flex-wrap gap-3" onSubmit={handleAddStatus}>
              <input
                id="newStatusName"
                placeholder="New status name"
                className="flex-1 rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                value={newStatusName}
                onChange={(event) => setNewStatusName(event.target.value)}
              />
              <button type="submit" className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white">
                Add Status
              </button>
            </form>
            <div id="statusList" className="mt-4 grid gap-2">
              {orderedStatuses.map((status, index) => (
                <div
                  key={status}
                  className="flex items-center gap-2 rounded-2xl border border-steel/10 bg-white/70 px-3 py-2"
                >
                  <div className="flex flex-col gap-1">
                    <button
                      className="rounded-full border border-steel/10 px-2 py-1 text-[10px] font-semibold"
                      disabled={status === "Unsorted" || index === 0}
                      onClick={() => moveStatus(status, "up")}
                      type="button"
                      aria-label="Move status up"
                    >
                      Up
                    </button>
                    <button
                      className="rounded-full border border-steel/10 px-2 py-1 text-[10px] font-semibold"
                      disabled={status === "Unsorted" || index === orderedStatuses.length - 1 || orderedStatuses[index + 1] === "Unsorted"}
                      onClick={() => moveStatus(status, "down")}
                      type="button"
                      aria-label="Move status down"
                    >
                      Down
                    </button>
                  </div>
                  <input
                    className="w-full bg-transparent text-sm text-ink focus:outline-none"
                    value={statusEdits[status] ?? status}
                    onChange={(event) => setStatusEdits((prev) => ({ ...prev, [status]: event.target.value }))}
                    disabled={status === "Unsorted"}
                  />
                  <button
                    className="rounded-full border border-steel/10 px-3 py-1 text-xs font-semibold"
                    disabled={status === "Unsorted"}
                    onClick={() => handleRenameStatus(status)}
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="rounded-full border border-coral/20 px-3 py-1 text-xs font-semibold text-coral"
                    disabled={status === "Unsorted"}
                    onClick={() => handleDeleteStatus(status)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button id="cancelStatusModal" type="button" className="rounded-2xl border border-steel/10 px-4 py-2 text-sm" onClick={closeStatusModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showControls && (
        <div id="controlsModal" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="glass w-full max-w-5xl rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-steel/60">Controls</p>
                <h2 className="text-xl font-semibold">Filters, Monthly View, Follow-ups</h2>
              </div>
              <button className="text-xl text-steel/60" onClick={closeControlsModal} aria-label="Close controls">
                &times;
              </button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.9fr_0.8fr]">
              <div className="space-y-3 min-w-0">
                <p className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Filters</p>
                <input
                  type="search"
                  placeholder="Search merchant or client..."
                  className="w-full rounded-2xl border border-steel/10 bg-white/80 px-4 py-2 text-sm focus:border-accent focus:outline-none"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="flex flex-wrap gap-3 text-sm text-steel/70">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={touchedOnly}
                      onChange={(event) => setTouchedOnly(event.target.checked)}
                    />
                    Show worked today
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-coral"
                      checked={needWorkOnly}
                      onChange={(event) => setNeedWorkOnly(event.target.checked)}
                    />
                    Follow-up due
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      checked={dueWeekOnly}
                      onChange={(event) => setDueWeekOnly(event.target.checked)}
                    />
                    Due this week
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500"
                      checked={increaseOnly}
                      onChange={(event) => setIncreaseOnly(event.target.checked)}
                    />
                    Increase due
                  </label>
                  <button
                    className="rounded-full border border-steel/10 bg-white/80 px-3 py-1 text-xs font-semibold text-steel/70"
                    onClick={openStatusModal}
                  >
                    Manage Statuses
                  </button>
                </div>
                <details className="text-xs text-steel/60">
                  <summary className="cursor-pointer font-semibold text-steel/70">CSV columns</summary>
                  <p className="mt-2">
                    Merchant, Client, Status, Start Date, Amount, Type, Frequency, Increase Date, Notes, Account Age Days,
                    Last Worked, Account Added Date.
                  </p>
                </details>
              </div>
              <div className="space-y-3 min-w-0">
                <p className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Monthly View</p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    type="month"
                    className="w-full rounded-2xl border border-steel/10 bg-white/80 px-4 py-2 text-sm focus:border-accent focus:outline-none"
                    value={monthKey}
                    onChange={(event) => setMonthKey(event.target.value)}
                  />
                  <button
                    className="w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm font-medium text-steel/80 sm:w-auto"
                    onClick={resetData}
                  >
                    Reset Data
                  </button>
                </div>
                <p className="text-xs text-steel/60">Reset clears local data so you can import a fresh CSV.</p>
              </div>
              <div className="space-y-3 min-w-0">
                <p className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Follow-ups</p>
                <div className="grid gap-3">
                  <div
                    className={`followup-card rounded-2xl border border-steel/10 bg-white/70 px-4 py-3 ${needWorkOnly ? "ring-2 ring-coral/50" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => applyQuickFilter("overdue")}
                    onMouseMove={handleFollowUpTilt}
                    onMouseLeave={resetFollowUpTilt}
                  >
                    <p className="text-xs text-steel/60">Overdue</p>
                    <p className="text-xl font-semibold">{overdueCount}</p>
                  </div>
                  <div
                    className={`followup-card rounded-2xl border border-steel/10 bg-white/70 px-4 py-3 ${dueWeekOnly ? "ring-2 ring-sky/50" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => applyQuickFilter("dueWeek")}
                    onMouseMove={handleFollowUpTilt}
                    onMouseLeave={resetFollowUpTilt}
                  >
                    <p className="text-xs text-steel/60">Due This Week</p>
                    <p className="text-xl font-semibold">{dueWeekCount}</p>
                  </div>
                  <div
                    className={`followup-card rounded-2xl border border-steel/10 bg-white/70 px-4 py-3 ${increaseOnly ? "ring-2 ring-emerald-300/60" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => applyQuickFilter("increase")}
                    onMouseMove={handleFollowUpTilt}
                    onMouseLeave={resetFollowUpTilt}
                  >
                    <p className="text-xs text-steel/60">Increase Due</p>
                    <p className="text-xl font-semibold">{increaseCount}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
