/**
 * Tally Automation Demo Form Logic
 * Rebuilt from scratch per specification.
 */

export interface LeadFormConfig {
  contactSource: string;
  defaultRouterId: string;
  channelPartnerRouterId: string;
  triggerSelector: string;
  webhookUrl: string;
  blockedTools: string[];
  debug: boolean;
  webhookOnAllPaths?: boolean;
  formSelector: string;
  fieldIdPrefix: string;
  successSelector: string;
  generalErrorSelector: string;
}

const CLICK_ID_MAP: Record<string, string> = {
  gclid: "hs_google_click_id",
  fbclid: "hs_facebook_click_id",
  li_fat_id: "hs_linkedin_click_id",
};

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "placements",
  "utm_device",
  "gclid", // Per bug note, gclid appears in both UTM list and click-ID map!
];

const DEFAULT_SCHEDULER_SRC = "https://assets.revenuehero.io/scheduler.min.js";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Win = Window & { RevenueHero?: any; hero?: any };

let schedulerPromise: Promise<boolean> | null = null;
function loadScheduler(): Promise<boolean> {
  if ((window as Win).RevenueHero) return Promise.resolve(true);
  if (schedulerPromise) return schedulerPromise;

  schedulerPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${DEFAULT_SCHEDULER_SRC}"]`,
    );
    const script = existing || document.createElement("script");

    const done = () => resolve(Boolean((window as Win).RevenueHero));
    script.addEventListener("load", done);
    script.addEventListener("error", () => resolve(false));

    if (!existing) {
      script.src = DEFAULT_SCHEDULER_SRC;
      script.async = true;
      document.head.appendChild(script);
    }

    if (existing && (window as Win).RevenueHero) resolve(true);
  });
  return schedulerPromise;
}

export function captureAttribution(form: HTMLFormElement, contactSource: string): void {
  const params = new URLSearchParams(window.location.search);
  const data: Record<string, string> = {};

  // 1. Click IDs (map + sessionStorage logic)
  const clickIdStorageKey = "__clickids";
  let storedClickIds: Record<string, string> = {};
  try {
    storedClickIds = JSON.parse(sessionStorage.getItem(clickIdStorageKey) || "{}");
  } catch (e) {}

  Object.entries(CLICK_ID_MAP).forEach(([urlParam, hsInputName]) => {
    const fromUrl = params.get(urlParam);
    if (fromUrl) {
      storedClickIds[hsInputName] = fromUrl;
      data[hsInputName] = fromUrl;
    } else if (storedClickIds[hsInputName]) {
      data[hsInputName] = storedClickIds[hsInputName];
    }
  });

  try {
    sessionStorage.setItem(clickIdStorageKey, JSON.stringify(storedClickIds));
  } catch (e) {}

  // 2. UTM Params (no deduping, no session storage for these)
  UTM_PARAMS.forEach((param) => {
    const value = params.get(param);
    if (value) data[param] = value;
  });

  // 3. Contact source
  data.contact_source = contactSource;

  // 4. Inject hidden inputs
  Object.entries(data).forEach(([name, value]) => {
    if (!value) return;
    let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  });
}

export function initLeadForm(config: LeadFormConfig): void {
  const form = document.querySelector<HTMLFormElement>(config.formSelector);
  if (!form) return;

  if (form.dataset.leadFormBound === "true") {
    captureAttribution(form, config.contactSource);
    return;
  }
  form.dataset.leadFormBound = "true";

  const log = (...args: unknown[]) => {
    if (config.debug) console.log("[LeadForm]", ...args);
  };

  const byName = <T extends HTMLElement>(name: string) =>
    document.getElementById(`${config.fieldIdPrefix}${name}`) as T | null;
  
  const nameInput = byName<HTMLInputElement>("first_name");
  const emailInput = byName<HTMLInputElement>("email");
  const phoneInput = byName<HTMLInputElement>("lg__phone");
  const generalErr = document.querySelector<HTMLElement>(config.generalErrorSelector);
  const successMsg = document.querySelector<HTMLElement>(config.successSelector);

  captureAttribution(form, config.contactSource);

  const setFieldError = (field: HTMLElement | null, name: string, isError: boolean, message?: string) => {
    if (!field) return;
    field.style.border = isError ? "2px solid #dc2626" : "";
    field.style.borderRadius = isError ? "6px" : "";
    
    let span = document.getElementById(`${field.id}-error-msg`);
    if (isError) {
      if (!span) {
        span = document.createElement("span");
        span.id = `${field.id}-error-msg`;
        span.style.color = "#dc2626";
        span.style.fontSize = "12px";
        span.style.display = "block";
        span.style.marginTop = "4px";
        field.parentNode?.insertBefore(span, field.nextSibling);
      }
      span.textContent = message || "";
      span.style.display = "block";
    } else if (span) {
      span.style.display = "none";
    }
  };

  const clearOn = (field: HTMLElement | null, name: string) => {
    if (!field) return;
    const clear = () => {
      setFieldError(field, name, false);
      generalErr?.classList.add("hidden");
    };
    // No "focus" here: validate() focuses the first bad field right after
    // showing its error, and a focus-triggered clear would wipe it instantly.
    field.addEventListener("input", clear);
    field.addEventListener("change", clear);
  };

  clearOn(nameInput, "first_name");
  clearOn(emailInput, "email");
  clearOn(phoneInput, "lg__phone");
  
  const requiredSelects = Array.from(
    form.querySelectorAll<HTMLSelectElement>("select[required]"),
  );
  requiredSelects.forEach((select) => clearOn(select, select.name));

  phoneInput?.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
  });

  const validate = (): boolean => {
    // Checks run in visual field order; only the FIRST failing field shows
    // its error — the user is guided through the form one step at a time.
    type Check = {
      field: HTMLElement | null;
      name: string;
      message: string;
      ok: boolean;
    };

    const nameVal = nameInput?.value.trim() || "";
    const emailVal = emailInput?.value.trim() || "";
    const digits = (phoneInput?.value || "").replace(/\D/g, "");

    const checks: Check[] = [
      {
        field: nameInput,
        name: "first_name",
        message: "Please enter your name",
        ok: Boolean(nameVal),
      },
      {
        field: emailInput,
        name: "email",
        message: !emailVal
          ? "Please enter a valid email address"
          : "Invalid email format (e.g. name@company.com)",
        ok: Boolean(emailVal) && EMAIL_RE.test(emailVal),
      },
      {
        field: phoneInput,
        name: "lg__phone",
        message: "Phone number must be exactly 10 digits",
        ok: digits.length === 10,
      },
      ...requiredSelects.map((select) => ({
        field: select as HTMLElement,
        name: select.name,
        message: "Please select an option",
        ok: Boolean(select.value),
      })),
    ];

    const firstBad = checks.find((c) => !c.ok);
    checks.forEach((c) => setFieldError(c.field, c.name, c === firstBad, c.message));

    if (firstBad?.field) {
      firstBad.field.scrollIntoView({ behavior: "smooth", block: "center" });
      firstBad.field.focus({ preventScroll: true });
    }

    return !firstBad;
  };

  const postWebhook = (payload: Record<string, string>, event: string) =>
    fetch(config.webhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        ...payload,
        __page: window.location.href,
        __event: event,
      }),
      keepalive: true,
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    generalErr?.classList.add("hidden");

    captureAttribution(form, config.contactSource);

    if (!validate()) {
      log("validation failed — nothing fired");
      return;
    }

    const payload: Record<string, string> = {};
    new FormData(form).forEach((value, key) => {
      const str = value.toString().trim();
      if (str) payload[key] = str;
    });

    const tool = payload.which_accounting_tool_do_you_use || "";
    const role = payload.which_best_describes_you || "";
    const isChannelPartner = role.trim().toLowerCase().startsWith("channel partner");
    const isBlocked = config.blockedTools.some(
      (blocked) => blocked.toLowerCase() === tool.toLowerCase(),
    );

    let trigger = document.querySelector<HTMLElement>(config.triggerSelector);

    /* --- 1. blocked tool: webhook only, widget never loads --- */
    if (isBlocked) {
      log("route: BLOCKED TOOL", { tool, isChannelPartner, chosenRouterId: null });
      if (config.debug) console.table(payload);

      const label = trigger?.textContent;
      if (trigger) {
        trigger.style.pointerEvents = "none";
        trigger.style.opacity = "0.6";
        trigger.textContent = "Submitting...";
      }

      try {
        await postWebhook(payload, "form_submit_blocked_tool");
        form.style.display = "none";
        successMsg?.classList.remove("hidden");
      } catch (err) {
        console.error("[LeadForm] Webhook failed:", err);
        generalErr?.classList.remove("hidden");
        if (trigger) {
          trigger.style.pointerEvents = "";
          trigger.style.opacity = "";
          trigger.textContent = label || "Submit";
        }
      }
      return;
    }

    /* --- 2 & 3. channel partner / default: open the widget --- */
    const chosenRouterId = isChannelPartner
      ? config.channelPartnerRouterId
      : config.defaultRouterId;

    log("route: REVENUEHERO", { tool, isChannelPartner, chosenRouterId });
    if (config.debug) console.table(payload);

    if (config.webhookOnAllPaths) {
      postWebhook(payload, "form_submit_scheduled").catch(() => {});
    }

    if (!(await loadScheduler())) {
      console.error("[LeadForm] RevenueHero scheduler unavailable.");
      generalErr?.classList.remove("hidden");
      return;
    }

    const RH = (window as Win).RevenueHero;
    if (!RH) {
      generalErr?.classList.remove("hidden");
      return;
    }

    // STALE BINDING BUG prevention
    if (trigger) {
      const clone = trigger.cloneNode(true) as HTMLElement;
      trigger.parentNode?.replaceChild(clone, trigger);
    }

    const hero = new RH({ routerId: String(chosenRouterId) });
    (window as Win).hero = hero;

    // RevenueHero's programmatic API: submit() only creates the scheduling
    // session — the popup must be opened explicitly with dialog.open().
    try {
      const sessionData = await hero.submit(payload);
      if (sessionData) {
        hero.dialog.open(sessionData);
      } else {
        log("hero.submit returned no session data");
        generalErr?.classList.remove("hidden");
      }
    } catch (err) {
      console.error("[LeadForm] RevenueHero submit failed:", err);
      generalErr?.classList.remove("hidden");
    }
  });

  void loadScheduler();
}

export function bindLeadForm(config: LeadFormConfig): void {
  const run = () => initLeadForm(config);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  document.addEventListener("astro:page-load", run);
}
