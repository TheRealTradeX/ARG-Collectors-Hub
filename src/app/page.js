"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_STATUSES,
  OPPORTUNITY_STAGES,
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
  getMonthlyProjectionTotals,
  getNextDueDate,
  getNextFollowUpDate,
  getOpportunityConfidence,
  getOpportunityForecastTotal,
  getPaymentsToday,
  getPriorityBucket,
  getPriorityLabel,
  getTouchBadge,
  getTouchedCount,
  isDueThisWeek,
  isFollowUpOverdue,
  loadSidebarState,
  normalizeFrequency,
  parseCsvImport,
  parseMoney,
  persistSidebarState,
  toDateKey,
  todayKey,
} from "@/lib/arg-crm";
import { supabase } from "@/lib/supabaseClient";

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

const parseMonthKey = (value) => {
  const [yearRaw, monthRaw] = String(value || "").split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
};

const monthDiff = (startKey, endKey) => {
  const start = parseMonthKey(startKey);
  const end = parseMonthKey(endKey);
  if (!start || !end) return 0;
  return (end.year - start.year) * 12 + (end.month - start.month);
};

const monthKeyFromDate = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const appCache = {
  userId: null,
  merchants: [],
  statuses: null,
  opportunities: [],
  history: [],
  historyPayments: [],
  monthlySettings: null,
  filtersByView: null,
  monthKey: null,
};

const DEFAULT_FILTERS = {
  search: "",
  tagFilters: [],
  touchedOnly: false,
  needWorkOnly: false,
  dueWeekOnly: false,
  increaseOnly: false,
  unsortedOnly: false,
  priorityFilters: { p0: false, p1: false, p2: false, p3: false },
  sortKey: "",
  sortDirection: "asc",
};

export default function Home({ initialView = "accounts" }) {
  const TAG_OPTIONS = ["Bankruptcy", "Answer Filed"];
  const router = useRouter();
  const [merchants, setMerchants] = useState(appCache.merchants || []);
  const [statuses, setStatuses] = useState(appCache.statuses || DEFAULT_STATUSES.slice());
  const [opportunities, setOpportunities] = useState(appCache.opportunities || []);
  const [view, setView] = useState(initialView);
  const [filtersByView, setFiltersByView] = useState(
    () =>
      appCache.filtersByView || {
        accounts: { ...DEFAULT_FILTERS },
        payments: { ...DEFAULT_FILTERS },
        opportunities: { ...DEFAULT_FILTERS },
        dashboard: { ...DEFAULT_FILTERS },
        settings: { ...DEFAULT_FILTERS },
      }
  );
  const [monthKey, setMonthKey] = useState(appCache.monthKey || currentMonthKey());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState("light");
  const [session, setSession] = useState(appCache.session || null);
  const [authMode, setAuthMode] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFullName, setAuthFullName] = useState("");
  const [authPhone, setAuthPhone] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(!appCache.merchants?.length);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  const [showMerchantModal, setShowMerchantModal] = useState(false);
  const [editingMerchant, setEditingMerchant] = useState(null);
  const [merchantTagsDraft, setMerchantTagsDraft] = useState([]);
  const [linkedOpportunities, setLinkedOpportunities] = useState([]);
  const [showOpportunityLink, setShowOpportunityLink] = useState(false);
  const [showOpportunityModal, setShowOpportunityModal] = useState(false);
  const [editingOpportunity, setEditingOpportunity] = useState(null);
  const [opportunityTagsDraft, setOpportunityTagsDraft] = useState([]);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMerchantId, setPaymentMerchantId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayKey());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [isPaymentSaving, setIsPaymentSaving] = useState(false);
  const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);
  const [isMerchantSaving, setIsMerchantSaving] = useState(false);
  const [isOpportunitySaving, setIsOpportunitySaving] = useState(false);

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusEdits, setStatusEdits] = useState({});
  const [newStatusName, setNewStatusName] = useState("");
  const [showControls, setShowControls] = useState(false);
  const [draggedStatus, setDraggedStatus] = useState("");
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showUnsortedKanban, setShowUnsortedKanban] = useState(true);
  const [recentHistory, setRecentHistory] = useState(appCache.history || []);
  const [historyPayments, setHistoryPayments] = useState(appCache.historyPayments || []);
  const [showHistory, setShowHistory] = useState(false);
  const [monthlyGoalBase, setMonthlyGoalBase] = useState(appCache.monthlySettings?.baseGoal || "");
  const [monthlyGoalStartMonth, setMonthlyGoalStartMonth] = useState(
    appCache.monthlySettings?.baseGoalMonth || currentMonthKey()
  );
  const [lastResetMonth, setLastResetMonth] = useState(appCache.monthlySettings?.lastResetMonth || "");
  const [isGoalSaving, setIsGoalSaving] = useState(false);
  const [csvImportMode, setCsvImportMode] = useState("replace");
  const [ageTick, setAgeTick] = useState(0);
  const [importNotice, setImportNotice] = useState(null);

  const boardRef = useRef(null);
  const topScrollRef = useRef(null);
  const topScrollInnerRef = useRef(null);
  const bottomScrollRef = useRef(null);
  const opportunityTopScrollRef = useRef(null);
  const opportunityTopScrollInnerRef = useRef(null);
  const opportunityBottomScrollRef = useRef(null);
  const isScrollSyncingRef = useRef(false);
  const isResettingRef = useRef(false);
  const fileInputRef = useRef(null);
  const opportunitiesRef = useRef([]);

  const currentFilters = filtersByView[view] || filtersByView.accounts || DEFAULT_FILTERS;
  const { search, tagFilters, touchedOnly, needWorkOnly, dueWeekOnly, increaseOnly, unsortedOnly, priorityFilters, sortKey, sortDirection } =
    currentFilters;

  const updateCurrentFilters = useCallback(
    (updates) => {
      setFiltersByView((prev) => {
        const current = prev[view] || DEFAULT_FILTERS;
        const next = typeof updates === "function" ? updates(current) : { ...current, ...updates };
        return { ...prev, [view]: next };
      });
    },
    [view]
  );

  useEffect(() => {
    if (initialView && view !== initialView) {
      setView(initialView);
    }
  }, [initialView, view]);

  useEffect(() => {
    appCache.filtersByView = filtersByView;
  }, [filtersByView]);

  useEffect(() => {
    appCache.monthKey = monthKey;
  }, [monthKey]);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error && String(error.message || "").toLowerCase().includes("refresh token")) {
        supabase.auth.signOut();
        setSession(null);
        appCache.session = null;
        setIsDataLoading(false);
        return;
      }
      setSession(data.session);
      appCache.session = data.session;
      setIsDataLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      appCache.session = nextSession;
    });
    return () => {
      isMounted = false;
      data?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    const timeout = setTimeout(() => {
      setAgeTick((value) => value + 1);
      const interval = setInterval(() => setAgeTick((value) => value + 1), 24 * 60 * 60 * 1000);
      return () => clearInterval(interval);
    }, msUntilMidnight);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const interval = setInterval(async () => {
      const { error } = await supabase.auth.getSession();
      if (error && String(error.message || "").toLowerCase().includes("refresh token")) {
        await supabase.auth.signOut();
        setSession(null);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!importNotice) return undefined;
    const timer = setTimeout(() => setImportNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [importNotice]);

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

  const normalizeTags = useCallback((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch {
          return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
        }
      }
      return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }, []);

  const loadSupabaseData = useCallback(async ({ silent } = {}) => {
    if (!session?.user?.id) return;
    if (!silent) setIsDataLoading(true);
    const userId = session.user.id;
    const [accountsResult, opportunitiesResult, paymentsResult, historyResult, statusesResult, settingsResult, historyPaymentsResult] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("opportunities").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
      supabase.from("payments").select("*").eq("user_id", userId),
      supabase.from("history_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
      supabase.from("statuses").select("*").eq("user_id", userId).order("sort_order", { ascending: true }),
      supabase.from("monthly_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("payments_history").select("*").eq("user_id", userId),
    ]);

    if (accountsResult.error) console.error("Accounts load error", accountsResult.error);
    if (opportunitiesResult.error) console.error("Opportunities load error", opportunitiesResult.error);
    if (paymentsResult.error) console.error("Payments load error", paymentsResult.error);
    if (historyResult.error) console.error("History load error", historyResult.error);
    if (statusesResult.error) console.error("Statuses load error", statusesResult.error);
    if (settingsResult?.error) console.error("Monthly settings load error", settingsResult.error);
    if (historyPaymentsResult?.error) console.error("Payments history load error", historyPaymentsResult.error);

    const paymentsByAccount = {};
    (paymentsResult.data || []).forEach((payment) => {
      if (!paymentsByAccount[payment.account_id]) paymentsByAccount[payment.account_id] = [];
      paymentsByAccount[payment.account_id].push({
        id: payment.id,
        date: payment.paid_date || "",
        amount: parseMoney(payment.amount),
      });
    });

    const loadedMerchants = (accountsResult.data || []).map((row) => ({
      id: row.id,
      merchant: row.merchant || "",
      client: row.client || "",
      status: row.status || "Unsorted",
      startDate: row.start_date || "",
      amount: row.amount || "",
      type: row.type || "",
      frequency: normalizeFrequency(row.frequency || ""),
      increaseDate: row.increase_date || "",
      notes: row.notes || "",
      addedDate: row.added_date || "",
      lastTouched: row.last_worked_at ? row.last_worked_at.split("T")[0] : "",
      tags: normalizeTags(row.tags),
      payments: paymentsByAccount[row.id] || [],
    }));

    const fallbackStatuses = ensureUnsortedStatus(
      Array.from(new Set(DEFAULT_STATUSES.concat(loadedMerchants.map((merchant) => merchant.status || "Unsorted"))))
    );
    let loadedStatuses = fallbackStatuses;

    if (!statusesResult.error && statusesResult.data && statusesResult.data.length > 0) {
      loadedStatuses = ensureUnsortedStatus(statusesResult.data.map((row) => row.name));
    } else if (!statusesResult.error && statusesResult.data && statusesResult.data.length === 0) {
      const seed = fallbackStatuses.map((name, index) => ({
        user_id: userId,
        name,
        sort_order: index,
      }));
      await supabase.from("statuses").insert(seed);
      loadedStatuses = fallbackStatuses;
    }

    const loadedOpportunities = (opportunitiesResult.data || []).map((row) => ({
      id: row.id,
      accountId: row.account_id || "",
      merchant: row.merchant || "",
      client: row.client || "",
      amount: row.amount || "",
      type: row.type || "",
      frequency: normalizeFrequency(row.frequency || ""),
      startDate: row.start_date || "",
      expectedCloseDate: row.expected_close_date || "",
      stage: row.stage || OPPORTUNITY_STAGES[0],
      paymentStatus: row.payment_status || "Unsorted",
      notes: row.notes || "",
      createdDate: row.created_at || "",
      paymentPlanMadeAt: row.payment_plan_made_at || "",
      convertedAccountId: row.converted_account_id || "",
      tags: normalizeTags(row.tags),
    }));

    const settings = settingsResult?.data || null;
    if (settings) {
      setMonthlyGoalBase(settings.base_goal ? String(settings.base_goal) : "");
      setMonthlyGoalStartMonth(settings.base_goal_month || currentMonthKey());
      setLastResetMonth(settings.last_reset_month || "");
    } else {
      setMonthlyGoalStartMonth((value) => value || currentMonthKey());
    }

    setHistoryPayments(historyPaymentsResult?.data || []);

    setMerchants(loadedMerchants);
    setStatuses(loadedStatuses);
    setOpportunities(loadedOpportunities);
    setRecentHistory(historyResult.data || []);
    setIsDataLoading(false);

    appCache.userId = userId;
    appCache.merchants = loadedMerchants;
    appCache.statuses = loadedStatuses;
    appCache.opportunities = loadedOpportunities;
    appCache.history = historyResult.data || [];
    appCache.historyPayments = historyPaymentsResult?.data || [];
    appCache.monthlySettings = settings
      ? {
          baseGoal: settings.base_goal ? String(settings.base_goal) : "",
          baseGoalMonth: settings.base_goal_month || currentMonthKey(),
          lastResetMonth: settings.last_reset_month || "",
        }
      : null;
  }, [session?.user?.id, normalizeTags]);

  useEffect(() => {
    if (!session?.user?.id) {
      setMerchants([]);
      setStatuses(ensureUnsortedStatus(DEFAULT_STATUSES.slice()));
      setOpportunities([]);
      setRecentHistory([]);
      setHistoryPayments([]);
      setIsDataLoading(false);
      appCache.userId = null;
      appCache.merchants = [];
      appCache.statuses = null;
      appCache.opportunities = [];
      appCache.history = [];
      appCache.historyPayments = [];
      appCache.monthlySettings = null;
      return;
    }

    const canUseCache = appCache.userId === session.user.id && appCache.merchants?.length;
    if (canUseCache) {
      setMerchants(appCache.merchants);
      setStatuses(appCache.statuses || ensureUnsortedStatus(DEFAULT_STATUSES.slice()));
      setOpportunities(appCache.opportunities || []);
      setRecentHistory(appCache.history || []);
      setHistoryPayments(appCache.historyPayments || []);
      if (appCache.monthlySettings) {
        setMonthlyGoalBase(appCache.monthlySettings.baseGoal || "");
        setMonthlyGoalStartMonth(appCache.monthlySettings.baseGoalMonth || currentMonthKey());
        setLastResetMonth(appCache.monthlySettings.lastResetMonth || "");
      }
      setIsDataLoading(false);
    }
    loadSupabaseData({ silent: canUseCache });
  }, [session?.user?.id, loadSupabaseData]);


  useEffect(() => {
    if (session?.user) {
      const meta = session.user.user_metadata || {};
      setProfileName(meta.full_name || "");
      setProfilePhone(meta.phone || "");
      setShowUnsortedKanban(meta.show_unsorted_kanban ?? true);
    }
  }, [session]);

  useEffect(() => {
    opportunitiesRef.current = opportunities;
  }, [opportunities]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const timer = setInterval(async () => {
      const cutoff = Date.now() - 30 * 60 * 1000;
      const expired = opportunitiesRef.current.filter((opportunity) => {
        if (opportunity.stage !== "Payment Plan Made") return false;
        if (!opportunity.paymentPlanMadeAt) return false;
        const time = new Date(opportunity.paymentPlanMadeAt).getTime();
        return Number.isFinite(time) && time <= cutoff;
      });
      if (!expired.length) return;
      const expiredIds = expired.map((item) => item.id);
      await supabase.from("opportunities").delete().in("id", expiredIds).eq("user_id", session.user.id);
      setOpportunities((prev) => prev.filter((item) => !expiredIds.includes(item.id)));
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [session?.user?.id]);

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

  const handleOpportunityTopScroll = () => {
    if (view !== "opportunities") return;
    if (isScrollSyncingRef.current) {
      isScrollSyncingRef.current = false;
      return;
    }
    const topEl = opportunityTopScrollRef.current;
    const bottomEl = opportunityBottomScrollRef.current;
    if (!topEl || !bottomEl) return;
    isScrollSyncingRef.current = true;
    bottomEl.scrollLeft = topEl.scrollLeft;
  };

  const handleOpportunityBottomScroll = () => {
    if (view !== "opportunities") return;
    if (isScrollSyncingRef.current) {
      isScrollSyncingRef.current = false;
      return;
    }
    const topEl = opportunityTopScrollRef.current;
    const bottomEl = opportunityBottomScrollRef.current;
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

  function updateOpportunityScroll() {
    if (view !== "opportunities") return;
    const topInner = opportunityTopScrollInnerRef.current;
    const bottomEl = opportunityBottomScrollRef.current;
    if (!topInner || !bottomEl) return;
    topInner.style.width = `${bottomEl.scrollWidth}px`;
    opportunityTopScrollRef.current.scrollLeft = bottomEl.scrollLeft;
  }

  useEffect(() => {
    if (view !== "payments") return;
    const raf = requestAnimationFrame(updateKanbanScroll);
    return () => cancelAnimationFrame(raf);
  }, [merchants, statuses, view, search, touchedOnly, needWorkOnly, dueWeekOnly, increaseOnly, priorityFilters]);

  useEffect(() => {
    if (view !== "opportunities") return;
    const raf = requestAnimationFrame(updateOpportunityScroll);
    return () => cancelAnimationFrame(raf);
  }, [view, opportunities]);

  useEffect(() => {
    const handleResize = () => updateKanbanScroll();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [view]);

  useEffect(() => {
    const handleResize = () => updateOpportunityScroll();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [view]);

  const filteredMerchants = useMemo(() => {
    const filtered = merchants
      .filter((merchant) => {
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          merchant.merchant.toLowerCase().includes(term) ||
          (merchant.client || "").toLowerCase().includes(term)
        );
      })
      .filter((merchant) => (tagFilters.length ? tagFilters.some((tag) => (merchant.tags || []).includes(tag)) : true))
      .filter((merchant) => (touchedOnly ? merchant.lastTouched === todayKey() : true))
      .filter((merchant) => (needWorkOnly ? isFollowUpOverdue(merchant) : true))
      .filter((merchant) => (dueWeekOnly ? isDueThisWeek(merchant) : true))
      .filter((merchant) => (increaseOnly ? Boolean(getIncreaseStatus(merchant)) : true))
      .filter((merchant) => (unsortedOnly ? (merchant.status || "Unsorted") === "Unsorted" : true))
      .filter((merchant) => {
        const anyPriority = Object.values(priorityFilters).some(Boolean);
        if (!anyPriority) return true;
        const bucket = getPriorityBucket(getAccountAgeDays(merchant));
        return priorityFilters[bucket];
      })
      .sort((a, b) => (a.status || "").localeCompare(b.status || "") || a.merchant.localeCompare(b.merchant));

    if (!sortKey) return filtered;
    const direction = sortDirection === "desc" ? -1 : 1;
    const priorityOrder = { p0: 0, p1: 1, p2: 2, p3: 3 };
    const getSortValue = (merchant) => {
      if (sortKey === "age") return getAccountAgeDays(merchant);
      if (sortKey === "priority") return priorityOrder[getPriorityBucket(getAccountAgeDays(merchant))] ?? 0;
      if (sortKey === "lastWorked") {
        const base = merchant.lastTouched || merchant.addedDate || "";
        const time = new Date(base).getTime();
        return Number.isNaN(time) ? null : time;
      }
      if (sortKey === "followUp") {
        const next = getNextFollowUpDate(merchant);
        if (!next) return null;
        const time = new Date(next).getTime();
        return Number.isNaN(time) ? null : time;
      }
      if (sortKey === "increase") {
        const time = new Date(merchant.increaseDate || "").getTime();
        return Number.isNaN(time) ? null : time;
      }
      return null;
    };

    return [...filtered].sort((a, b) => {
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (aValue === bValue) return 0;
      return aValue > bValue ? direction : -direction;
    });
  }, [
    merchants,
    search,
    tagFilters,
    touchedOnly,
    needWorkOnly,
    dueWeekOnly,
    increaseOnly,
    unsortedOnly,
    priorityFilters,
    sortKey,
    sortDirection,
    ageTick,
  ]);

  const monthTotal = useMemo(() => getMonthTotal(merchants, monthKey), [merchants, monthKey]);
  const paymentsToday = useMemo(() => getPaymentsToday(merchants), [merchants]);
  const touchedCount = useMemo(() => getTouchedCount(merchants), [merchants]);
  const overdueCount = useMemo(() => merchants.filter((merchant) => isFollowUpOverdue(merchant)).length, [merchants, ageTick]);
  const dueWeekCount = useMemo(() => merchants.filter((merchant) => isDueThisWeek(merchant)).length, [merchants, ageTick]);
  const increaseCount = useMemo(
    () => merchants.filter((merchant) => Boolean(getIncreaseStatus(merchant))).length,
    [merchants, ageTick]
  );
  const projectionTotals = useMemo(() => getMonthlyProjectionTotals(merchants, monthKey), [merchants, monthKey, ageTick]);
  const currentGoal = useMemo(() => {
    const base = parseMoney(monthlyGoalBase);
    if (!base) return 0;
    const diff = monthDiff(monthlyGoalStartMonth || monthKey, monthKey);
    return base + diff * 10000;
  }, [monthlyGoalBase, monthlyGoalStartMonth, monthKey]);
  const historyByMonth = useMemo(() => {
    const totals = {};
    (historyPayments || []).forEach((payment) => {
      const key = payment.month_key || monthKeyFromDate(payment.paid_date);
      if (!key) return;
      totals[key] = (totals[key] || 0) + parseMoney(payment.amount);
    });
    return Object.entries(totals)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([key, total]) => ({ key, total }));
  }, [historyPayments]);
  const opportunityForecast = useMemo(
    () => getOpportunityForecastTotal(opportunities),
    [opportunities]
  );
  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((opportunity) => {
      const term = search.trim().toLowerCase();
      const matchesSearch = !term ||
        opportunity.merchant.toLowerCase().includes(term) ||
        (opportunity.client || "").toLowerCase().includes(term);
      const matchesTags = !tagFilters.length || tagFilters.some((tag) => (opportunity.tags || []).includes(tag));
      return matchesSearch && matchesTags;
    });
  }, [opportunities, search, tagFilters]);

  const opportunitiesByStage = useMemo(() => {
    const grouped = {};
    OPPORTUNITY_STAGES.forEach((stage) => {
      grouped[stage] = [];
    });
    filteredOpportunities.forEach((opportunity) => {
      const stage = OPPORTUNITY_STAGES.includes(opportunity.stage) ? opportunity.stage : OPPORTUNITY_STAGES[0];
      grouped[stage].push(opportunity);
    });
    return grouped;
  }, [filteredOpportunities]);

  const handleToggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const handleToggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const getSortIndicator = (key) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? "▲" : "▼";
  };
  const handleSort = (key) =>
    updateCurrentFilters((current) => {
      if (current.sortKey !== key) {
        return { ...current, sortKey: key, sortDirection: "asc" };
      }
      if (current.sortDirection === "asc") {
        return { ...current, sortDirection: "desc" };
      }
      return { ...current, sortKey: "", sortDirection: "asc" };
    });
  const toggleTagFilter = (tag) =>
    updateCurrentFilters((current) => ({
      ...current,
      tagFilters: current.tagFilters.includes(tag)
        ? current.tagFilters.filter((item) => item !== tag)
        : current.tagFilters.concat(tag),
    }));
  const saveMonthlySettings = async () => {
    if (!session?.user?.id) return;
    const baseGoal = parseMoney(monthlyGoalBase);
    setIsGoalSaving(true);
    const payload = {
      user_id: session.user.id,
      base_goal: baseGoal,
      base_goal_month: monthlyGoalStartMonth || currentMonthKey(),
      last_reset_month: lastResetMonth || currentMonthKey(),
    };
    const { error } = await supabase.from("monthly_settings").upsert(payload, { onConflict: "user_id" });
    if (error) {
      window.alert(error.message);
    } else {
      setMonthlyGoalBase(baseGoal ? String(baseGoal) : "");
    }
    setIsGoalSaving(false);
  };

  const maybeResetMonthlyPayments = useCallback(async () => {
    if (!session?.user?.id) return;
    if (isResettingRef.current) return;
    const currentMonth = currentMonthKey();
    if (lastResetMonth === currentMonth) return;
    isResettingRef.current = true;
    try {
      const startOfMonth = `${currentMonth}-01`;
      const { data: oldPayments, error } = await supabase
        .from("payments")
        .select("*")
        .eq("user_id", session.user.id)
        .lt("paid_date", startOfMonth);
      if (error) {
        console.error("Monthly reset fetch error", error);
        return;
      }
      if (oldPayments && oldPayments.length) {
        const accountLookup = merchants.reduce((acc, merchant) => {
          acc[merchant.id] = merchant;
          return acc;
        }, {});
        const historyRows = oldPayments.map((payment) => {
          const account = accountLookup[payment.account_id] || {};
          return {
            user_id: session.user.id,
            account_id: payment.account_id,
            paid_date: payment.paid_date,
            amount: payment.amount,
            month_key: monthKeyFromDate(payment.paid_date),
            merchant: account.merchant || "",
            client: account.client || "",
          };
        });
        await supabase.from("payments_history").insert(historyRows);
        await supabase
          .from("payments")
          .delete()
          .eq("user_id", session.user.id)
          .lt("paid_date", startOfMonth);
      }
      const settingsPayload = {
        user_id: session.user.id,
        base_goal: parseMoney(monthlyGoalBase),
        base_goal_month: monthlyGoalStartMonth || currentMonth,
        last_reset_month: currentMonth,
      };
      await supabase.from("monthly_settings").upsert(settingsPayload, { onConflict: "user_id" });
      setLastResetMonth(currentMonth);
      if (oldPayments && oldPayments.length) {
        await loadSupabaseData();
      }
    } finally {
      isResettingRef.current = false;
    }
  }, [session?.user?.id, lastResetMonth, monthlyGoalBase, monthlyGoalStartMonth, merchants, loadSupabaseData]);

  useEffect(() => {
    if (!session?.user?.id || isDataLoading) return;
    maybeResetMonthlyPayments();
  }, [session?.user?.id, isDataLoading, maybeResetMonthlyPayments]);
  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    setIsAuthLoading(true);
    if (authMode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (error) setAuthError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
        options: {
          data: {
            full_name: authFullName,
            phone: authPhone,
          },
        },
      });
      if (error) setAuthError(error.message);
      if (!error) {
        setAuthError("Check your email to confirm your account.");
      }
    }
    setIsAuthLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    appCache.session = null;
  };

  const handleToggleUnsorted = async () => {
    const nextValue = !showUnsortedKanban;
    setShowUnsortedKanban(nextValue);
    await supabase.auth.updateUser({
      data: {
        show_unsorted_kanban: nextValue,
      },
    });
  };

  const handleOpenUserSettings = () => {
    router.push("/settings");
    setShowUserSettings(true);
  };

  const handleSendPasswordReset = async () => {
    if (!session?.user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(session.user.email);
    if (error) {
      window.alert(error.message);
      return;
    }
    window.alert("Password reset email sent.");
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    setIsProfileSaving(true);
    setProfileMessage("");
    const { data, error } = await supabase.auth.updateUser({
      data: {
        full_name: profileName,
        phone: profilePhone,
      },
    });
    if (error) {
      setProfileMessage(error.message);
      setIsProfileSaving(false);
      return;
    }
    if (data?.user) {
      setSession((prev) => (prev ? { ...prev, user: data.user } : prev));
    }
    setProfileMessage("Profile updated.");
    setIsProfileSaving(false);
    setShowProfileEditor(false);
  };
  const applyQuickFilter = (type) => {
    if (type === "overdue") {
      updateCurrentFilters({
        needWorkOnly: true,
        dueWeekOnly: false,
        increaseOnly: false,
        touchedOnly: false,
      });
      return;
    }
    if (type === "dueWeek") {
      updateCurrentFilters({
        needWorkOnly: false,
        dueWeekOnly: true,
        increaseOnly: false,
        touchedOnly: false,
      });
      return;
    }
    if (type === "increase") {
      updateCurrentFilters({
        needWorkOnly: false,
        dueWeekOnly: false,
        increaseOnly: true,
        touchedOnly: false,
      });
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

  const openMerchantModal = async (merchant = null) => {
    setEditingMerchant(merchant);
    setMerchantTagsDraft(merchant?.tags || []);
    setLinkedOpportunities([]);
    setShowOpportunityLink(false);
    setShowMerchantModal(true);
  };

  const closeMerchantModal = () => {
    setEditingMerchant(null);
    setShowMerchantModal(false);
  };

  const openOpportunityModal = (opportunity = null) => {
    setEditingOpportunity(opportunity);
    setOpportunityTagsDraft(opportunity?.tags || []);
    setShowOpportunityModal(true);
  };

  const closeOpportunityModal = () => {
    setEditingOpportunity(null);
    setShowOpportunityModal(false);
  };

  const upsertOpportunity = async (event) => {
    event.preventDefault();
    if (isOpportunitySaving) return;
    setIsOpportunitySaving(true);
    const form = event.target;
    const formData = new FormData(form);
    const payload = {
      id: formData.get("opportunityId") || "",
      merchant: String(formData.get("merchantName") || "").trim(),
      client: String(formData.get("clientName") || "").trim(),
      amount: String(formData.get("amount") || "").trim(),
      type: String(formData.get("type") || "").trim(),
      frequency: normalizeFrequency(String(formData.get("frequency") || "").trim()),
      startDate: String(formData.get("startDate") || "").trim(),
      expectedCloseDate: String(formData.get("expectedCloseDate") || "").trim(),
      stage: String(formData.get("stage") || "").trim() || OPPORTUNITY_STAGES[0],
      paymentStatus: String(formData.get("paymentStatus") || "").trim(),
      notes: String(formData.get("notes") || "").trim(),
      accountId: String(formData.get("accountId") || "").trim(),
      tags: opportunityTagsDraft,
    };

    if (!payload.merchant || !session?.user?.id) {
      setIsOpportunitySaving(false);
      return;
    }

    const record = {
      user_id: session.user.id,
      account_id: payload.accountId || null,
      merchant: payload.merchant,
      client: payload.client,
      amount: payload.amount,
      type: payload.type,
      frequency: payload.frequency,
      start_date: payload.startDate,
      expected_close_date: payload.expectedCloseDate,
      stage: payload.stage,
      payment_status: payload.paymentStatus,
      notes: payload.notes,
      tags: payload.tags,
    };

    try {
      let linkedAccountId = record.account_id || "";
      if (!linkedAccountId) {
        const match = merchants.find(
          (merchant) =>
            merchant.merchant.trim().toLowerCase() === payload.merchant.trim().toLowerCase() &&
            String(merchant.client || "").trim().toLowerCase() === payload.client.trim().toLowerCase()
        );
        if (match?.id) {
          linkedAccountId = match.id;
          record.account_id = linkedAccountId;
        }
      }

      if (payload.id) {
        await supabase.from("opportunities").update(record).eq("id", payload.id).eq("user_id", session.user.id);
      } else {
        const { data } = await supabase.from("opportunities").insert([record]).select("id").single();
        if (data?.id) payload.id = data.id;
      }

      if (linkedAccountId && record.account_id) {
        if (payload.id) {
          await supabase
            .from("opportunities")
            .update({ account_id: linkedAccountId })
            .eq("id", payload.id)
            .eq("user_id", session.user.id);
        }
        await touchAccount(linkedAccountId, "worked", `Updated opportunity ${payload.merchant}`);
      }
      await loadSupabaseData();
      closeOpportunityModal();
    } finally {
      setIsOpportunitySaving(false);
    }
  };

  const deleteOpportunity = async (opportunityId) => {
    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!opportunity) return;
    if (!window.confirm(`Delete opportunity for ${opportunity.merchant}?`)) return;
    if (!session?.user?.id) return;
    await supabase.from("opportunities").delete().eq("id", opportunityId).eq("user_id", session.user.id);
    setOpportunities((prev) => prev.filter((item) => item.id !== opportunityId));
  };

  const logHistory = async ({ entityType, entityId, action, details }) => {
    if (!session?.user?.id) return;
    await supabase.from("history_logs").insert([
      {
        user_id: session.user.id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        details,
      },
    ]);
    const { data } = await supabase
      .from("history_logs")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setRecentHistory(data);
  };

  const touchAccount = async (accountId, action, details) => {
    if (!session?.user?.id) return;
    await supabase
      .from("accounts")
      .update({ last_worked_at: new Date().toISOString() })
      .eq("id", accountId)
      .eq("user_id", session.user.id);
    await logHistory({
      entityType: "account",
      entityId: accountId,
      action,
      details,
    });
  };

  const hasPaymentPlanCriteria = (opportunity) => {
    return Boolean(
      String(opportunity.amount || "").trim() &&
        String(opportunity.frequency || "").trim() &&
        String(opportunity.startDate || "").trim() &&
        String(opportunity.paymentStatus || "").trim()
    );
  };

  const createAccountFromOpportunity = async (opportunity) => {
    if (!session?.user?.id) return null;
    const payload = {
      user_id: session.user.id,
      merchant: opportunity.merchant,
      client: opportunity.client,
      status: opportunity.paymentStatus || "Unsorted",
      start_date: opportunity.startDate || "",
      amount: opportunity.amount || "",
      type: opportunity.type || "",
      frequency: normalizeFrequency(opportunity.frequency || ""),
      increase_date: "",
      notes: opportunity.notes ? `Converted from opportunity: ${opportunity.notes}` : "Converted from opportunity",
      added_date: todayKey(),
      last_worked_at: new Date().toISOString(),
      tags: opportunity.tags || [],
    };
    const { data, error } = await supabase.from("accounts").insert([payload]).select("id").single();
    if (error) {
      console.error("Convert opportunity error", error);
      window.alert("Unable to convert opportunity. Please try again.");
      return null;
    }
    await logHistory({
      entityType: "opportunity",
      entityId: opportunity.id,
      action: "converted_to_account",
      details: `Converted to account ${data.id}`,
    });
    return data.id;
  };

  const updateOpportunityStage = async (opportunityId, stage) => {
    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || !session?.user?.id) return;
    let linkedAccountId = opportunity.accountId || "";
    if (!linkedAccountId) {
      const match = merchants.find(
        (merchant) =>
          merchant.merchant.trim().toLowerCase() === String(opportunity.merchant || "").trim().toLowerCase() &&
          String(merchant.client || "").trim().toLowerCase() === String(opportunity.client || "").trim().toLowerCase()
      );
      if (match?.id) {
        linkedAccountId = match.id;
        await supabase
          .from("opportunities")
          .update({ account_id: linkedAccountId })
          .eq("id", opportunityId)
          .eq("user_id", session.user.id);
      }
    }

    if (stage === "Payment Plan Made" && !hasPaymentPlanCriteria(opportunity)) {
      window.alert("Payment Plan Made requires amount, frequency, start date, and status.");
      return;
    }

    let convertedAccountId = opportunity.convertedAccountId || "";
    let paymentPlanMadeAt = opportunity.paymentPlanMadeAt || "";

    if (stage === "Payment Plan Made") {
      if (!convertedAccountId) {
        const createdId = await createAccountFromOpportunity(opportunity);
        if (!createdId) return;
        convertedAccountId = createdId;
      }
      paymentPlanMadeAt = new Date().toISOString();
    }

    if (stage !== "Payment Plan Made" && convertedAccountId) {
      await supabase.from("accounts").delete().eq("id", convertedAccountId).eq("user_id", session.user.id);
      convertedAccountId = "";
      paymentPlanMadeAt = "";
    }

    await supabase
      .from("opportunities")
      .update({
        stage,
        payment_plan_made_at: paymentPlanMadeAt || null,
        converted_account_id: convertedAccountId || null,
      })
      .eq("id", opportunityId)
      .eq("user_id", session.user.id);

    if (linkedAccountId) {
      await touchAccount(linkedAccountId, "worked", `Worked from opportunity stage move: ${stage}`);
    }

    await logHistory({
      entityType: "opportunity",
      entityId: opportunityId,
      action: "stage_change",
      details: `Moved to ${stage}`,
    });

    await loadSupabaseData();
  };

  const convertOpportunityToAccount = async (opportunity) => {
    if (!opportunity || !session?.user?.id) return;
    if (!hasPaymentPlanCriteria(opportunity)) {
      window.alert("Payment Plan Made requires amount, frequency, start date, and status.");
      return;
    }
    const createdId = await createAccountFromOpportunity(opportunity);
    if (!createdId) return;
    await supabase
      .from("opportunities")
      .update({
        stage: "Payment Plan Made",
        payment_plan_made_at: new Date().toISOString(),
        converted_account_id: createdId,
      })
      .eq("id", opportunity.id)
      .eq("user_id", session.user.id);
    await loadSupabaseData();
  };

  const convertAccountToOpportunity = async (merchant) => {
    if (!merchant || !session?.user?.id) return;
    const record = {
      user_id: session.user.id,
      account_id: merchant.id,
      merchant: merchant.merchant,
      client: merchant.client,
      amount: merchant.amount,
      type: merchant.type,
      frequency: normalizeFrequency(merchant.frequency || ""),
      start_date: merchant.startDate || "",
      expected_close_date: "",
      stage: "Lead",
      payment_status: merchant.status || "Unsorted",
      notes: merchant.notes ? `Converted from account: ${merchant.notes}` : "Converted from account",
      tags: merchant.tags || [],
    };
    await supabase.from("opportunities").insert([record]);
    await logHistory({
      entityType: "account",
      entityId: merchant.id,
      action: "converted_to_opportunity",
      details: "Converted to opportunity Lead",
    });
    await loadSupabaseData();
  };

  const upsertMerchant = async (event) => {
    event.preventDefault();
    if (isMerchantSaving) return;
    setIsMerchantSaving(true);
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
      tags: merchantTagsDraft,
    };

    if (!payload.merchant || !session?.user?.id) {
      setIsMerchantSaving(false);
      return;
    }

    const record = {
      user_id: session.user.id,
      merchant: payload.merchant,
      client: payload.client,
      status: payload.status,
      start_date: payload.startDate,
      amount: payload.amount,
      type: payload.type,
      frequency: payload.frequency,
      increase_date: payload.increaseDate,
      notes: payload.notes,
      added_date: payload.addedDate,
      last_worked_at: payload.lastTouched || new Date().toISOString(),
      tags: payload.tags,
    };

    try {
      if (payload.id) {
        await supabase.from("accounts").update(record).eq("id", payload.id).eq("user_id", session.user.id);
        await touchAccount(payload.id, "updated", `Updated ${payload.merchant}`);
      } else {
        const { data } = await supabase.from("accounts").insert([record]).select("id").single();
        if (data?.id) {
          await touchAccount(data.id, "created", `Created ${payload.merchant}`);
        }
      }
      await loadSupabaseData();
      closeMerchantModal();
    } finally {
      setIsMerchantSaving(false);
    }
  };

  const deleteMerchant = async (merchantId) => {
    const merchant = merchants.find((item) => item.id === merchantId);
    if (!merchant) return;
    if (!window.confirm(`Delete ${merchant.merchant}?`)) return;
    if (!session?.user?.id) return;
    const { error: paymentsError } = await supabase
      .from("payments")
      .delete()
      .eq("account_id", merchantId)
      .eq("user_id", session.user.id);
    if (paymentsError) {
      window.alert(paymentsError.message);
      return;
    }
    const { error: accountsError } = await supabase
      .from("accounts")
      .delete()
      .eq("id", merchantId)
      .eq("user_id", session.user.id);
    if (accountsError) {
      window.alert(accountsError.message);
      return;
    }
    await loadSupabaseData();
  };

  const deletePayment = async (paymentId, accountId) => {
    if (!session?.user?.id) return;
    const { error } = await supabase
      .from("payments")
      .delete()
      .eq("id", paymentId)
      .eq("user_id", session.user.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    await logHistory({
      entityType: "account",
      entityId: accountId,
      action: "payment_deleted",
      details: "Payment deleted",
    });
    await loadSupabaseData();
  };

  const openLinkedOpportunities = async () => {
    if (!editingMerchant?.id || !session?.user?.id) return;
    const { data, error } = await supabase
      .from("opportunities")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("account_id", editingMerchant.id)
      .order("created_at", { ascending: false });
    if (error) {
      window.alert(error.message);
      return;
    }
    const mapped = (data || []).map((row) => ({
      id: row.id,
      accountId: row.account_id || "",
      merchant: row.merchant || "",
      client: row.client || "",
      amount: row.amount || "",
      type: row.type || "",
      frequency: normalizeFrequency(row.frequency || ""),
      startDate: row.start_date || "",
      expectedCloseDate: row.expected_close_date || "",
      stage: row.stage || OPPORTUNITY_STAGES[0],
      paymentStatus: row.payment_status || "Unsorted",
      notes: row.notes || "",
      createdDate: row.created_at || "",
      paymentPlanMadeAt: row.payment_plan_made_at || "",
      convertedAccountId: row.converted_account_id || "",
      tags: normalizeTags(row.tags),
    }));
    setLinkedOpportunities(mapped);
    setShowOpportunityLink(true);
  };

  const getAccountDedupKey = (merchant) => {
    const merchantName = String(merchant.merchant || "").trim().toLowerCase();
    const clientName = String(merchant.client || "").trim().toLowerCase();
    const startDate = String(merchant.startDate || "").trim();
    const amount = String(parseMoney(merchant.amount || "")).trim();
    return `${merchantName}|${clientName}|${startDate}|${amount}`;
  };

  const addPayment = async (event) => {
    event.preventDefault();
    if (isPaymentSaving) return;
    const amount = parseMoney(paymentAmount);
    if (!session?.user?.id) return;
    setIsPaymentSaving(true);
    try {
      await supabase.from("payments").insert([
        {
          user_id: session.user.id,
          account_id: paymentMerchantId,
          paid_date: paymentDate,
          amount: String(amount),
        },
      ]);
      await supabase
        .from("accounts")
        .update({ last_worked_at: new Date().toISOString() })
        .eq("id", paymentMerchantId)
        .eq("user_id", session.user.id);
      await logHistory({
        entityType: "account",
        entityId: paymentMerchantId,
        action: "payment_logged",
        details: `Payment logged ${formatMoney(amount)}`,
      });
      await loadSupabaseData();
      setShowPaymentModal(false);
      setShowQuickPaymentModal(false);
      setPaymentAmount("");
    } finally {
      setIsPaymentSaving(false);
    }
  };

  const markTouched = async (merchantId) => {
    if (!session?.user?.id) return;
    await supabase.from("accounts").update({ last_worked_at: new Date().toISOString() }).eq("id", merchantId).eq("user_id", session.user.id);
    await logHistory({
      entityType: "account",
      entityId: merchantId,
      action: "worked",
      details: "Marked worked",
    });
    await loadSupabaseData();
  };

  const markOpportunityWorked = async (opportunity) => {
    if (!session?.user?.id || !opportunity) return;
    let accountId = opportunity.accountId || "";
    if (!accountId) {
      const match = merchants.find(
        (merchant) =>
          merchant.merchant.trim().toLowerCase() === String(opportunity.merchant || "").trim().toLowerCase() &&
          String(merchant.client || "").trim().toLowerCase() === String(opportunity.client || "").trim().toLowerCase()
      );
      if (match?.id) {
        accountId = match.id;
        await supabase
          .from("opportunities")
          .update({ account_id: accountId })
          .eq("id", opportunity.id)
          .eq("user_id", session.user.id);
      }
    }
    if (!accountId) {
      window.alert("This opportunity is not linked to an account yet.");
      return;
    }
    await touchAccount(accountId, "worked", `Worked from opportunity ${opportunity.merchant}`);
    await loadSupabaseData();
  };

  const moveMerchant = async (merchantId, status) => {
    if (!session?.user?.id) return;
    await supabase
      .from("accounts")
      .update({ status, last_worked_at: new Date().toISOString() })
      .eq("id", merchantId)
      .eq("user_id", session.user.id);
    await logHistory({
      entityType: "account",
      entityId: merchantId,
      action: "status_change",
      details: `Status moved to ${status}`,
    });
    await loadSupabaseData();
  };

  const handleImportCsv = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = parseCsvImport(reader.result || "");
        if (result.error) {
          setImportNotice({ type: "error", message: result.error });
          return;
        }
        const confirmMessage =
          csvImportMode === "append"
            ? "Append this CSV to existing accounts? Duplicate rows will be skipped."
            : "Reset and replace all existing accounts with this CSV?";
        if (!window.confirm(confirmMessage)) return;
        if (!session?.user?.id) return;
        if (csvImportMode === "replace") {
          const { error: paymentsError } = await supabase.from("payments").delete().eq("user_id", session.user.id);
          if (paymentsError) {
            setImportNotice({ type: "error", message: paymentsError.message });
            return;
          }
          const { error: accountsDeleteError } = await supabase.from("accounts").delete().eq("user_id", session.user.id);
          if (accountsDeleteError) {
            setImportNotice({ type: "error", message: accountsDeleteError.message });
            return;
          }
        }
        const existingKeys = new Set(
          csvImportMode === "append" ? merchants.map((merchant) => getAccountDedupKey(merchant)) : []
        );
        const records = result.merchants
          .filter((merchant) => {
            if (csvImportMode !== "append") return true;
            const key = getAccountDedupKey(merchant);
            if (existingKeys.has(key)) return false;
            existingKeys.add(key);
            return true;
          })
          .map((merchant) => ({
          last_worked_at: (() => {
            if (!merchant.lastTouched) return null;
            const parsed = new Date(merchant.lastTouched);
            return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
          })(),
          user_id: session.user.id,
          merchant: merchant.merchant,
          client: merchant.client,
          status: merchant.status,
          start_date: merchant.startDate,
          amount: merchant.amount,
          type: merchant.type,
          frequency: merchant.frequency,
          increase_date: merchant.increaseDate,
          notes: merchant.notes,
          added_date: merchant.addedDate,
        }));
        if (records.length) {
          const { error: insertError } = await supabase.from("accounts").insert(records);
          if (insertError) {
            setImportNotice({ type: "error", message: insertError.message });
            return;
          }
        }
        await loadSupabaseData();
        const verb = csvImportMode === "append" ? "Appended" : "Imported";
        setImportNotice({ type: "success", message: `${verb} ${records.length} accounts.` });
      } catch (error) {
        setImportNotice({
          type: "error",
          message: error?.message || "Import failed. Please try again.",
        });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const formatCurrencyInput = (event) => {
    const raw = String(event.target.value || "").trim();
    if (!raw) {
      event.target.value = "";
      return;
    }
    const amount = parseMoney(raw);
    event.target.value = formatMoney(amount);
  };

  const formatPaymentInput = () => {
    const raw = String(paymentAmount || "").trim();
    if (!raw) {
      setPaymentAmount("");
      return;
    }
    const amount = parseMoney(raw);
    setPaymentAmount(formatMoney(amount));
  };

  const handleExportCsv = () => {
    const csv = exportCsvData(merchants, monthKey);
    downloadBlob(csv, `arg-crm-${monthKey}.csv`);
  };

  const handleExportTemplate = () => {
    const csv = exportTemplateCsv(statuses);
    downloadBlob(csv, "ResolveOS Template.csv");
  };

  const exportHistoryCsv = () => {
    const headers = ["Month", "Merchant", "Client", "Paid Date", "Amount"];
    const rows = historyPayments.map((payment) => [
      payment.month_key || monthKeyFromDate(payment.paid_date),
      payment.merchant || "",
      payment.client || "",
      payment.paid_date || "",
      payment.amount || "",
    ]);
    const csv = [headers, ...rows]
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
    downloadBlob(csv, "ResolveOS Payments History.csv");
  };

  const clearHistory = async () => {
    if (!session?.user?.id) return;
    if (!window.confirm("Delete all historical payments from storage?")) return;
    const { error } = await supabase.from("payments_history").delete().eq("user_id", session.user.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    setHistoryPayments([]);
  };

  const resetData = async () => {
    if (!window.confirm("Reset local data and clear imported accounts?")) return;
    if (!session?.user?.id) return;
    await supabase.from("payments").delete().eq("user_id", session.user.id);
    await supabase.from("accounts").delete().eq("user_id", session.user.id);
    await supabase.from("opportunities").delete().eq("user_id", session.user.id);
    await supabase.from("statuses").delete().eq("user_id", session.user.id);
    setMerchants([]);
    setStatuses(ensureUnsortedStatus(DEFAULT_STATUSES.slice()));
    setOpportunities([]);
  };

  const openPaymentModal = (merchant) => {
    setPaymentMerchantId(merchant.id);
    setPaymentDate(todayKey());
    setPaymentAmount("");
    setShowPaymentModal(true);
  };

  const closePaymentModal = () => setShowPaymentModal(false);
  const openQuickPaymentModal = () => {
    if (!merchants.length) {
      window.alert("Add an account before logging a payment.");
      return;
    }
    const firstId = merchants[0]?.id || "";
    setPaymentMerchantId(firstId);
    setPaymentDate(todayKey());
    setPaymentAmount("");
    setShowQuickPaymentModal(true);
  };
  const closeQuickPaymentModal = () => setShowQuickPaymentModal(false);
  const closeControlsModal = () => setShowControls(false);

  const openStatusModal = () => {
    setStatusEdits({});
    setNewStatusName("");
    setShowControls(false);
    setShowStatusModal(true);
  };

  const closeStatusModal = () => setShowStatusModal(false);

  const handleRenameStatus = async (status) => {
    const newValue = (statusEdits[status] || status).trim();
    if (!newValue || newValue === status) return;
    if (statuses.includes(newValue)) {
      window.alert("Status already exists.");
      return;
    }
    if (!session?.user?.id) return;
    await supabase.from("accounts").update({ status: newValue }).eq("status", status).eq("user_id", session.user.id);
    await supabase
      .from("statuses")
      .update({ name: newValue })
      .eq("name", status)
      .eq("user_id", session.user.id);
    setStatusEdits((prev) => {
      const next = { ...prev };
      delete next[status];
      return next;
    });
    await loadSupabaseData();
  };

  const handleDeleteStatus = async (status) => {
    if (status === "Unsorted") return;
    if (!session?.user?.id) return;
    await supabase
      .from("accounts")
      .update({ status: "Unsorted" })
      .eq("status", status)
      .eq("user_id", session.user.id);
    await supabase.from("statuses").delete().eq("name", status).eq("user_id", session.user.id);
    await loadSupabaseData();
  };

  const handleAddStatus = async (event) => {
    event.preventDefault();
    const trimmed = newStatusName.trim();
    if (!trimmed) return;
    if (statuses.includes(trimmed)) {
      window.alert("Status already exists.");
      return;
    }
    if (!session?.user?.id) return;
    const order = statuses.length;
    await supabase.from("statuses").insert([
      {
        user_id: session.user.id,
        name: trimmed,
        sort_order: order,
      },
    ]);
    setNewStatusName("");
    await loadSupabaseData();
  };

  const handleDrop = (event, status) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    moveMerchant(id, status);
  };

  const reorderStatuses = async (fromStatus, toStatus) => {
    if (fromStatus === "Unsorted" || toStatus === "Unsorted") return;
    const list = [...statuses];
    const fromIndex = list.indexOf(fromStatus);
    const toIndex = list.indexOf(toStatus);
    if (fromIndex === -1 || toIndex === -1) return;
    list.splice(fromIndex, 1);
    list.splice(toIndex, 0, fromStatus);
    const unsortedIndex = list.indexOf("Unsorted");
    if (unsortedIndex !== -1 && unsortedIndex !== list.length - 1) {
      list.splice(unsortedIndex, 1);
      list.push("Unsorted");
    }
    setStatuses(list);
    if (!session?.user?.id) return;
    const updates = list.map((name, index) => ({
      user_id: session.user.id,
      name,
      sort_order: index,
    }));
    await supabase.from("statuses").upsert(updates, { onConflict: "user_id,name" });
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

  const paymentStatuses = useMemo(() => {
    if (showUnsortedKanban) return orderedStatuses;
    return orderedStatuses.filter((status) => status !== "Unsorted");
  }, [orderedStatuses, showUnsortedKanban]);
  if (isDataLoading && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-steel/60">
        Loading...
      </div>
    );
  }

  if (!session && !isDataLoading) {
    return (
      <div className="auth-shell min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50 px-6 py-10 flex items-center justify-center">
        <div className="w-full max-w-lg">
          <div className="glass rounded-3xl p-8 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="auth-logo h-14 w-14 rounded-2xl shadow-sm ring-1 ring-white/70 grid place-items-center">
                <img src="/ARG Hub Logo.svg" alt="ResolveOS" className="h-11 w-11 object-contain drop-shadow-[0_8px_16px_rgba(10,15,26,0.35)]" />
              </div>
              <div>
                <p className="auth-brand text-sm uppercase tracking-[0.32em]">ResolveOS</p>
                <h1 className="text-2xl font-semibold">{authMode === "signin" ? "Sign in" : "Create account"}</h1>
              </div>
            </div>
            <form className="mt-6 grid gap-4" onSubmit={handleAuthSubmit}>
              {authMode === "signup" && (
                <>
                  <label className="text-sm">
                    Full name
                    <input
                      type="text"
                      required
                      value={authFullName}
                      onChange={(event) => setAuthFullName(event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm">
                    Phone number
                    <input
                      type="tel"
                      required
                      value={authPhone}
                      onChange={(event) => setAuthPhone(event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                    />
                  </label>
                </>
              )}
              <label className="text-sm">
                Email
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Password
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              {authError && <p className="text-xs text-coral">{authError}</p>}
              <button
                type="submit"
                disabled={isAuthLoading}
                className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white shadow-glow"
              >
                {isAuthLoading ? "Please wait..." : authMode === "signin" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="text-sm text-steel/70"
                onClick={() => setAuthMode((prev) => (prev === "signin" ? "signup" : "signin"))}
              >
                {authMode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside
        id="sidebar"
        className="glass min-h-screen w-full border-b border-white/70 px-6 py-6 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r flex flex-col"
      >
        <div id="sidebarHeader" className="flex items-center gap-3">
          <div className="sidebar-logo h-12 w-12 rounded-2xl text-white grid place-items-center shadow-sm ring-1 ring-white/70">
            <img src="/ARG Hub Logo.svg" alt="ARG Hub Logo" className="h-11 w-11 object-contain drop-shadow-[0_6px_12px_rgba(10,15,26,0.35)]" />
          </div>
          <div id="sidebarHeaderText">
            <p className="app-brand text-base">ResolveOS</p>
          </div>
        </div>
        <nav className="mt-8 grid gap-2">
          {[
            {
              key: "accounts",
              label: "Accounts",
              path: "/accounts",
              icon: (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                  <path d="M7 8h10M7 12h10M7 16h6"></path>
                </svg>
              ),
            },
            {
              key: "opportunities",
              label: "Opportunities",
              path: "/opportunities",
              icon: (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3v18"></path>
                  <path d="M5 12h14"></path>
                  <path d="M6.5 6.5l3 3-3 3"></path>
                </svg>
              ),
            },
            {
              key: "payments",
              label: "Payments",
              path: "/payments",
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
              path: "/dashboard",
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
              path: "/settings",
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
              onClick={() => router.push(item.path)}
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
          <button
            type="button"
            className="sidebar-profile flex w-full items-center gap-3 rounded-2xl border border-steel/10 bg-white/70 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md"
            onClick={handleOpenUserSettings}
          >
            <div className="sidebar-avatar h-10 w-10 rounded-full bg-ink text-white grid place-items-center text-sm font-semibold">
              {(profileName || session?.user?.email || "User")
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <p className="sidebar-profile-name text-sm font-semibold text-ink">
                {profileName || session?.user?.email || "User"}
              </p>
              <p className="sidebar-profile-role text-xs text-steel/60">Accounts Manager</p>
            </div>
          </button>
        </div>
      </aside>

      <div
        id="mainContent"
        className={`flex-1 min-w-0 px-6 py-6 md:px-10 ${
          view === "accounts" ? "lg:h-screen lg:overflow-hidden" : ""
        }`}
      >
        <input
          id="csvInput"
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImportCsv}
        />
        {importNotice && (
          <div
            className={`fixed right-6 top-6 z-50 max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              importNotice.type === "error"
                ? "border-coral/30 bg-coral/10 text-coral"
                : "border-emerald-200/60 bg-emerald-50/80 text-emerald-700"
            }`}
            role="status"
          >
            {importNotice.message}
          </div>
        )}
        <div className="top-header sticky top-0 z-20 -mx-6 border-b border-white/70 bg-white/85 px-6 pb-4 pt-5 backdrop-blur-xl md:-mx-10 md:px-10 md:pb-6 md:pt-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
                <h1 id="pageTitle" className="text-2xl font-semibold">
                  {view === "accounts"
                    ? "Accounts Overview"
                    : view === "opportunities"
                    ? "Opportunities Pipeline"
                    : view === "dashboard"
                    ? "Dashboard Overview"
                    : view === "payments"
                  ? "Payments Overview"
                  : "Settings"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {(view === "accounts" || view === "payments") && (
                <>
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
                    data-action="toggleSidebar"
                    className="hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  {view === "accounts" && (
                    <button
                      id="addMerchant"
                      className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5"
                      onClick={() => openMerchantModal()}
                    >
                      Add Merchant
                    </button>
                  )}
                  {view === "payments" && (
                    <button
                      id="logPayment"
                      className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5"
                      onClick={openQuickPaymentModal}
                    >
                      Log Payment
                    </button>
                  )}
                </>
              )}
              {view === "opportunities" && (
                <button
                  id="addOpportunity"
                  className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5"
                  onClick={() => openOpportunityModal()}
                >
                  Add Opportunity
                </button>
              )}
            </div>
          </header>
        </div>

        {view === "accounts" && (
          <section className="mt-4 space-y-3">
            <div className="stat-strip glass rounded-3xl px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Today</p>
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                    {touchedCount} worked
                  </span>
                </div>
                <div className="flex w-full flex-1 justify-center">
                  <div className="relative w-full max-w-xl">
                    <svg
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel/50"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <circle cx="11" cy="11" r="7"></circle>
                      <path d="M21 21l-3.5-3.5"></path>
                    </svg>
                    <input
                      type="search"
                      placeholder="Search merchant or client..."
                      value={search}
                      onChange={(event) => updateCurrentFilters({ search: event.target.value })}
                      className="w-full rounded-full border border-steel/10 bg-white/80 py-2 pl-9 pr-4 text-sm text-ink shadow-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="stat-chip min-w-[150px] rounded-2xl border border-steel/10 bg-white/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Payments Logged</p>
                    <p className="text-base font-semibold">{formatMoney(paymentsToday)}</p>
                  </div>
                  <div className="stat-chip min-w-[150px] rounded-2xl border border-steel/10 bg-white/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Month Total</p>
                    <p className="text-base font-semibold">{formatMoney(monthTotal)}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "payments" && (
          <section className="mt-4 space-y-3">
            <div className="stat-strip glass rounded-3xl px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Today</p>
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                    {touchedCount} worked
                  </span>
                </div>
                <div className="flex w-full flex-1 justify-center">
                  <div className="relative w-full max-w-xl">
                    <svg
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel/50"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <circle cx="11" cy="11" r="7"></circle>
                      <path d="M21 21l-3.5-3.5"></path>
                    </svg>
                    <input
                      type="search"
                      placeholder="Search merchant or client..."
                      value={search}
                      onChange={(event) => updateCurrentFilters({ search: event.target.value })}
                      className="w-full rounded-full border border-steel/10 bg-white/80 py-2 pl-9 pr-4 text-sm text-ink shadow-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="stat-chip min-w-[150px] rounded-2xl border border-steel/10 bg-white/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Payments Logged</p>
                    <p className="text-base font-semibold">{formatMoney(paymentsToday)}</p>
                  </div>
                  <div className="stat-chip min-w-[150px] rounded-2xl border border-steel/10 bg-white/70 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Month Total</p>
                    <p className="text-base font-semibold">{formatMoney(monthTotal)}</p>
                  </div>
                  <button
                    className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white shadow-glow"
                    onClick={openQuickPaymentModal}
                  >
                    Log Payment
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        <main className="mt-6">
          {view === "dashboard" && (
            <section id="dashboardView">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Monthly Performance</p>
                  <h2 className="text-lg font-semibold">Current vs Historical</h2>
                </div>
                <button
                  className="rounded-full border border-steel/10 bg-white px-4 py-2 text-xs font-semibold text-steel/70 shadow-sm"
                  onClick={() => setShowHistory((prev) => !prev)}
                >
                  {showHistory ? "Hide History" : "Show History"}
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-4">
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Expected Cash-In</p>
                  <p className="mt-2 text-3xl font-semibold">{formatMoney(projectionTotals.expected)}</p>
                  <p className="mt-1 text-xs text-steel/60">Active payment plans</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">At-Risk</p>
                  <p className="mt-2 text-3xl font-semibold">{formatMoney(projectionTotals.atRisk)}</p>
                  <p className="mt-1 text-xs text-steel/60">Defaulted accounts this month</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Pipeline Forecast</p>
                  <p className="mt-2 text-3xl font-semibold">{formatMoney(opportunityForecast)}</p>
                  <p className="mt-1 text-xs text-steel/60">Weighted opportunity value</p>
                </div>
                <div className="glass rounded-3xl p-5 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Collected</p>
                  <p className="mt-2 text-3xl font-semibold">{formatMoney(monthTotal)}</p>
                  <p className="mt-1 text-xs text-steel/60">Payments logged</p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Monthly Goal</p>
                  <h2 className="mt-2 text-lg font-semibold">Auto +$10k Each Month</h2>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-steel/70">
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                      Base: {formatMoney(parseMoney(monthlyGoalBase))}
                    </span>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                      Current goal: {formatMoney(currentGoal)}
                    </span>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Remaining: {formatMoney(Math.max(0, currentGoal - monthTotal))}
                    </span>
                  </div>
                </div>
                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Goal Settings</p>
                  <h2 className="mt-2 text-lg font-semibold">Set Base Month</h2>
                  <div className="mt-4 grid gap-3">
                    <label className="text-xs text-steel/60">
                      Base goal
                      <input
                        type="text"
                        inputMode="decimal"
                        value={monthlyGoalBase}
                        onChange={(event) => setMonthlyGoalBase(event.target.value)}
                        onBlur={formatCurrencyInput}
                        className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-steel/60">
                      Base month
                      <input
                        type="month"
                        value={monthlyGoalStartMonth}
                        onChange={(event) => setMonthlyGoalStartMonth(event.target.value)}
                        className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white"
                      onClick={saveMonthlySettings}
                      disabled={isGoalSaving}
                    >
                      {isGoalSaving ? "Saving..." : "Save Goal"}
                    </button>
                  </div>
                </div>
              </div>
              {showHistory && (
                <div className="mt-5 glass rounded-3xl p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Historical Payments</p>
                      <h2 className="mt-2 text-lg font-semibold">Prior Months Summary</h2>
                    </div>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                      {historyPayments.length} records
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {historyByMonth.length === 0 && (
                      <p className="text-sm text-steel/60">No historical payments yet.</p>
                    )}
                    {historyByMonth.map((entry) => (
                      <div key={entry.key} className="rounded-2xl border border-steel/10 bg-white/70 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-steel/60">{entry.key}</p>
                        <p className="mt-2 text-xl font-semibold text-ink">{formatMoney(entry.total)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="glass rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Why This Month Moves</p>
                      <h2 className="mt-2 text-lg font-semibold">Revenue Drivers</h2>
                    </div>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                      Projected: {formatMoney(projectionTotals.expected + projectionTotals.atRisk)}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-steel/70">
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Settled accounts removed</span>
                      <span className="font-semibold text-ink">-{formatMoney(projectionTotals.settledLoss)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Defaulted accounts at risk</span>
                      <span className="font-semibold text-ink">-{formatMoney(projectionTotals.defaultedLoss)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Active payers</span>
                      <span className="font-semibold text-ink">{projectionTotals.activeCount}</span>
                    </div>
                  </div>
                </div>

                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Portfolio Health</p>
                  <h2 className="mt-2 text-lg font-semibold">Workload + Risk</h2>
                  <div className="mt-4 grid gap-3 text-sm text-steel/70">
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Overdue follow-ups</span>
                      <span className="font-semibold text-ink">{overdueCount}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Due this week</span>
                      <span className="font-semibold text-ink">{dueWeekCount}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Defaulted accounts</span>
                      <span className="font-semibold text-ink">{projectionTotals.defaultedCount}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Settled accounts</span>
                      <span className="font-semibold text-ink">{projectionTotals.settledCount}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Opportunity Pipeline</p>
                  <h2 className="mt-2 text-lg font-semibold">Stage Totals</h2>
                  <div className="mt-4 grid gap-3 text-sm text-steel/70">
                    {OPPORTUNITY_STAGES.map((stage) => {
                      const stageTotal = opportunitiesByStage[stage]
                        .reduce((sum, opportunity) => sum + parseMoney(opportunity.amount), 0);
                      return (
                        <div key={stage} className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-semibold text-ink">{stage}</span>
                            <span className="text-xs text-steel/60">
                              Confidence: {Math.round(getOpportunityConfidence(stage) * 100)}%
                            </span>
                          </div>
                          <span className="font-semibold text-ink">{formatMoney(stageTotal)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="glass rounded-3xl p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Month Snapshot</p>
                  <h2 className="mt-2 text-lg font-semibold">Projection vs Collected</h2>
                  <div className="mt-4 grid gap-3 text-sm text-steel/70">
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Expected cash-in</span>
                      <span className="font-semibold text-ink">{formatMoney(projectionTotals.expected)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Collected so far</span>
                      <span className="font-semibold text-ink">{formatMoney(monthTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-steel/10 bg-white/60 px-4 py-3">
                      <span>Remaining to hit expected</span>
                      <span className="font-semibold text-ink">
                        {formatMoney(Math.max(0, projectionTotals.expected - monthTotal))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <div className="glass rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Recent Activity</p>
                      <h2 className="mt-2 text-lg font-semibold">Latest Touches</h2>
                    </div>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                      {recentHistory.length} recent
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-steel/70">
                    {recentHistory.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-steel/20 bg-white/60 px-4 py-4 text-center text-xs text-steel/60">
                        No recent activity yet.
                      </div>
                    )}
                    {recentHistory.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-steel/10 bg-white/60 px-4 py-3"
                      >
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-steel/60">{entry.entity_type}</p>
                          <p className="font-semibold text-ink">{entry.action}</p>
                          <p className="text-xs text-steel/60">{entry.details}</p>
                        </div>
                        <span className="text-xs text-steel/60">
                          {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {view === "opportunities" && (
            <section id="opportunitiesView">
              <div className="glass rounded-3xl p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Opportunity Pipeline</h2>
                    <p className="text-xs text-steel/60">Track offers before they become payment plans.</p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-steel/70">
                    <div className="rounded-2xl border border-steel/10 bg-white/70 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Pipeline Forecast</p>
                      <p className="text-base font-semibold">{formatMoney(opportunityForecast)}</p>
                    </div>
                    <div className="rounded-2xl border border-steel/10 bg-white/70 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.25em] text-steel/60">Open Opportunities</p>
                      <p className="text-base font-semibold">{opportunities.length}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                id="opportunityScrollTop"
                ref={opportunityTopScrollRef}
                onScroll={handleOpportunityTopScroll}
                className="mt-4 overflow-x-auto pb-2 opportunity-scroll-top"
              >
                <div ref={opportunityTopScrollInnerRef} className="h-2 w-full"></div>
              </div>
              <div
                id="opportunityScrollBottom"
                className="mt-3 overflow-x-auto pb-4"
                ref={opportunityBottomScrollRef}
                onScroll={handleOpportunityBottomScroll}
              >
                <div className="grid auto-cols-[280px] grid-flow-col gap-4">
                  {OPPORTUNITY_STAGES.map((stage) => (
                    <div
                      key={stage}
                      className="glass no-float rounded-3xl p-4 shadow-sm flex flex-col max-h-[calc(100vh-22rem)]"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = event.dataTransfer.getData("text/plain");
                        if (id) updateOpportunityStage(id, stage);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">{stage}</h3>
                          <p className="text-xs text-steel/60">
                            {opportunitiesByStage[stage].length} opportunities
                          </p>
                        </div>
                        <span className="rounded-full bg-ink/5 px-2 py-1 text-xs text-steel/70">
                          {Math.round(getOpportunityConfidence(stage) * 100)}%
                        </span>
                      </div>
                      <div className="mt-4 flex-1 overflow-y-auto pr-1">
                        <div className="grid gap-3">
                        {opportunitiesByStage[stage].map((opportunity) => {
                          const linkedAccount = opportunity.accountId
                            ? merchants.find((item) => item.id === opportunity.accountId)
                            : merchants.find(
                                (merchant) =>
                                  merchant.merchant.trim().toLowerCase() === String(opportunity.merchant || "").trim().toLowerCase() &&
                                  String(merchant.client || "").trim().toLowerCase() === String(opportunity.client || "").trim().toLowerCase()
                              );
                          const workedBadge = linkedAccount ? getTouchBadge(linkedAccount) : null;
                          return (
                          <div
                            key={opportunity.id}
                            className="group cursor-pointer rounded-2xl border border-steel/10 bg-white/80 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                            draggable
                            onDragStart={(event) => event.dataTransfer.setData("text/plain", opportunity.id)}
                            onClick={() => openOpportunityModal(opportunity)}
                          >
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                  <h4 className="text-sm font-semibold">{opportunity.merchant}</h4>
                                  <p className="text-xs text-steel/60">{opportunity.client || "Client not listed"}</p>
                                  {opportunity.tags && opportunity.tags.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {opportunity.tags.map((tag) => (
                                        <span key={`${opportunity.id}-${tag}`} className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-steel/70">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              <div className="flex flex-col items-end gap-2">
                                <span className="text-xs font-semibold text-ink">
                                  {formatMoney(parseMoney(opportunity.amount))}
                                </span>
                                {workedBadge && (
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${workedBadge.className}`}>
                                    {workedBadge.label}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 text-xs text-steel/70">
                              <p>Close: {displayDateValue(opportunity.expectedCloseDate)}</p>
                              <p>Plan: {opportunity.frequency || "TBD"}</p>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                              <button
                                className="rounded-full border border-steel/10 px-3 py-1 text-xs font-semibold text-steel/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  markOpportunityWorked(opportunity);
                                }}
                                disabled={!linkedAccount}
                              >
                                Worked
                              </button>
                            </div>
                            {opportunity.stage === "Payment Plan Made" && (
                              <div className="mt-3 flex items-center justify-end gap-2 text-xs text-steel/70">
                                <button
                                  className="rounded-full bg-ink px-2 py-1 text-xs font-semibold text-white"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    convertOpportunityToAccount(opportunity);
                                  }}
                                >
                                  Convert
                                </button>
                              </div>
                            )}
                          </div>
                        );
                        })}
                        {opportunitiesByStage[stage].length === 0 && (
                          <div className="rounded-2xl border border-dashed border-steel/20 bg-white/60 px-3 py-4 text-center text-xs text-steel/60">
                            No opportunities in this stage.
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {view === "accounts" && (
            <section id="accountsView">
              <div className="glass rounded-3xl p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold">Accounts List</h2>
                      <span className="rounded-full border border-steel/10 bg-white/70 px-3 py-1 text-xs font-semibold text-steel/70">
                        {filteredMerchants.length} accounts
                      </span>
                    </div>
                    <p className="text-xs text-steel/60">List view of all merchants and statuses.</p>
                  </div>
                </div>
                <div className="mt-4 max-h-[calc(100vh-22rem)] min-h-[clamp(24rem,48vh,46rem)] overflow-x-auto overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-20 bg-white/90 text-left text-xs uppercase tracking-wider text-steel/60 backdrop-blur">
                      <tr>
                        <th className="py-3 pr-4">Merchant</th>
                        <th className="py-3 pr-4">Client</th>
                        <th className="py-3 pr-4">Collection Day</th>
                        <th className="py-3 pr-4">Start</th>
                        <th className="py-3 pr-4">Amount</th>
                        <th className="py-3 pr-4">Frequency</th>
                        <th className="py-3 pr-4">
                          <button type="button" className="sort-button flex items-center gap-1" onClick={() => handleSort("age")}>
                            Age <span className="sort-indicator text-[10px]">{getSortIndicator("age")}</span>
                          </button>
                        </th>
                        <th className="py-3 pr-4">
                          <button type="button" className="sort-button flex items-center gap-1" onClick={() => handleSort("priority")}>
                            Priority <span className="sort-indicator text-[10px]">{getSortIndicator("priority")}</span>
                          </button>
                        </th>
                        <th className="py-3 pr-4 text-center">
                          <button type="button" className="sort-button mx-auto flex items-center gap-1" onClick={() => handleSort("lastWorked")}>
                            Last Worked <span className="sort-indicator text-[10px]">{getSortIndicator("lastWorked")}</span>
                          </button>
                        </th>
                        <th className="py-3 pr-4 text-center">
                          <button type="button" className="sort-button mx-auto flex items-center gap-1" onClick={() => handleSort("followUp")}>
                            Follow-up <span className="sort-indicator text-[10px]">{getSortIndicator("followUp")}</span>
                          </button>
                        </th>
                        <th className="py-3 pr-4">Next Payment</th>
                        <th className="py-3 pr-4">
                          <button type="button" className="sort-button flex items-center gap-1" onClick={() => handleSort("increase")}>
                            Increase <span className="sort-indicator text-[10px]">{getSortIndicator("increase")}</span>
                          </button>
                        </th>
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
                              {merchant.tags && merchant.tags.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {merchant.tags.map((tag) => (
                                    <span key={`${merchant.id}-${tag}`} className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-steel/70">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.client || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.status}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.startDate || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.amount || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{merchant.frequency || "-"}</td>
                            <td className="py-3 pr-4 text-steel/70">{ageDays}</td>
                            <td className="py-3 pr-4 text-steel/70">{priority}</td>
                              <td className="py-3 pr-4 text-center align-middle">
                                <div className="relative flex items-center justify-center">
                                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold leading-none text-steel/60">
                                    {displayDateValue(merchant.lastTouched)}
                                  </span>
                                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${touchBadge.className}`}>
                                    {touchBadge.label}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-center align-middle">
                                <div className="relative flex items-center justify-center">
                                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold leading-none text-steel/60">
                                    {nextFollowUp ? formatDisplayDate(nextFollowUp) : "-"}
                                  </span>
                                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${followUpStatus.className}`}>
                                    {followUpStatus.label}
                                  </span>
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="rounded-full border border-steel/10 bg-white px-4 py-2 text-xs font-semibold text-steel/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    onClick={handleToggleUnsorted}
                  >
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                        {!showUnsortedKanban && <path d="M3 3l18 18"></path>}
                      </svg>
                      {showUnsortedKanban ? "Hide Unsorted" : "Show Unsorted"}
                    </span>
                  </button>
                  <button
                    className="rounded-full border border-steel/10 bg-white px-4 py-2 text-xs font-semibold text-steel/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    onClick={() => setShowHistory((prev) => !prev)}
                  >
                    {showHistory ? "Hide History" : "Show History"}
                  </button>
                </div>
                {showHistory && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-full border border-steel/10 bg-white px-3 py-2 text-xs font-semibold text-steel/70"
                      onClick={exportHistoryCsv}
                    >
                      Export History CSV
                    </button>
                    <button
                      className="rounded-full border border-coral/20 px-3 py-2 text-xs font-semibold text-coral"
                      onClick={clearHistory}
                    >
                      Delete History
                    </button>
                  </div>
                )}
              </div>
              {showHistory && (
                <div className="mb-6 grid gap-3 rounded-3xl border border-steel/10 bg-white/60 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Historical Payments</p>
                      <h3 className="text-lg font-semibold">Prior Months</h3>
                    </div>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">
                      {historyPayments.length} records
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {historyByMonth.length === 0 && (
                      <p className="text-sm text-steel/60">No historical payments yet.</p>
                    )}
                    {historyByMonth.map((entry) => (
                      <div key={entry.key} className="rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm">
                        <p className="text-xs uppercase tracking-[0.2em] text-steel/60">{entry.key}</p>
                        <p className="mt-1 font-semibold text-ink">{formatMoney(entry.total)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="-mx-2 px-2 pb-2">
                <div ref={topScrollRef} id="kanbanScrollTop" className="kanban-scroll-top overflow-x-auto" onScroll={handleTopScroll}>
                  <div ref={topScrollInnerRef} id="kanbanScrollTopInner" className="h-2 min-w-full"></div>
                </div>
              </div>
              <div
                ref={bottomScrollRef}
                id="kanbanScrollBottom"
                className="-mx-2 max-w-full overflow-x-auto px-2 pb-6"
                onScroll={handleBottomScroll}
              >
                <div ref={boardRef} id="board" className="flex min-w-max gap-5">
                  {paymentStatuses.map((status) => {
                    const statusMerchants = filteredMerchants.filter(
                      (merchant) => (merchant.status || "Unsorted") === status
                    );
                    return (
                      <div
                        key={status}
                        className="fade-in flex min-w-[320px] max-w-[320px] flex-1 flex-col rounded-3xl border border-white/60 bg-white/70 p-4 shadow-sm max-h-[calc(100vh-22rem)]"
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
                        <div className="flex-1 overflow-y-auto pr-1">
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
                                {merchant.tags && merchant.tags.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {merchant.tags.map((tag) => (
                                      <span key={`${merchant.id}-${tag}`} className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-steel/70">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-steel/70">
                                  <span className="rounded-full bg-ink/5 px-2 py-1">{merchant.amount || "No amount"}</span>
                                  <span className="rounded-full bg-ink/5 px-2 py-1">{merchant.frequency || "No frequency"}</span>
                                  <span className="rounded-full bg-ink/5 px-2 py-1">{merchant.type || "No type"}</span>
                                </div>
                                <div className="mt-3 text-xs text-steel/70 space-y-1">
                                  <p><span className="font-medium">Age:</span> {ageDays} days</p>
                                  <p><span className="font-medium">Next follow-up:</span> {formatDisplayDate(getNextFollowUpDate(merchant))}</p>
                                  <p><span className="font-medium">Next payment:</span> {nextDue ? formatDisplayDate(nextDue) : "-"}</p>
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
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
          {view === "settings" && (
            <section id="settingsView">
              <div className="space-y-6">
                {showUserSettings && (
                  <div className="glass rounded-3xl px-6 py-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-steel/60">User Settings</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{session?.user?.email || "-"}</p>
                        {profileName && <p className="text-xs text-steel/60">{profileName}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <button
                          className="rounded-full border border-steel/10 bg-white px-3 py-2 font-semibold text-steel/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                          onClick={handleSendPasswordReset}
                        >
                          Send reset link
                        </button>
                        <button
                          className="rounded-full border border-steel/10 bg-white px-3 py-2 font-semibold text-steel/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                          onClick={() => setShowProfileEditor((prev) => !prev)}
                        >
                          {showProfileEditor ? "Hide profile" : "Edit profile"}
                        </button>
                        <button
                          className="rounded-full border border-steel/10 bg-white px-3 py-2 font-semibold text-steel/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                          onClick={handleSignOut}
                        >
                          Sign out
                        </button>
                        <button
                          className="rounded-full border border-steel/10 bg-white px-3 py-2 font-semibold text-steel/70"
                          onClick={() => setShowUserSettings(false)}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    {showProfileEditor && (
                      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleProfileSave}>
                        <label className="text-xs text-steel/60">
                          Full name
                          <input
                            className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                            value={profileName}
                            onChange={(event) => setProfileName(event.target.value)}
                          />
                        </label>
                        <label className="text-xs text-steel/60">
                          Phone number
                          <input
                            className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                            value={profilePhone}
                            onChange={(event) => setProfilePhone(event.target.value)}
                          />
                        </label>
                        <div className="md:col-span-2 flex items-center justify-between">
                          {profileMessage && <span className="text-xs text-steel/60">{profileMessage}</span>}
                          <button
                            type="submit"
                            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-glow"
                            disabled={isProfileSaving}
                          >
                            {isProfileSaving ? "Saving..." : "Save profile"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
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
                    <div className="flex items-center gap-2 rounded-full border border-steel/10 bg-white/80 px-3 py-2 text-sm text-steel/70">
                      <span className="text-xs uppercase tracking-[0.2em] text-steel/60">Mode</span>
                      <select
                        className="bg-transparent text-sm font-semibold text-ink focus:outline-none"
                        value={csvImportMode}
                        onChange={(event) => setCsvImportMode(event.target.value)}
                      >
                        <option value="replace">Reset & Replace</option>
                        <option value="append">Append Data</option>
                      </select>
                    </div>
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
                    Template columns: Merchant, Client, Collection Day, Start Date, Amount, Type, Frequency, Increase / Fixed Until Paid, Notes,
                    Account Age Days, Last Worked, Account Added Date.
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

                <details className="glass rounded-3xl p-6 shadow-sm lg:col-span-2">
                  <summary className="flex cursor-pointer items-center justify-between text-left">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-steel/60">Filters & Follow-up Focus</p>
                      <h2 className="mt-2 text-lg font-semibold">Prioritize Work</h2>
                    </div>
                    <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-steel/70">Toggle</span>
                  </summary>
                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    <div className="space-y-4">
                      <input
                        type="search"
                        placeholder="Search merchant or client..."
                        className="w-full rounded-2xl border border-steel/10 bg-white/80 px-4 py-2 text-sm focus:border-accent focus:outline-none"
                        value={search}
                      onChange={(event) => updateCurrentFilters({ search: event.target.value })}
                      />
                      <div className="grid gap-3">
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-accent"
                            checked={touchedOnly}
                            onChange={(event) => updateCurrentFilters({ touchedOnly: event.target.checked })}
                          />
                          Show worked today
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-coral"
                            checked={needWorkOnly}
                            onChange={(event) => updateCurrentFilters({ needWorkOnly: event.target.checked })}
                          />
                          Follow-up due
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-sky-500"
                            checked={dueWeekOnly}
                            onChange={(event) => updateCurrentFilters({ dueWeekOnly: event.target.checked })}
                          />
                          Due this week
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-500"
                            checked={increaseOnly}
                            onChange={(event) => updateCurrentFilters({ increaseOnly: event.target.checked })}
                          />
                          Increase due
                        </label>
                        <label className="flex items-center gap-2 text-sm text-steel/70">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-slate-500"
                            checked={unsortedOnly}
                            onChange={(event) => updateCurrentFilters({ unsortedOnly: event.target.checked })}
                          />
                          Unsorted only
                        </label>
                        {TAG_OPTIONS.map((tag) => (
                          <label key={`settings-tag-${tag}`} className="flex items-center gap-2 text-sm text-steel/70">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-ink"
                              checked={tagFilters.includes(tag)}
                              onChange={() => toggleTagFilter(tag)}
                            />
                            {tag}
                          </label>
                        ))}
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
                        Manage Collection Days
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </div>
            </section>
          )}
        </main>
      </div>

      {showOpportunityModal && (
        <div id="opportunityModal" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="glass w-full max-w-3xl rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editingOpportunity ? "Edit Opportunity" : "Add Opportunity"}
              </h2>
              <button className="text-xl text-steel/60" onClick={closeOpportunityModal}>
                &times;
              </button>
            </div>
            <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={upsertOpportunity}>
              <input type="hidden" name="opportunityId" value={editingOpportunity?.id || ""} />
              <label className="text-sm">
                Merchant
                <input
                  name="merchantName"
                  required
                  defaultValue={editingOpportunity?.merchant || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Client
                <input
                  name="clientName"
                  defaultValue={editingOpportunity?.client || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Expected Amount
                <input
                  name="amount"
                  defaultValue={editingOpportunity?.amount || ""}
                  inputMode="decimal"
                  onBlur={formatCurrencyInput}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Stage
                <select
                  name="stage"
                  defaultValue={editingOpportunity?.stage || OPPORTUNITY_STAGES[0]}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                >
                  {OPPORTUNITY_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Linked Account
                <select
                  name="accountId"
                  defaultValue={editingOpportunity?.accountId || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                >
                  <option value="">Not linked</option>
                  {merchants
                    .slice()
                    .sort((a, b) => a.merchant.localeCompare(b.merchant))
                    .map((merchant) => (
                      <option key={merchant.id} value={merchant.id}>
                        {merchant.merchant}
                        {merchant.client ? ` — ${merchant.client}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                Expected Close Date
                <input
                  name="expectedCloseDate"
                  type="date"
                  defaultValue={editingOpportunity?.expectedCloseDate || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Planned Start Date
                <input
                  name="startDate"
                  defaultValue={editingOpportunity?.startDate || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Frequency
                <input
                  name="frequency"
                  defaultValue={editingOpportunity?.frequency || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Payment Type
                <input
                  name="type"
                  defaultValue={editingOpportunity?.type || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
                  <label className="text-sm">
                    Collection Day
                    <select
                      name="paymentStatus"
                      defaultValue={editingOpportunity?.paymentStatus || "Unsorted"}
                      className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                    >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                    </select>
                  </label>
                  <div className="text-sm md:col-span-2">
                    <p className="text-sm font-semibold">Tags</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TAG_OPTIONS.map((tag) => {
                        const active = opportunityTagsDraft.includes(tag);
                        return (
                          <button
                            key={`opportunity-tag-${tag}`}
                            type="button"
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                              active ? "border-ink bg-ink text-white" : "border-steel/10 bg-white/80 text-steel/70"
                            }`}
                            onClick={() =>
                              setOpportunityTagsDraft((prev) =>
                                prev.includes(tag) ? prev.filter((item) => item !== tag) : prev.concat(tag)
                              )
                            }
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="text-sm md:col-span-2">
                    Notes
                    <textarea
                  name="notes"
                  rows="3"
                  defaultValue={editingOpportunity?.notes || ""}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                ></textarea>
              </label>
              <div className="md:col-span-2 flex justify-end gap-3">
                {editingOpportunity && (
                  <button
                    type="button"
                    className="rounded-2xl border border-coral/20 px-4 py-2 text-sm text-coral"
                    onClick={() => {
                      deleteOpportunity(editingOpportunity.id);
                      closeOpportunityModal();
                    }}
                  >
                    Delete
                  </button>
                )}
                {editingOpportunity && (
                  <button
                    type="button"
                    className="rounded-2xl border border-steel/10 px-4 py-2 text-sm shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    onClick={() => markOpportunityWorked(editingOpportunity)}
                  >
                    Worked
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-2xl border border-steel/10 px-4 py-2 text-sm"
                  onClick={closeOpportunityModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-ink px-5 py-2 text-sm font-semibold text-white"
                  disabled={isOpportunitySaving}
                >
                  {isOpportunitySaving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  inputMode="decimal"
                  onBlur={formatCurrencyInput}
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
                Collection Day
                <select
                  name="status"
                  defaultValue={editingMerchant?.status || "Unsorted"}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm md:col-span-2">
                <p className="text-sm font-semibold">Tags</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TAG_OPTIONS.map((tag) => {
                    const active = merchantTagsDraft.includes(tag);
                    return (
                      <button
                        key={`merchant-tag-${tag}`}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          active ? "border-ink bg-ink text-white" : "border-steel/10 bg-white/80 text-steel/70"
                        }`}
                        onClick={() =>
                          setMerchantTagsDraft((prev) =>
                            prev.includes(tag) ? prev.filter((item) => item !== tag) : prev.concat(tag)
                          )
                        }
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
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
                            <div key={`${payment.id || payment.date}-${payment.amount}-${index}`} className="flex items-center justify-between gap-2">
                              <div className="flex flex-col">
                                <span>{displayDateValue(payment.date)}</span>
                                <span className="font-semibold text-ink">{formatMoney(payment.amount)}</span>
                              </div>
                              {payment.id && (
                                <button
                                  type="button"
                                  className="rounded-full border border-coral/20 px-3 py-1 text-xs font-semibold text-coral"
                                  onClick={() => deletePayment(payment.id, editingMerchant.id)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          ))
                      ) : (
                        <p>No payments logged.</p>
                      )}
                    </div>
                  </details>
                </div>
              )}
              {editingMerchant && (
                <div className="md:col-span-2">
                  <details className="rounded-2xl border border-steel/10 bg-white/70 px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-steel/80">
                      Linked opportunities ({linkedOpportunities.length})
                    </summary>
                    <div className="mt-3 space-y-3 text-sm text-steel/70">
                      {!showOpportunityLink && (
                        <button
                          type="button"
                          className="rounded-full border border-steel/10 px-3 py-1 text-xs font-semibold text-steel/70"
                          onClick={openLinkedOpportunities}
                        >
                          Load linked opportunities
                        </button>
                      )}
                      {showOpportunityLink && linkedOpportunities.length === 0 && (
                        <p>No opportunities linked yet.</p>
                      )}
                      {showOpportunityLink &&
                        linkedOpportunities.map((opportunity) => (
                          <div key={opportunity.id} className="rounded-2xl border border-steel/10 bg-white/80 px-3 py-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-semibold text-ink">{opportunity.merchant}</p>
                                <p className="text-xs text-steel/60">{opportunity.client || "Client not listed"}</p>
                              </div>
                              <span className="rounded-full bg-ink/5 px-2 py-1 text-xs text-steel/70">
                                {opportunity.stage}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-steel/70">
                              <span>{formatMoney(parseMoney(opportunity.amount))}</span>
                              <span>{opportunity.frequency || "TBD"}</span>
                            </div>
                            {opportunity.tags && opportunity.tags.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {opportunity.tags.map((tag) => (
                                  <span key={`${opportunity.id}-${tag}`} className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-steel/70">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-steel/10 px-3 py-1 text-xs font-semibold text-steel/70"
                                onClick={() => openOpportunityModal(opportunity)}
                              >
                                Open
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-coral/20 px-3 py-1 text-xs font-semibold text-coral"
                                onClick={() => deleteOpportunity(opportunity.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </details>
                </div>
              )}
              {editingMerchant && (
                <div className="md:col-span-2">
                  <details className="rounded-2xl border border-steel/10 bg-white/70 px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-steel/80">
                      Activity history
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-steel/70">
                      {recentHistory.filter((entry) => entry.entity_id === editingMerchant.id).length === 0 && (
                        <p>No activity yet.</p>
                      )}
                      {recentHistory
                        .filter((entry) => entry.entity_id === editingMerchant.id)
                        .map((entry) => (
                          <div key={entry.id} className="flex flex-col gap-1 border-b border-steel/10 pb-2 last:border-b-0">
                            <span className="text-xs uppercase tracking-[0.2em] text-steel/60">{entry.action}</span>
                            <span className="text-sm text-ink">{entry.details}</span>
                            <span className="text-xs text-steel/60">
                              {entry.created_at ? new Date(entry.created_at).toLocaleString() : ""}
                            </span>
                          </div>
                        ))}
                    </div>
                  </details>
                </div>
              )}
              <div className="md:col-span-2 flex justify-end gap-3">
                {editingMerchant && (
                  <>
                    <button
                      type="button"
                      className="rounded-2xl border border-ink/20 px-4 py-2 text-sm text-ink"
                      onClick={() => openPaymentModal(editingMerchant)}
                    >
                      Log Payment
                    </button>
                    <button
                      type="button"
                      className="rounded-2xl border border-sky/30 px-4 py-2 text-sm text-sky"
                      onClick={async () => {
                        await convertAccountToOpportunity(editingMerchant);
                        closeMerchantModal();
                      }}
                    >
                      Convert
                    </button>
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
                  </>
                )}
                <button type="button" id="cancelMerchant" className="rounded-2xl border border-steel/10 px-4 py-2 text-sm" onClick={closeMerchantModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-ink px-5 py-2 text-sm font-semibold text-white"
                  disabled={isMerchantSaving}
                >
                  {isMerchantSaving ? "Saving..." : "Save"}
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
                  type="text"
                  inputMode="decimal"
                  required
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  onBlur={formatPaymentInput}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <div className="flex justify-end gap-3">
                <button type="button" id="cancelPayment" className="rounded-2xl border border-steel/10 px-4 py-2 text-sm" onClick={closePaymentModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-ink px-5 py-2 text-sm font-semibold text-white"
                  disabled={isPaymentSaving}
                >
                  {isPaymentSaving ? "Saving..." : "Log Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQuickPaymentModal && (
        <div id="quickPaymentModal" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="glass w-full max-w-lg rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Log Payment</h2>
              <button className="text-xl text-steel/60" onClick={closeQuickPaymentModal}>
                &times;
              </button>
            </div>
            <form className="mt-4 grid gap-4" onSubmit={addPayment}>
              <label className="text-sm">
                Account
                <select
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                  value={paymentMerchantId}
                  onChange={(event) => setPaymentMerchantId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select an account
                  </option>
                  {merchants.map((merchant) => (
                    <option key={merchant.id} value={merchant.id}>
                      {merchant.merchant}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Payment Date
                <input
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
                  type="text"
                  inputMode="decimal"
                  required
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  onBlur={formatPaymentInput}
                  className="mt-1 w-full rounded-2xl border border-steel/10 bg-white/80 px-3 py-2"
                />
              </label>
              <div className="flex justify-end gap-3">
                <button type="button" className="rounded-2xl border border-steel/10 px-4 py-2 text-sm" onClick={closeQuickPaymentModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-ink px-5 py-2 text-sm font-semibold text-white"
                  disabled={isPaymentSaving || !paymentMerchantId}
                >
                  {isPaymentSaving ? "Saving..." : "Log Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStatusModal && (
        <div id="statusModal" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="glass w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Manage Collection Days</h2>
              <button id="closeStatusModal" className="text-xl text-steel/60" onClick={closeStatusModal}>
                &times;
              </button>
            </div>
            <form id="addStatusForm" className="mt-4 flex flex-wrap gap-3" onSubmit={handleAddStatus}>
              <input
                id="newStatusName"
                placeholder="New collection day name"
                className="flex-1 rounded-2xl border border-steel/10 bg-white/80 px-3 py-2 text-sm"
                value={newStatusName}
                onChange={(event) => setNewStatusName(event.target.value)}
              />
              <button type="submit" className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white">
                Add Collection Day
              </button>
            </form>
            <div id="statusList" className="mt-4 grid gap-2">
              {orderedStatuses.map((status, index) => (
                <div
                  key={status}
                  className="flex items-center gap-2 rounded-2xl border border-steel/10 bg-white/70 px-3 py-2"
                  draggable={status !== "Unsorted"}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", status);
                    setDraggedStatus(status);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = event.dataTransfer.getData("text/plain");
                    if (dragged && dragged !== status) {
                      reorderStatuses(dragged, status);
                    }
                    setDraggedStatus("");
                  }}
                >
                  <div className={`cursor-grab rounded-full border border-steel/10 px-2 py-2 text-[10px] font-semibold ${draggedStatus === status ? "bg-ink/5" : ""}`}>
                    <svg className="h-4 w-4 text-steel/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="9" cy="7" r="1.5"></circle>
                      <circle cx="15" cy="7" r="1.5"></circle>
                      <circle cx="9" cy="12" r="1.5"></circle>
                      <circle cx="15" cy="12" r="1.5"></circle>
                      <circle cx="9" cy="17" r="1.5"></circle>
                      <circle cx="15" cy="17" r="1.5"></circle>
                    </svg>
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
        <div id="controlsModal" className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="glass w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 shadow-xl">
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
                  onChange={(event) => updateCurrentFilters({ search: event.target.value })}
                />
                <div className="flex flex-wrap gap-3 text-sm text-steel/70">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={touchedOnly}
                      onChange={(event) => updateCurrentFilters({ touchedOnly: event.target.checked })}
                    />
                    Show worked today
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-coral"
                      checked={needWorkOnly}
                      onChange={(event) => updateCurrentFilters({ needWorkOnly: event.target.checked })}
                    />
                    Follow-up due
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      checked={dueWeekOnly}
                      onChange={(event) => updateCurrentFilters({ dueWeekOnly: event.target.checked })}
                    />
                    Due this week
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500"
                      checked={increaseOnly}
                      onChange={(event) => updateCurrentFilters({ increaseOnly: event.target.checked })}
                    />
                    Increase due
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-slate-500"
                      checked={unsortedOnly}
                      onChange={(event) => updateCurrentFilters({ unsortedOnly: event.target.checked })}
                    />
                    Unsorted only
                  </label>
                  {TAG_OPTIONS.map((tag) => (
                    <label key={`tag-filter-${tag}`} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ink"
                        checked={tagFilters.includes(tag)}
                        onChange={() => toggleTagFilter(tag)}
                      />
                      {tag}
                    </label>
                  ))}
                  <button
                    className="rounded-full border border-steel/10 bg-white/80 px-3 py-1 text-xs font-semibold text-steel/70"
                    onClick={openStatusModal}
                    type="button"
                  >
                    Manage Collection Days
                  </button>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-steel/70">
                  <span className="text-[11px] uppercase tracking-[0.25em] text-steel/60">Priority</span>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500"
                      checked={priorityFilters.p0}
                      onChange={() =>
                        updateCurrentFilters((current) => ({
                          ...current,
                          priorityFilters: { ...current.priorityFilters, p0: !current.priorityFilters.p0 },
                        }))
                      }
                    />
                    Priority 0 (0-14)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-sky-500"
                      checked={priorityFilters.p1}
                      onChange={() =>
                        updateCurrentFilters((current) => ({
                          ...current,
                          priorityFilters: { ...current.priorityFilters, p1: !current.priorityFilters.p1 },
                        }))
                      }
                    />
                    Priority 1 (15-60)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-amber-500"
                      checked={priorityFilters.p2}
                      onChange={() =>
                        updateCurrentFilters((current) => ({
                          ...current,
                          priorityFilters: { ...current.priorityFilters, p2: !current.priorityFilters.p2 },
                        }))
                      }
                    />
                    Priority 2 (61-179)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-rose-500"
                      checked={priorityFilters.p3}
                      onChange={() =>
                        updateCurrentFilters((current) => ({
                          ...current,
                          priorityFilters: { ...current.priorityFilters, p3: !current.priorityFilters.p3 },
                        }))
                      }
                    />
                    Priority 3 (180+)
                  </label>
                </div>
                <details className="text-xs text-steel/60">
                  <summary className="cursor-pointer font-semibold text-steel/70">CSV columns</summary>
                  <p className="mt-2">
                    Merchant, Client, Collection Day, Start Date, Amount, Type, Frequency, Increase / Fixed Until Paid, Notes, Account Age Days,
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
