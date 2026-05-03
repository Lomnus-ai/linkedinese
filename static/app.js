(() => {
  const root = document.documentElement;
  const themeToggle = document.getElementById("theme-toggle");
  const directionRadios = document.querySelectorAll('input[name="direction"]');
  const modelSelect = document.getElementById("model");
  const inputEl = document.getElementById("input");
  const charCount = document.getElementById("char-count");
  const outputEl = document.getElementById("output");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const translateBtn = document.getElementById("translate-btn");
  const copyBtn = document.getElementById("copy-btn");
  const rateLimitNote = document.getElementById("rate-limit-note");

  let config = null;
  let inflight = null;

  // ---- theme ----
  const storedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = storedTheme || (prefersDark ? "dark" : "light");

  themeToggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("theme", next);
  });

  // ---- char count ----
  const updateCharCount = () => {
    const n = inputEl.value.length;
    charCount.textContent = `${n.toLocaleString()} chars`;
  };
  inputEl.addEventListener("input", updateCharCount);
  updateCharCount();

  // ---- direction → model list ----
  const currentDirection = () =>
    document.querySelector('input[name="direction"]:checked').value;

  const populateModels = (direction) => {
    if (!config) return;
    const models = config.models[direction] || [];
    const defaultId = config.defaults[direction];
    modelSelect.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === defaultId) opt.selected = true;
      modelSelect.appendChild(opt);
    }
  };

  directionRadios.forEach((r) =>
    r.addEventListener("change", () => populateModels(currentDirection()))
  );

  // ---- copy ----
  copyBtn.addEventListener("click", async () => {
    if (!outputEl.textContent) return;
    try {
      await navigator.clipboard.writeText(outputEl.textContent);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = original), 1200);
    } catch {
      copyBtn.textContent = "Copy failed";
    }
  });

  // ---- translate ----
  const setBusy = (busy) => {
    translateBtn.disabled = busy;
    translateBtn.textContent = busy ? "Translating…" : "Translate";
    inputEl.disabled = busy;
    modelSelect.disabled = busy;
    directionRadios.forEach((r) => (r.disabled = busy));
  };

  const showError = (msg) => {
    errorEl.textContent = msg;
    statusEl.textContent = "";
  };

  const clearError = () => {
    errorEl.textContent = "";
  };

  translateBtn.addEventListener("click", async () => {
    const text = inputEl.value.trim();
    if (!text) {
      showError("Enter some text first.");
      return;
    }
    if (inflight) inflight.abort();

    clearError();
    outputEl.textContent = "";
    copyBtn.disabled = true;
    statusEl.textContent = "Translating…";
    setBusy(true);

    const controller = new AbortController();
    inflight = controller;
    const startedAt = performance.now();

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: currentDirection(),
          model: modelSelect.value,
          text,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 429) {
          showError("Rate limit hit — wait a minute and try again.");
        } else {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body.detail) detail = body.detail;
          } catch {}
          showError(detail);
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotError = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let payload;
          try {
            payload = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (payload.type === "text") {
            outputEl.textContent += payload.text;
          } else if (payload.type === "error") {
            gotError = true;
            showError(payload.message || "Translation failed.");
          }
        }
      }

      if (!gotError) {
        const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
        statusEl.textContent = `Done in ${elapsed}s · ${outputEl.textContent.length.toLocaleString()} chars`;
        copyBtn.disabled = !outputEl.textContent;
      } else {
        statusEl.textContent = "";
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        showError(`Network error: ${err.message}`);
      }
    } finally {
      setBusy(false);
      inflight = null;
    }
  });

  // submit on Cmd/Ctrl+Enter inside the textarea
  inputEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      translateBtn.click();
    }
  });

  // ---- bootstrap ----
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      config = cfg;
      populateModels(currentDirection());
      if (cfg.rate_limit) rateLimitNote.textContent = cfg.rate_limit;
    })
    .catch((err) => showError(`Failed to load config: ${err.message}`));
})();
