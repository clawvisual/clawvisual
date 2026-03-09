"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderKanban,
  LogOut,
  Mail,
  MoreHorizontal,
  PanelLeftClose,
  PencilLine,
  Rocket,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGE_CODES,
  normalizeLanguage,
  type SupportedLanguageCode
} from "@/lib/i18n/languages";

type JobStatus = "queued" | "running" | "completed" | "failed";
type AspectRatio = "4:5" | "9:16" | "1:1" | "16:9";

const ASPECT_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "4:5", label: "Portrait 4:5" },
  { value: "9:16", label: "Story 9:16" },
  { value: "1:1", label: "Square 1:1" },
  { value: "16:9", label: "Landscape 16:9" }
];

const SLIDE_COUNT_OPTIONS = ["auto", "1", "2", "3", "4", "5", "6", "7", "8"] as const;

type ConvertResponse = {
  job_id: string;
  session_id?: string;
  status_url: string;
};

type RerunPlan = {
  selectedSkills: string[];
  reusedSkills: string[];
  reason: string;
};

type SkillArtifact = {
  artifactId: string;
  skillName: string;
  inputHash: string;
  version: number;
  dependsOn: string[];
  revision: number;
  updatedAt: string;
};

type JobEvent = {
  id: string;
  index: number;
  stage: string;
  title: string;
  thought: string;
  action: string;
  outputPreview?: string;
  durationSec: number;
  costUsd: number;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  createdAt: string;
};

type JobResponse = {
  job_id: string;
  session_id?: string;
  turn_index: number;
  revision?: number;
  mode?: "generate" | "revise";
  base_job_id?: string;
  parent_job_id?: string;
  revision_intent?: "rewrite_copy_style" | "regenerate_cover" | "regenerate_slides";
  input_text: string;
  source_input_text?: string;
  status: JobStatus;
  progress: number;
  stage?: string;
  events: JobEvent[];
  rerun_plan?: RerunPlan;
  changed_artifacts?: string[];
  artifacts?: SkillArtifact[];
  error?: string;
  created_at: string;
  updated_at: string;
  result?: {
    post_title: string;
    post_caption: string;
    hashtags: string[];
    platform_type: "RedBook" | "Twitter" | "Instagram" | "TikTok" | "LinkedIn";
    slides: Array<{
      slide_id: number;
      is_cover: boolean;
      content_quote: string;
      visual_prompt: string;
      image_url: string;
      layout_template: string;
      focus_keywords: string[];
      brand_overlay: {
        logo_position: string;
        color_values: {
          primary: string;
          secondary: string;
          background: string;
          text: string;
        };
        font_name: string;
        logo_url?: string;
      };
    }>;
    skill_logs: Array<{
      skill_name: string;
      status: "running" | "completed" | "failed";
      output_preview: string;
    }>;
    aspect_ratio: AspectRatio;
  };
};

type RevisionRequestPayload = {
  intent?: "rewrite_copy_style" | "regenerate_cover" | "regenerate_slides";
  instructions: string;
  auto_route?: boolean;
  scope?: { slide_ids?: number[]; fields?: string[] };
  editable_fields?: Array<"post_title" | "post_caption" | "hashtags" | "slides">;
  preserve_facts?: boolean;
  preserve_slide_structure?: boolean;
  options?: {
    mode?: "same_prompt_new_seed" | "reprompt";
    seed?: number;
    preserve_layout?: boolean;
  };
};

type ReviseRevisedResponse = {
  action: "revised";
  revision_id: string;
  session_id: string;
  parent_job_id: string;
  base_job_id: string;
  turn_index: number;
  revision: number;
  status_url: string;
  changed_artifacts: string[];
  rerun_plan?: RerunPlan;
  job?: JobResponse;
};

type ReviseClarificationResponse = {
  action: "ask_clarification";
  session_id: string;
  parent_job_id: string;
  question: string;
  route?: {
    intent: "ask_clarification";
    confidence: number;
    reason: string;
  };
};

type ReviseFullRegenerateResponse = {
  action: "full_regenerate";
  session_id: string;
  parent_job_id: string;
  regenerate_input_text: string;
  route?: {
    intent: "full_regenerate";
    confidence: number;
    reason: string;
  };
};

type ReviseResponse = ReviseRevisedResponse | ReviseClarificationResponse | ReviseFullRegenerateResponse;
type ReviseResponseWithMeta = ReviseResponse & { __optimistic_job_id?: string };

type SessionResponse = {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_job_id?: string;
  jobs: JobResponse[];
};

type SessionSummary = {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_job_id?: string;
  job_count: number;
};

type AuditResponse = {
  summary: {
    models_requested: number;
    models_succeeded: number;
    overall_average_score: number;
  };
  model_scores: Array<{
    model: string;
    status: "completed" | "failed";
    total_score: number | null;
    dimensions: {
      readability: number;
      aesthetics: number;
      alignment: number;
    } | null;
    critical_issue: string;
    fix_suggestion: string;
    error?: string;
  }>;
};

type SlideOverride = {
  image_url: string;
  visual_prompt: string;
};

type HistoryMenuPosition = {
  top: number;
  left: number;
};

type StarterCase = {
  id: string;
  title: string;
  description: string;
  payload: string;
  badge: string;
};

const STARTER_CASES: StarterCase[] = [
  {
    id: "case-url-productivity",
    title: "Fix Your Life Framework",
    description: "Use a long-form article URL and convert it into a 8-slide social carousel.",
    payload: "https://letters.thedankoe.com/p/how-to-fix-your-entire-life-in-1",
    badge: "URL"
  },
  {
    id: "case-copy-controversy",
    title: "Controversy Hook Pack",
    description: "Generate polarizing hooks and concise scripts from a single argument draft.",
    payload:
      "Most creators are not bad at content. They are bad at distribution. Create an 8-slide carousel proving why distribution beats raw quality with 3 concrete examples.",
    badge: "Copy"
  },
  {
    id: "case-mixed-linkedin",
    title: "LinkedIn Thought Post",
    description: "Mixed mode: include your own draft plus a reference URL for stronger structure.",
    payload:
      "Turn this into a high-performing LinkedIn carousel with practical steps for founders: https://www.ycombinator.com/library",
    badge: "Mixed"
  },
  {
    id: "case-data-story",
    title: "Data Story Breakdown",
    description: "Create data-first slides with clear comparisons and final CTA.",
    payload:
      "We reduced customer acquisition cost by 38% in 90 days by changing only 3 things: channel mix, landing page narrative, and onboarding email timing. Build a data-driven carousel with one metric per slide.",
    badge: "Data"
  }
];

function resolveLanguageFromBrowser(): SupportedLanguageCode {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;

  const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  const supported = new Set(SUPPORTED_LANGUAGE_CODES.map((item) => item.toLowerCase()));

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (supported.has(normalized)) return normalizeLanguage(candidate);

    const primary = normalized.split("-")[0];
    const fromPrimary = normalizeLanguage(primary);
    if (fromPrimary !== DEFAULT_LANGUAGE || primary === "en") {
      return fromPrimary;
    }
  }

  return DEFAULT_LANGUAGE;
}

function parseSlideCountInput(value: string): number | undefined | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    return null;
  }

  return parsed;
}

const menuItems = [
  { label: "New Session", icon: Sparkles, active: true },
  // { label: "Agent Sessions", icon: Bot },
  // { label: "Skills", icon: LayoutGrid },
  // { label: "Analytics", icon: CircleGauge },
  { label: "Settings", icon: Settings },
];

export default function HomePage() {
  const [inputText, setInputText] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<SupportedLanguageCode>(DEFAULT_LANGUAGE);
  const [primaryAspectRatio, setPrimaryAspectRatio] = useState<AspectRatio>("4:5");
  const [slideCountInput, setSlideCountInput] = useState("auto");
  const [slideCountMenuOpen, setSlideCountMenuOpen] = useState(false);
  const [slideCountMenuPlacement, setSlideCountMenuPlacement] = useState<"down" | "up">("down");
  const [slideCountMenuMaxHeight, setSlideCountMenuMaxHeight] = useState(260);
  const [sessionId, setSessionId] = useState("");
  const [sessionJobs, setSessionJobs] = useState<JobResponse[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionTitle, setSessionTitle] = useState("New Session");
  const [sessionHistory, setSessionHistory] = useState<SessionSummary[]>([]);
  const [historyMenuSessionId, setHistoryMenuSessionId] = useState("");
  const [historyMenuPosition, setHistoryMenuPosition] = useState<HistoryMenuPosition | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [slidePromptDrafts, setSlidePromptDrafts] = useState<Record<number, string>>({});
  const [slideOverrides, setSlideOverrides] = useState<Record<number, SlideOverride>>({});
  const [slideEditorOpen, setSlideEditorOpen] = useState<Record<number, boolean>>({});
  const [slideRegenerating, setSlideRegenerating] = useState<Record<number, boolean>>({});
  const [auditByJob, setAuditByJob] = useState<Record<string, AuditResponse>>({});
  const [auditLoadingByJob, setAuditLoadingByJob] = useState<Record<string, boolean>>({});
  const [auditErrorByJob, setAuditErrorByJob] = useState<Record<string, string>>({});
  const [downloadLoadingByJob, setDownloadLoadingByJob] = useState<Record<string, boolean>>({});
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const canSubmit = inputText.trim().length > 0 && !loading;
  const orderedJobs = useMemo(
    () =>
      [...sessionJobs].sort((a, b) => {
        const turnDelta = a.turn_index - b.turn_index;
        if (turnDelta !== 0) return turnDelta;
        return (a.revision ?? 1) - (b.revision ?? 1);
      }),
    [sessionJobs]
  );
  const activeJob = useMemo(() => {
    if (activeJobId) {
      return orderedJobs.find((item) => item.job_id === activeJobId) ?? null;
    }
    return orderedJobs[orderedJobs.length - 1] ?? null;
  }, [activeJobId, orderedJobs]);
  const isConversationMode = orderedJobs.length > 0 || loading || !!error || Boolean(sessionId);
  const isNewConversation = !isConversationMode;
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const slideCountControlRef = useRef<HTMLDivElement | null>(null);
  const slideCountMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const carouselViewportRef = useRef<HTMLDivElement | null>(null);
  const restoredFromUrlRef = useRef(false);
  const pollingVersionRef = useRef(0);
  const activeHistoryMenuItem = useMemo(
    () => sessionHistory.find((item) => item.session_id === historyMenuSessionId) ?? null,
    [historyMenuSessionId, sessionHistory]
  );

  useEffect(() => {
    setOutputLanguage(resolveLanguageFromBrowser());
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const onDocClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!slideCountMenuOpen) return;

    const onDocClick = (event: MouseEvent) => {
      if (!slideCountControlRef.current?.contains(event.target as Node)) {
        setSlideCountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [slideCountMenuOpen]);

  useEffect(() => {
    if (!slideCountMenuOpen) return;

    const updateMenuPlacement = () => {
      const controlRect = slideCountControlRef.current?.getBoundingClientRect();
      if (!controlRect) return;

      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const spaceBelow = viewportHeight - controlRect.bottom;
      const spaceAbove = controlRect.top;
      const estimatedMenuHeight = slideCountMenuRef.current?.offsetHeight ?? 280;

      const nextPlacement: "down" | "up" =
        spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? "up" : "down";
      setSlideCountMenuPlacement(nextPlacement);

      const available = nextPlacement === "down" ? spaceBelow - 12 : spaceAbove - 12;
      setSlideCountMenuMaxHeight(Math.max(120, Math.floor(available)));
    };

    updateMenuPlacement();
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);

    return () => {
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
    };
  }, [slideCountMenuOpen]);

  useEffect(() => {
    if (!historyMenuSessionId) return;

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-history-menu-root]") || target.closest("[data-history-menu-popover]")) {
        return;
      }
      setHistoryMenuSessionId("");
    };

    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [historyMenuSessionId]);

  useEffect(() => {
    if (!historyMenuSessionId) {
      setHistoryMenuPosition(null);
    }
  }, [historyMenuSessionId]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      setPricingOpen(false);
      setHistoryMenuSessionId("");
      setRenamingSessionId("");
      setRenameDraft("");
    };

    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    setActiveSlideIndex(0);
  }, [activeJob?.job_id, activeJob?.result?.slides?.length]);

  const progressLabel = useMemo(() => {
    if (!activeJob) return "idle";
    return `${activeJob.progress}% · ${activeJob.stage ?? "waiting"}`;
  }, [activeJob]);

  const upsertJob = useCallback((nextJob: JobResponse) => {
    setSessionJobs((prev) => {
      const existingIndex = prev.findIndex((item) => item.job_id === nextJob.job_id);
      if (existingIndex < 0) {
        return [...prev, nextJob];
      }
      const cloned = [...prev];
      cloned[existingIndex] = nextJob;
      return cloned;
    });
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setSessionJobs((prev) => prev.filter((item) => item.job_id !== jobId));
  }, []);

  const parseSessionContextFromLocation = useCallback(() => {
    if (typeof window === "undefined") {
      return { sessionId: "", jobId: "" };
    }

    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/^\/thread\/([^/]+)/);
    const pathSessionId = pathMatch?.[1] ? decodeURIComponent(pathMatch[1]) : "";
    const querySessionId = url.searchParams.get("session_id")?.trim() || "";
    const nextSessionId = pathSessionId || querySessionId;
    const nextJobId = url.searchParams.get("job_id")?.trim() || "";
    return { sessionId: nextSessionId, jobId: nextJobId };
  }, []);

  const refreshSessionHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/sessions", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { sessions?: SessionSummary[] };
      const items = Array.isArray(data.sessions) ? data.sessions : [];
      setSessionHistory(items);

      if (sessionId) {
        const matched = items.find((item) => item.session_id === sessionId);
        if (matched?.title) {
          setSessionTitle(matched.title);
        }
      }
    } catch {
      // Ignore sidebar history fetch errors.
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshSessionHistory();
  }, [refreshSessionHistory]);

  const syncUrlWithSession = useCallback((nextSessionId?: string, nextJobId?: string) => {
    if (typeof window === "undefined") return;

    const pathname = nextSessionId ? `/thread/${encodeURIComponent(nextSessionId)}` : "/";
    const params = new URLSearchParams();

    if (nextJobId) {
      params.set("job_id", nextJobId);
    }

    const query = params.toString();
    window.history.replaceState({}, "", `${pathname}${query ? `?${query}` : ""}`);
  }, []);

  const pollJob = useCallback(
    (statusUrl: string, expectedSessionId?: string, expectedJobId?: string): Promise<void> =>
      new Promise((resolve) => {
        const pollingVersion = ++pollingVersionRef.current;
        let attempts = 0;
        let stagnantAttempts = 0;
        let networkFailureStreak = 0;
        let previousProgress = -1;
        let previousStage = "";
        let pollIntervalMs = 1300;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const baseIntervalMs = 1300;
        const slowIntervalMs = 3000;
        const slowPollingTrigger = 10;
        const maxNetworkFailureStreak = 5;
        const maxAttempts = 720;
        const maxStagnantAttempts = 300;
        const isStale = () => pollingVersion !== pollingVersionRef.current;

        const finish = (options?: { error?: string; refreshHistory?: boolean }) => {
          if (settled) return;
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          if (isStale()) {
            resolve();
            return;
          }
          setLoading(false);
          if (typeof options?.error === "string") {
            setError(options.error);
          } else {
            setError("");
          }
          if (options?.refreshHistory) {
            void refreshSessionHistory();
          }
          resolve();
        };

        const scheduleNext = () => {
          if (settled) return;
          if (isStale()) {
            finish();
            return;
          }
          if (timer) {
            clearTimeout(timer);
          }
          timer = setTimeout(() => {
            void runPollTick();
          }, pollIntervalMs);
        };

        const runPollTick = async () => {
          if (isStale()) {
            finish();
            return;
          }
          attempts += 1;

          try {
            const res = await fetch(statusUrl, { cache: "no-store" });
            if (!res.ok) {
              if (res.status === 404 && attempts < 20) {
                scheduleNext();
                return;
              }
              finish({
                error: res.status === 404 ? "任务不存在或已过期，请重试。" : `查询任务失败: ${res.status}`
              });
              return;
            }

            networkFailureStreak = 0;

            const data: JobResponse = await res.json();
            if (isStale()) {
              finish();
              return;
            }
            const nextSessionId = data.session_id || expectedSessionId || "";
            upsertJob(data);
            setActiveJobId(data.job_id);
            setSessionId(nextSessionId);
            syncUrlWithSession(nextSessionId, data.job_id || expectedJobId);

            if (data.progress === previousProgress && (data.stage ?? "") === previousStage) {
              stagnantAttempts += 1;
            } else {
              stagnantAttempts = 0;
              previousProgress = data.progress;
              previousStage = data.stage ?? "";
            }
            pollIntervalMs = stagnantAttempts >= slowPollingTrigger ? slowIntervalMs : baseIntervalMs;

            if (data.status === "completed") {
              finish({ refreshHistory: true });
              return;
            }

            if (data.status === "failed") {
              finish({ error: data.error ?? "任务执行失败", refreshHistory: true });
              return;
            }

            if (attempts >= maxAttempts || stagnantAttempts >= maxStagnantAttempts) {
              const finalRes = await fetch(statusUrl, { cache: "no-store" });
              if (finalRes.ok) {
                const finalData: JobResponse = await finalRes.json();
                if (isStale()) {
                  finish();
                  return;
                }
                const finalSessionId = finalData.session_id || expectedSessionId || "";
                upsertJob(finalData);
                setActiveJobId(finalData.job_id);
                setSessionId(finalSessionId);
                syncUrlWithSession(finalSessionId, finalData.job_id || expectedJobId);

                if (finalData.status === "completed") {
                  finish({ refreshHistory: true });
                  return;
                }
              }

              finish({ error: "任务执行时间较长，已停止自动轮询。请稍后刷新查看最新状态。" });
              return;
            }
            scheduleNext();
          } catch {
            networkFailureStreak += 1;
            if (networkFailureStreak > maxNetworkFailureStreak) {
              finish({ error: "网络异常，无法查询任务状态。" });
              return;
            }
            pollIntervalMs = slowIntervalMs;
            scheduleNext();
          }
        };

        scheduleNext();
      }),
    [refreshSessionHistory, syncUrlWithSession, upsertJob]
  );

  const loadSession = useCallback(
    async (id: string, preferredJobId?: string) => {
      if (!id) return;
      pollingVersionRef.current += 1;

      const response = await fetch(`/api/v1/sessions/${id}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 404 ? "Session not found or expired." : `Failed to load session: ${response.status}`);
      }

      const data = (await response.json()) as SessionResponse;
      setSessionId(data.session_id);
      setSessionTitle(data.title || "Session");
      setSessionJobs(data.jobs ?? []);

      const chosenJobId =
        preferredJobId ||
        data.last_job_id ||
        data.jobs?.[data.jobs.length - 1]?.job_id ||
        "";
      setActiveJobId(chosenJobId);
      syncUrlWithSession(data.session_id, chosenJobId || undefined);

      const selected = (data.jobs ?? []).find((item) => item.job_id === chosenJobId);
      if (selected && (selected.status === "queued" || selected.status === "running")) {
        setLoading(true);
        await pollJob(`/api/v1/jobs/${selected.job_id}`, data.session_id, selected.job_id);
      } else {
        setLoading(false);
      }

      await refreshSessionHistory();
    },
    [pollJob, refreshSessionHistory, syncUrlWithSession]
  );

  useEffect(() => {
    if (restoredFromUrlRef.current || typeof window === "undefined") return;
    restoredFromUrlRef.current = true;

    const context = parseSessionContextFromLocation();
    if (!context.sessionId) {
      syncUrlWithSession(undefined, undefined);
      return;
    }

    setError("");
    setLoading(true);
    void loadSession(context.sessionId, context.jobId).catch((caughtError) => {
      setLoading(false);
      setError(caughtError instanceof Error ? caughtError.message : "加载会话失败");
    });
  }, [loadSession, parseSessionContextFromLocation, syncUrlWithSession]);

  const requestRevision = useCallback(
    async (targetJobId: string, payload: RevisionRequestPayload): Promise<ReviseResponseWithMeta> => {
      const parentJob = orderedJobs.find((item) => item.job_id === targetJobId) ?? null;
      const parentTurnJobs = parentJob
        ? orderedJobs.filter((item) => item.turn_index === parentJob.turn_index)
        : [];
      const nextRevision =
        parentTurnJobs.length > 0
          ? Math.max(...parentTurnJobs.map((item) => item.revision ?? 1)) + 1
          : (parentJob?.revision ?? 1) + 1;
      const localSessionId = parentJob?.session_id || sessionId;

      let optimisticJobId = "";
      if (payload.auto_route) {
        optimisticJobId = `temp-revise-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        upsertJob({
          job_id: optimisticJobId,
          session_id: localSessionId,
          turn_index: parentJob?.turn_index ?? Math.max(0, ...orderedJobs.map((item) => item.turn_index)),
          revision: nextRevision,
          mode: "revise",
          base_job_id: parentJob?.base_job_id ?? targetJobId,
          parent_job_id: targetJobId,
          input_text: payload.instructions,
          status: "running",
          progress: 0,
          stage: "revision_routing",
          events: [],
          created_at: now,
          updated_at: now
        });
        setActiveJobId(optimisticJobId);
      }

      let response: Response;
      try {
        response = await fetch(`/api/v1/jobs/${targetJobId}/revise`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (optimisticJobId) {
          removeJob(optimisticJobId);
          setActiveJobId(targetJobId);
        }
        throw error;
      }

      const data = (await response.json()) as ReviseResponse & { error?: string };
      if (!response.ok) {
        if (optimisticJobId) {
          removeJob(optimisticJobId);
          setActiveJobId(targetJobId);
        }
        throw new Error(data.error || "Revision failed");
      }

      if (optimisticJobId) {
        removeJob(optimisticJobId);
      }

      if (data.action !== "revised") {
        if (optimisticJobId && data.action !== "full_regenerate") {
          removeJob(optimisticJobId);
          setActiveJobId(targetJobId);
        }
        return { ...data, __optimistic_job_id: optimisticJobId || undefined };
      }

      const nextSessionId = data.session_id || localSessionId;
      const returnedJob = data.job;
      if (returnedJob) {
        upsertJob(returnedJob);
        setActiveJobId(returnedJob.job_id);
        setSessionId(returnedJob.session_id || nextSessionId);
        syncUrlWithSession(returnedJob.session_id || nextSessionId, returnedJob.job_id);
      } else {
        const optimisticCreatedAt = new Date().toISOString();
        upsertJob({
          job_id: data.revision_id,
          session_id: nextSessionId,
          turn_index: data.turn_index,
          revision: data.revision,
          mode: "revise",
          base_job_id: data.base_job_id,
          parent_job_id: data.parent_job_id,
          input_text: payload.instructions,
          status: "queued",
          progress: 0,
          stage: "queued",
          events: [],
          rerun_plan: data.rerun_plan,
          changed_artifacts: data.changed_artifacts,
          created_at: optimisticCreatedAt,
          updated_at: optimisticCreatedAt
        });
        setActiveJobId(data.revision_id);
        setSessionId(nextSessionId);
        syncUrlWithSession(nextSessionId, data.revision_id);
      }

      setLoading(true);
      await pollJob(data.status_url, nextSessionId, data.revision_id);
      await refreshSessionHistory();
      return data;
    },
    [orderedJobs, pollJob, refreshSessionHistory, removeJob, sessionId, syncUrlWithSession, upsertJob]
  );

  const runConvertRequest = useCallback(
    async (trimmed: string, options?: { replaceOptimisticJobId?: string; maxSlides?: number }) => {
      const optimisticTurn = Math.max(0, ...orderedJobs.map((item) => item.turn_index)) + 1;
      const response = await fetch("/api/v1/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session_id: sessionId || undefined,
          input_text: trimmed,
          max_slides: options?.maxSlides,
          aspect_ratios: [primaryAspectRatio],
          style_preset: "auto",
          tone: "auto",
          generation_mode: "quote_slides",
          output_language: outputLanguage
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Convert failed");
      }

      const created = data as ConvertResponse;
      const nextSessionId = created.session_id || sessionId;
      if (options?.replaceOptimisticJobId) {
        removeJob(options.replaceOptimisticJobId);
      }
      setSessionId(nextSessionId);
      setSessionTitle((prev) => (prev === "New Session" ? `Session ${nextSessionId.slice(0, 8)}` : prev));
      syncUrlWithSession(nextSessionId, created.job_id);
      upsertJob({
        job_id: created.job_id,
        session_id: nextSessionId,
        turn_index: optimisticTurn,
        revision: 1,
        mode: "generate",
        base_job_id: created.job_id,
        input_text: trimmed,
        status: "queued",
        progress: 0,
        stage: "queued",
        events: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      setActiveJobId(created.job_id);
      await pollJob(created.status_url, nextSessionId, created.job_id);
      await refreshSessionHistory();
    },
    [orderedJobs, outputLanguage, pollJob, primaryAspectRatio, refreshSessionHistory, removeJob, sessionId, syncUrlWithSession, upsertJob]
  );

  const submitInput = async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return;
    const slideCount = parseSlideCountInput(slideCountInput);
    if (slideCount === null) {
      setError("Slide count must be auto or a number between 1 and 8.");
      return;
    }

    setError("");
    setLoading(true);
    setInputText("");
    setSlidePromptDrafts({});
    setSlideOverrides({});
    setSlideEditorOpen({});
    setSlideRegenerating({});

    try {
      if (activeJob?.result) {
        const routed = await requestRevision(activeJob.job_id, {
          instructions: trimmed,
          auto_route: true
        });

        if (routed.action === "revised") {
          return;
        }

        if (routed.action === "ask_clarification") {
          if (routed.__optimistic_job_id) {
            removeJob(routed.__optimistic_job_id);
          }
          if (trimmed.length >= 20) {
            await runConvertRequest(trimmed, { maxSlides: slideCount });
            return;
          }
          setLoading(false);
          setError(routed.question);
          return;
        }

        if (routed.action === "full_regenerate") {
          await runConvertRequest(routed.regenerate_input_text || trimmed, {
            replaceOptimisticJobId: routed.__optimistic_job_id,
            maxSlides: slideCount
          });
          return;
        }
      }

      await runConvertRequest(trimmed, { maxSlides: slideCount });
    } catch (caughtError) {
      setLoading(false);
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitInput(inputText);
  };

  const handleStarterClick = async (starter: StarterCase) => {
    if (loading) return;
    setInputText(starter.payload);
    await submitInput(starter.payload);
  };

  const handleRewriteCopyStyle = async (jobItem: JobResponse) => {
    const instruction = window.prompt("Describe how to rewrite the summary/copy style:", "Make the tone more intense and punchy.");
    if (!instruction?.trim()) return;

    setError("");
    setLoading(true);
    try {
      await requestRevision(jobItem.job_id, {
        intent: "rewrite_copy_style",
        instructions: instruction.trim(),
        editable_fields: ["post_title", "post_caption", "hashtags"],
        preserve_facts: true,
        preserve_slide_structure: true,
        scope: { fields: ["caption", "hook", "hashtags"] },
        options: { preserve_layout: true }
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Rewrite copy style failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRedoAll = async (jobItem: JobResponse) => {
    const sourceText = (jobItem.source_input_text || jobItem.input_text || "").trim();
    if (!sourceText) return;

    setError("");
    setLoading(true);
    setInputText("");
    setSlidePromptDrafts({});
    setSlideOverrides({});
    setSlideEditorOpen({});
    setSlideRegenerating({});
    try {
      await runConvertRequest(sourceText);
    } catch (caughtError) {
      setLoading(false);
      setError(caughtError instanceof Error ? caughtError.message : "Redo all failed");
    }
  };

  const handleOpenHistorySession = async (item: SessionSummary) => {
    setHistoryMenuSessionId("");
    setRenamingSessionId("");
    setRenameDraft("");
    setError("");
    setLoading(true);
    try {
      await loadSession(item.session_id, item.last_job_id);
    } catch (caughtError) {
      setLoading(false);
      setError(caughtError instanceof Error ? caughtError.message : "加载会话失败");
    }
  };

  const applyLocalSessionTitle = useCallback((targetSessionId: string, nextTitle: string) => {
    setSessionHistory((prev) =>
      prev.map((item) =>
        item.session_id === targetSessionId
          ? {
              ...item,
              title: nextTitle,
              updated_at: new Date().toISOString()
            }
          : item
      )
    );

    if (sessionId === targetSessionId) {
      setSessionTitle(nextTitle);
    }
  }, [sessionId]);

  const handleStartRenameSession = (item: SessionSummary) => {
    setHistoryMenuSessionId("");
    setRenamingSessionId(item.session_id);
    setRenameDraft(item.title);
  };

  const handleConfirmRenameSession = async (targetSessionId: string) => {
    const nextTitle = renameDraft.trim();
    if (!nextTitle) return;

    try {
      const response = await fetch(`/api/v1/sessions/${targetSessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title: nextTitle })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `Rename failed: ${response.status}`);
      }

      const payload = (await response.json()) as { title?: string };
      const finalTitle = String(payload.title ?? nextTitle).trim() || nextTitle;
      applyLocalSessionTitle(targetSessionId, finalTitle);
      setRenamingSessionId("");
      setRenameDraft("");
      void refreshSessionHistory();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Rename session failed");
    }
  };

  const handleDeleteSession = async (targetSessionId: string) => {
    const shouldDelete = window.confirm("Delete this chat session?");
    if (!shouldDelete) return;

    try {
      const response = await fetch(`/api/v1/sessions/${targetSessionId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `Delete failed: ${response.status}`);
      }

      setHistoryMenuSessionId("");
      setRenamingSessionId("");
      setRenameDraft("");
      setSessionHistory((prev) => prev.filter((item) => item.session_id !== targetSessionId));

      if (sessionId === targetSessionId) {
        resetConversation();
      } else {
        void refreshSessionHistory();
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Delete session failed");
    }
  };

  const resetConversation = () => {
    pollingVersionRef.current += 1;
    setSessionId("");
    setSessionTitle("New Session");
    setInputText("");
    setSessionJobs([]);
    setActiveJobId("");
    setLoading(false);
    setError("");
    setSlidePromptDrafts({});
    setSlideOverrides({});
    setSlideEditorOpen({});
    setSlideRegenerating({});
    setAuditByJob({});
    setAuditLoadingByJob({});
    setAuditErrorByJob({});
    setActiveSlideIndex(0);
    syncUrlWithSession(undefined, undefined);
    void refreshSessionHistory();
  };

  const goToSlide = (targetIndex: number) => {
    const viewport = carouselViewportRef.current;
    if (!viewport) return;

    const clamped = Math.max(0, Math.min(targetIndex, (activeJob?.result?.slides.length ?? 1) - 1));
    viewport.scrollTo({
      left: clamped * viewport.clientWidth,
      behavior: "smooth"
    });
    setActiveSlideIndex(clamped);
  };

  const togglePromptEditor = (slideId: number, initialPrompt: string) => {
    setSlidePromptDrafts((prev) => ({
      ...prev,
      [slideId]: prev[slideId] ?? initialPrompt
    }));
    setSlideEditorOpen((prev) => ({
      ...prev,
      [slideId]: !prev[slideId]
    }));
  };

  const regenerateSlide = async (slideId: number, originalPrompt: string) => {
    if (!activeJob?.result) return;

    const draft = (slidePromptDrafts[slideId] ?? originalPrompt).trim();
    if (!draft) return;

    setSlideRegenerating((prev) => ({ ...prev, [slideId]: true }));
    setError("");

    try {
      const isCover = slideId === 1;
      const unchangedPrompt = draft === originalPrompt;

      await requestRevision(activeJob.job_id, {
        intent: isCover ? "regenerate_cover" : "regenerate_slides",
        instructions: unchangedPrompt ? "Regenerate with a new random seed." : draft,
        scope: { slide_ids: [slideId] },
        options: {
          mode: unchangedPrompt ? "same_prompt_new_seed" : "reprompt",
          preserve_layout: true
        }
      });

      setSlideEditorOpen((prev) => ({ ...prev, [slideId]: false }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Regenerate image failed");
    } finally {
      setSlideRegenerating((prev) => ({ ...prev, [slideId]: false }));
    }
  };

  const runAudit = useCallback(async (jobItem: JobResponse) => {
    if (!jobItem.result) return;

    setAuditLoadingByJob((prev) => ({ ...prev, [jobItem.job_id]: true }));
    setAuditErrorByJob((prev) => ({ ...prev, [jobItem.job_id]: "" }));

    try {
      const response = await fetch("/api/v1/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          output_language: outputLanguage,
          target_audience: "business readers",
          platform: jobItem.result.platform_type,
          models: [
            "google/gemini-3-flash-preview",
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-sonnet",
            "minimax/minimax-m2.5"
          ],
          slides: jobItem.result.slides.map((slide) => ({
            slide_id: slide.slide_id,
            content_quote: slide.content_quote,
            image_url: slide.image_url,
            visual_prompt: slide.visual_prompt
          }))
        })
      });

      const data = (await response.json().catch(() => null)) as AuditResponse | { error?: string } | null;
      if (!response.ok || !data || !(data as AuditResponse).model_scores) {
        throw new Error((data as { error?: string } | null)?.error ?? `Audit failed: ${response.status}`);
      }

      setAuditByJob((prev) => ({ ...prev, [jobItem.job_id]: data as AuditResponse }));
    } catch (caughtError) {
      setAuditErrorByJob((prev) => ({
        ...prev,
        [jobItem.job_id]: caughtError instanceof Error ? caughtError.message : "Audit failed"
      }));
    } finally {
      setAuditLoadingByJob((prev) => ({ ...prev, [jobItem.job_id]: false }));
    }
  }, [outputLanguage]);

  const downloadZipBundle = useCallback(async (jobItem: JobResponse) => {
    if (!jobItem.result) return;
    setDownloadLoadingByJob((prev) => ({ ...prev, [jobItem.job_id]: true }));

    try {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobItem.job_id)}/download`, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `Download failed: ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const matched = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
      const decoded = matched?.[1] ? decodeURIComponent(matched[1].replace(/^"+|"+$/g, "")) : "";
      const fileName = decoded || `clawvisual-${jobItem.job_id.slice(0, 8)}.zip`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Download failed");
    } finally {
      setDownloadLoadingByJob((prev) => ({ ...prev, [jobItem.job_id]: false }));
    }
  }, []);

  const latestEventId = activeJob?.events?.[activeJob.events.length - 1]?.id;

  const renderResultContent = (jobItem: JobResponse) => {
    if (!jobItem.result) {
      return (
        <p className="vf-empty-result">
          {jobItem.status === "failed"
            ? jobItem.error || "Task failed."
            : "clawvisual is thinking..."}
        </p>
      );
    }

    const result = jobItem.result;
    const audit = auditByJob[jobItem.job_id];
    const isAuditLoading = !!auditLoadingByJob[jobItem.job_id];
    const auditError = auditErrorByJob[jobItem.job_id];
    const isDownloadLoading = !!downloadLoadingByJob[jobItem.job_id];

    return (
      <div className="vf-result-content">
        <h2>{result.post_title}</h2>
        <p className="vf-result-source">Platform: {result.platform_type}</p>
        <p className="vf-result-source">Aspect ratio: {result.aspect_ratio}</p>

        <article className="vf-caption-card">
          <h3>Post Caption</h3>
          <p>{result.post_caption}</p>
          <div className="vf-hashtags">
            {result.hashtags.map((tag) => (
              <span key={`${jobItem.job_id}-${tag}`} className="vf-hashtag">{tag}</span>
            ))}
          </div>
          <div className="vf-revision-actions">
            <button
              type="button"
              className="vf-slide-edit-btn"
              onClick={() => void handleRewriteCopyStyle(jobItem)}
              disabled={loading}
            >
              Rewrite Copy
            </button>
            <button
              type="button"
              className="vf-slide-edit-btn"
              onClick={() => void regenerateSlide(1, result.slides.find((slide) => slide.slide_id === 1)?.visual_prompt ?? "")}
              disabled={loading || !result.slides.some((slide) => slide.slide_id === 1)}
            >
              Regenerate Cover
            </button>
            <button
              type="button"
              className="vf-slide-edit-btn"
              onClick={() => void handleRedoAll(jobItem)}
              disabled={loading}
            >
              Redo All
            </button>
            <button
              type="button"
              className="vf-slide-edit-btn"
              onClick={() => void runAudit(jobItem)}
              disabled={loading || isAuditLoading}
            >
              {isAuditLoading ? "Auditing..." : "Run LLM Audit"}
            </button>
            <button
              type="button"
              className="vf-slide-edit-btn vf-download-zip-btn"
              onClick={() => void downloadZipBundle(jobItem)}
              disabled={loading || isDownloadLoading}
            >
              <Download size={14} />
              <span>{isDownloadLoading ? "Preparing..." : "Download ZIP"}</span>
            </button>
          </div>
        </article>

        {audit || auditError ? (
          <article className="vf-audit-card">
            <div className="vf-audit-head">
              <h3>LLM Audit Scores</h3>
              {audit ? (
                <span className="vf-audit-summary">
                  Avg {audit.summary.overall_average_score} · {audit.summary.models_succeeded}/{audit.summary.models_requested}
                </span>
              ) : null}
            </div>
            {auditError ? <p className="vf-audit-error">{auditError}</p> : null}
            {audit ? (
              <div className="vf-audit-table-wrap">
                <table className="vf-audit-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Readability</th>
                      <th>Aesthetics</th>
                      <th>Alignment</th>
                      <th>Issue</th>
                      <th>Suggestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.model_scores.map((item) => (
                      <tr key={`${jobItem.job_id}-${item.model}`}>
                        <td>{item.model}</td>
                        <td>{item.status}</td>
                        <td>{item.total_score ?? "-"}</td>
                        <td>{item.dimensions?.readability ?? "-"}</td>
                        <td>{item.dimensions?.aesthetics ?? "-"}</td>
                        <td>{item.dimensions?.alignment ?? "-"}</td>
                        <td>{item.critical_issue}</td>
                        <td>{item.fix_suggestion}{item.error ? ` (${item.error})` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </article>
        ) : null}

        <div className="vf-result-grid">
          <article>
            <h3>Slides</h3>
            <div className="vf-carousel-shell">
              <button
                type="button"
                className="vf-carousel-nav"
                aria-label="Previous slide"
                onClick={() => goToSlide(activeSlideIndex - 1)}
                disabled={activeSlideIndex <= 0}
              >
                <ChevronLeft size={16} />
              </button>

              <div
                className="vf-carousel-viewport"
                ref={carouselViewportRef}
                onScroll={(event) => {
                  const viewport = event.currentTarget;
                  if (!viewport.clientWidth) return;
                  const current = Math.round(viewport.scrollLeft / viewport.clientWidth);
                  setActiveSlideIndex(current);
                }}
              >
                {result.slides.map((slide) => {
                  const override = slideOverrides[slide.slide_id];
                  const imageUrl = override?.image_url ?? slide.image_url;
                  const promptValue = slidePromptDrafts[slide.slide_id] ?? override?.visual_prompt ?? slide.visual_prompt;
                  const isEditing = !!slideEditorOpen[slide.slide_id];
                  const isRegenerating = !!slideRegenerating[slide.slide_id];

                  return (
                    <div key={`${jobItem.job_id}-${slide.slide_id}`} className="vf-slide-card vf-carousel-slide">
                      <div className="vf-slide-thumb-wrap">
                        {imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt={`Slide ${slide.slide_id}`} className="vf-slide-thumb" />
                        ) : (
                          <div className="vf-slide-thumb vf-slide-thumb-empty">No image</div>
                        )}
                        {slide.is_cover ? <span className="vf-slide-cover-badge">Cover</span> : null}
                      </div>

                      <p className="vf-slide-quote">
                        <strong>{slide.slide_id}.</strong> {slide.content_quote}
                      </p>

                      <div className="vf-slide-keywords">
                        {slide.focus_keywords.map((keyword) => (
                          <span key={`${jobItem.job_id}-${slide.slide_id}-${keyword}`}>{keyword}</span>
                        ))}
                      </div>

                      <button
                        type="button"
                        className="vf-slide-edit-btn"
                        onClick={() => togglePromptEditor(slide.slide_id, promptValue)}
                      >
                        Edit Prompt
                      </button>

                      {isEditing ? (
                        <div className="vf-slide-editor">
                          <textarea
                            value={promptValue}
                            onChange={(event) =>
                              setSlidePromptDrafts((prev) => ({
                                ...prev,
                                [slide.slide_id]: event.target.value
                              }))
                            }
                            rows={4}
                          />
                          <button
                            type="button"
                            className="vf-slide-regenerate-btn"
                            onClick={() => void regenerateSlide(slide.slide_id, slide.visual_prompt)}
                            disabled={isRegenerating}
                          >
                            {isRegenerating ? "Generating..." : "Regenerate"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="vf-carousel-nav"
                aria-label="Next slide"
                onClick={() => goToSlide(activeSlideIndex + 1)}
                disabled={activeSlideIndex >= result.slides.length - 1}
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="vf-carousel-dots">
              {result.slides.map((slide, idx) => (
                <button
                  key={`dot-${jobItem.job_id}-${slide.slide_id}`}
                  type="button"
                  className={`vf-carousel-dot ${activeSlideIndex === idx ? "is-active" : ""}`}
                  aria-label={`Go to slide ${idx + 1}`}
                  onClick={() => goToSlide(idx)}
                />
              ))}
            </div>
          </article>

          <article>
            <h3>Skill Logs</h3>
            <ul>
              {result.skill_logs.map((log) => (
                <li key={`${jobItem.job_id}-${log.skill_name}-${log.status}`}>
                  <strong>{log.skill_name}</strong> ({log.status}) - {log.output_preview}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    );
  };

  return (
    <main className={`vf-workbench ${sidebarCollapsed ? "is-collapsed" : ""}`}>
      <header className="vf-topbar">
        <div className="vf-top-left">
          <div className="vf-breadcrumb">
            <FolderKanban size={15} />
            <span>Default Project</span>
            <span>/</span>
            <span className="is-strong">{sessionTitle || "New Session"}</span>
          </div>
        </div>

        {/* <div className="vf-top-task-pill">
          <span className="vf-task-count">{activeJob?.events?.length ?? 0}/13</span>
          <span>clawvisual conversion pipeline</span>
          <ChevronDown size={14} />
        </div> */}

        <div className="vf-top-right">
          <button type="button" className="vf-upgrade-btn" onClick={() => setPricingOpen(true)}>
            <Rocket size={14} />
            Upgrade
          </button>

          <div className="vf-account-wrap" ref={accountMenuRef}>
            <button
              type="button"
              className="vf-avatar-btn"
              onClick={() => setAccountMenuOpen((prev) => !prev)}
              aria-label="Open account menu"
              aria-expanded={accountMenuOpen}
            >
              z
            </button>

            {accountMenuOpen ? (
              <div className="vf-account-menu">
                <div className="vf-account-user">
                  <div className="vf-account-avatar-placeholder">z</div>
                  <div>
                    <p className="vf-account-name">clawvisual User</p>
                    <p className="vf-account-email">user@example.com</p>
                  </div>
                </div>

                <div className="vf-subscription-card">
                  <div className="vf-subscription-head">
                    <span>Free</span>
                    <button
                      type="button"
                      className="vf-mini-upgrade"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setPricingOpen(true);
                      }}
                    >
                      Upgrade
                    </button>
                  </div>
                  <p>Free daily credits: 1,000</p>
                  <p>Add-on credits: 0</p>
                </div>

                <button type="button" className="vf-account-item">
                  <Settings size={16} />
                  Subscription settings
                </button>
                <button type="button" className="vf-account-item">
                  <Mail size={16} />
                  Contact us
                </button>
                <button type="button" className="vf-account-item vf-signout">
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="vf-body">
        <aside ref={sidebarRef} className="vf-sidebar" aria-label="Sidebar menu">
          {sidebarCollapsed ? (
            <button
              type="button"
              className="vf-sidebar-brand vf-sidebar-brand-collapsed"
              title="Expand sidebar"
              aria-label="Expand sidebar"
              onClick={() => setSidebarCollapsed(false)}
            >
              <span className="vf-brand-logo">
                <Image src="/logo.png" alt="clawvisual logo" width={28} height={28} className="vf-brand-logo-img" />
              </span>
            </button>
          ) : (
            <div className="vf-sidebar-head">
              <div className="vf-sidebar-brand" aria-label="clawvisual AI">
                <span className="vf-brand-logo">
                  <Image src="/logo.png" alt="clawvisual logo" width={28} height={28} className="vf-brand-logo-img" />
                </span>
                <span className="vf-brand-text">clawvisual AI</span>
              </div>
              <button
                type="button"
                className="vf-sidebar-toggle-icon"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
          )}

          <div className="vf-menu">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  className={`vf-menu-item ${item.active ? "is-active" : ""}`}
                  type="button"
                  title={item.label}
                  onClick={() => {
                    if (item.label === "New Session") {
                      resetConversation();
                    }
                  }}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {!sidebarCollapsed ? (
            <section className="vf-history">
              <p className="vf-history-title">Your chats</p>
              <div className="vf-history-list">
                {sessionHistory.length ? (
                  sessionHistory.map((item) => (
                    <article
                      key={item.session_id}
                      className={`vf-history-item ${sessionId === item.session_id ? "is-active" : ""}`}
                      data-history-menu-root
                    >
                      {renamingSessionId === item.session_id ? (
                        <form
                          className="vf-history-rename-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleConfirmRenameSession(item.session_id);
                          }}
                        >
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            autoFocus
                            maxLength={120}
                          />
                          <div className="vf-history-rename-actions">
                            <button type="submit" aria-label="Save title">
                              <Check size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel rename"
                              onClick={() => {
                                setRenamingSessionId("");
                                setRenameDraft("");
                              }}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="vf-history-main"
                          onClick={() => void handleOpenHistorySession(item)}
                          title={item.title}
                        >
                          <span className="vf-history-item-title">{item.title}</span>
                          <span className="vf-history-item-meta">
                            {item.job_count} turns · {new Date(item.updated_at).toLocaleDateString()}
                          </span>
                        </button>
                      )}

                      {renamingSessionId === item.session_id ? null : (
                        <button
                          type="button"
                          className="vf-history-more"
                          aria-label="More actions"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (historyMenuSessionId === item.session_id) {
                              setHistoryMenuSessionId("");
                              return;
                            }

                            const rect = event.currentTarget.getBoundingClientRect();
                            const sidebarRect = sidebarRef.current?.getBoundingClientRect();
                            if (!sidebarRect) return;
                            const menuWidth = 160;
                            const menuHeight = 94;
                            const sidebarPadding = 8;

                            let left = rect.right - sidebarRect.left - menuWidth;
                            if (left < sidebarPadding) {
                              left = sidebarPadding;
                            } else if (left + menuWidth > sidebarRect.width - sidebarPadding) {
                              left = sidebarRect.width - menuWidth - sidebarPadding;
                            }

                            let top = rect.bottom - sidebarRect.top + 6;
                            if (top + menuHeight > sidebarRect.height - sidebarPadding) {
                              top = Math.max(sidebarPadding, rect.top - sidebarRect.top - menuHeight - 6);
                            }

                            setHistoryMenuPosition({ top, left });
                            setHistoryMenuSessionId(item.session_id);
                          }}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="vf-history-empty">No sessions yet.</p>
                )}
              </div>
              {activeHistoryMenuItem && historyMenuPosition ? (
                <div
                  className="vf-history-menu-popover"
                  data-history-menu-popover
                  style={{
                    top: `${historyMenuPosition.top}px`,
                    left: `${historyMenuPosition.left}px`
                  }}
                >
                  <button
                    type="button"
                    className="vf-history-menu-action"
                    onClick={() => handleStartRenameSession(activeHistoryMenuItem)}
                  >
                    <PencilLine size={14} />
                    Rename
                  </button>
                  <button
                    type="button"
                    className="vf-history-menu-action is-danger"
                    onClick={() => void handleDeleteSession(activeHistoryMenuItem.session_id)}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>

        <section className={`vf-center ${isConversationMode ? "is-chat-mode" : ""}`}>
          <div className={`vf-center-scroll ${!isConversationMode ? "is-landing" : "is-chat-scroll"}`}>
            {!isConversationMode ? (
              <div className="vf-landing-content">
                <div className="vf-center-head">
                  <h1 className="vf-title">Start Generating With Clawvisual</h1>
                </div>

                {isNewConversation ? (
                  <section className="vf-starter-section vf-starter-top">
                    <div className="vf-starter-grid">
                      {STARTER_CASES.map((starter) => (
                        <button
                          key={starter.id}
                          type="button"
                          className="vf-starter-card"
                          onClick={() => void handleStarterClick(starter)}
                        >
                          <div className="vf-starter-badge">{starter.badge}</div>
                          <p className="vf-starter-title">{starter.title}</p>
                          <p className="vf-starter-desc">{starter.description}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <section className={`vf-result-panel vf-result-panel-chat ${activeJob?.result ? "is-ready" : "is-pending"}`}>
                {orderedJobs.length ? (
                  orderedJobs.map((turn) => {
                    const isActive = turn.job_id === (activeJob?.job_id ?? "");
                    return (
                      <div key={turn.job_id}>
                        <article className="vf-chat-message is-user">
                          <p>{turn.input_text}</p>
                        </article>

                        <article
                          className="vf-chat-message is-assistant"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setActiveJobId(turn.job_id);
                            syncUrlWithSession(turn.session_id || sessionId, turn.job_id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setActiveJobId(turn.job_id);
                            syncUrlWithSession(turn.session_id || sessionId, turn.job_id);
                          }}
                        >
                          <div className="vf-result-meta">
                            <span>
                              Turn #{turn.turn_index} · Rev #{turn.revision ?? 1} · Status: {turn.progress}% · {turn.stage ?? "waiting"}
                            </span>
                            {isActive ? <span>Active</span> : <span>Click to inspect</span>}
                          </div>

                          {isActive ? (
                            renderResultContent(turn)
                          ) : (
                            <p className="vf-empty-result">
                              {turn.result ? turn.result.post_title : "clawvisual is thinking..."}
                            </p>
                          )}
                        </article>
                      </div>
                    );
                  })
                ) : (
                  <article className="vf-chat-message is-assistant">
                    <div className="vf-result-meta">
                      <span>Status: {progressLabel}</span>
                      {error ? <span className="vf-error">{error}</span> : null}
                    </div>
                    <p className="vf-empty-result">
                      {loading ? "clawvisual is thinking..." : "Result will appear here after the pipeline completes."}
                    </p>
                  </article>
                )}
              </section>
            )}
          </div>

          <form onSubmit={handleSubmit} className="vf-composer vf-main-composer">
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                if ((event.nativeEvent as { isComposing?: boolean }).isComposing) return;
                if (!canSubmit) return;
                event.preventDefault();
                void submitInput(inputText);
              }}
              rows={isConversationMode ? 2 : 4}
              required
              placeholder="message clawvisual ai"
              className="vf-textarea"
            />

            <div className="vf-composer-bottom">
              <div className="vf-toolbar-left">
                {/* Attachment tool is intentionally hidden in current UI scope. */}
                <select
                  value={outputLanguage}
                  onChange={(event) => setOutputLanguage(normalizeLanguage(event.target.value))}
                  className="vf-language-select"
                  aria-label="Output language"
                >
                  {SUPPORTED_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_LABELS[code]}
                    </option>
                  ))}
                </select>
                <select
                  value={primaryAspectRatio}
                  onChange={(event) => setPrimaryAspectRatio(event.target.value as AspectRatio)}
                  className="vf-language-select"
                  aria-label="Aspect ratio"
                >
                  {ASPECT_RATIO_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="vf-slide-count-control" ref={slideCountControlRef}>
                  <span className="vf-slide-count-caption">Slides</span>
                  <input
                    value={slideCountInput}
                    onChange={(event) => setSlideCountInput(event.target.value)}
                    onBlur={(event) => {
                      const parsed = parseSlideCountInput(event.target.value);
                      if (parsed == null) {
                        setSlideCountInput("auto");
                        return;
                      }
                      setSlideCountInput(String(parsed));
                    }}
                    className="vf-language-select vf-slide-count-input"
                    aria-label="Slide count"
                    placeholder="Slide count"
                  />
                  <button
                    type="button"
                    className="vf-slide-count-toggle"
                    aria-label="Open slide count options"
                    onClick={() => setSlideCountMenuOpen((prev) => !prev)}
                  >
                    <ChevronDown size={13} />
                  </button>
                  {slideCountMenuOpen ? (
                    <div
                      ref={slideCountMenuRef}
                      className={`vf-slide-count-menu ${slideCountMenuPlacement === "up" ? "is-up" : ""}`}
                      style={{ maxHeight: `${slideCountMenuMaxHeight}px` }}
                      role="listbox"
                      aria-label="Slide count options"
                    >
                      {SLIDE_COUNT_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`vf-slide-count-option ${slideCountInput.trim().toLowerCase() === option ? "is-active" : ""}`}
                          onClick={() => {
                            setSlideCountInput(option);
                            setSlideCountMenuOpen(false);
                          }}
                        >
                          {option === "auto" ? "auto (LLM decides)" : `${option} slides`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="vf-toolbar-right">
                <button disabled={!canSubmit} type="submit" className="vf-send-btn">
                  {loading ? "Running" : "Run"}
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </form>
        </section>

        <aside className="vf-right-panel">
          <div className="vf-right-header">
            <h2>Thinking & Actions</h2>
            <p>{activeJob?.events?.length ?? 0} steps</p>
          </div>

          <div className="vf-events-list">
            {activeJob?.events?.length ? (
              activeJob.events.map((event) => (
                <article key={event.id} className={`vf-event-card ${latestEventId === event.id ? "is-latest" : ""}`}>
                  <div className="vf-event-head">
                    <span className="vf-event-index">{event.index}</span>
                    <h3>{event.title}</h3>
                  </div>
                  <p>{event.thought}</p>
                  <p>{event.action}</p>
                  {event.outputPreview ? <p className="vf-event-preview">(completed) - {event.outputPreview}</p> : null}
                  <div className="vf-event-meta">
                    <span>Duration: {event.durationSec}s</span>
                    {/* <span>Cost: ${event.costUsd.toFixed(3)}</span> */}
                    {event.tokenTotal ? (
                      <span>
                        Tokens: in {event.tokenInput ?? 0} / out {event.tokenOutput ?? 0} / total {event.tokenTotal}
                      </span>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="vf-empty-events">No actions yet. Submit a task to start event logs.</p>
            )}
          </div>
        </aside>
      </div>

      {pricingOpen ? (
        <div className="vf-pricing-overlay" role="dialog" aria-modal="true" aria-label="Pricing plans">
          <div className="vf-pricing-shell">
            <button type="button" className="vf-pricing-close" onClick={() => setPricingOpen(false)}>
              <X size={18} />
            </button>

            <div className="vf-pricing-head">
              <h2>Pricing</h2>
              <p>Start for free. Upgrade to unlock higher capacity and faster generation.</p>
            </div>

            <div className="vf-pricing-grid">
              <article className="vf-plan-card">
                <h3>Free</h3>
                <p className="vf-plan-price">$0</p>
                <p className="vf-plan-sub">Free forever</p>
                <button type="button" className="vf-plan-btn is-muted">
                  Your current plan
                </button>
                <ul>
                  <li><Check size={14} /> 1,000 daily credits</li>
                  <li><Check size={14} /> Limited AI models</li>
                  <li><Check size={14} /> Up to 100 saved materials</li>
                </ul>
              </article>

              <article className="vf-plan-card is-featured">
                <h3>Pro</h3>
                <p className="vf-plan-price">$20 <span>USD / month</span></p>
                <p className="vf-plan-sub">Boost your everyday creativity.</p>
                <button type="button" className="vf-plan-btn">
                  Get Pro
                </button>
                <ul>
                  <li><Check size={14} /> 20,000 credits per month</li>
                  <li><Check size={14} /> Unlimited AI model access</li>
                  <li><Check size={14} /> Unlimited materials</li>
                  <li><Check size={14} /> Advanced writing and image generation</li>
                </ul>
              </article>

              <article className="vf-plan-card">
                <h3>Max</h3>
                <p className="vf-plan-price">$100 <span>USD / month</span></p>
                <p className="vf-plan-sub">Unlock full-scale creation workflow.</p>
                <button type="button" className="vf-plan-btn">
                  Get Max
                </button>
                <ul>
                  <li><Check size={14} /> 200,000 credits per month</li>
                  <li><Check size={14} /> Fastest generation queue</li>
                  <li><Check size={14} /> Unlimited uploads and parsing</li>
                  <li><Check size={14} /> Premium support</li>
                </ul>
              </article>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
