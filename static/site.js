(() => {
  const storageKey = "preferred-theme";
  const metaThemeColors = {
    light: "#f3fbfb",
    dark: "#081521",
  };

  const root = document.documentElement;
  const themeToggle = document.querySelector("[data-theme-toggle]");
  const themeToggleLabel = document.querySelector(".theme-toggle-label");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const siteNav = document.querySelector("[data-site-nav]");
  const revealTargets = Array.from(document.querySelectorAll("[data-reveal]"));
  const healthSummaryContainers = Array.from(
    document.querySelectorAll("[data-health-summary]"),
  );
  const mediaQuery = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  const prefersReducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  function safeGetStoredTheme() {
    try {
      return localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function safeSetStoredTheme(theme) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch (error) {
      return;
    }
  }

  function resolveTheme(preferredTheme) {
    if (preferredTheme === "light" || preferredTheme === "dark") {
      return preferredTheme;
    }

    return mediaQuery && mediaQuery.matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);

    const metaTheme = document.getElementById("theme-color-meta");
    if (metaTheme) {
      metaTheme.setAttribute("content", metaThemeColors[theme]);
    }

    if (themeToggleLabel) {
      themeToggleLabel.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    }

    if (themeToggle) {
      themeToggle.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      );
    }
  }

  function toggleTheme() {
    const currentTheme = root.getAttribute("data-theme") || resolveTheme(null);
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    safeSetStoredTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function closeMenu() {
    if (!siteNav || !menuToggle) {
      return;
    }

    siteNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    if (!siteNav || !menuToggle) {
      return;
    }

    siteNav.classList.add("is-open");
    menuToggle.setAttribute("aria-expanded", "true");
  }

  function toggleMenu() {
    if (!siteNav || !menuToggle) {
      return;
    }

    if (siteNav.classList.contains("is-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function initRevealAnimations() {
    if (revealTargets.length === 0 || prefersReducedMotion) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    if (!("IntersectionObserver" in window)) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -40px 0px",
      },
    );

    revealTargets.forEach((target, index) => {
      target.classList.add("reveal-enter");
      target.style.setProperty("--reveal-delay", `${Math.min(index % 6, 5) * 60}ms`);
      observer.observe(target);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderHealthSummary(data) {
    const appTone = data.ready ? "is-ready" : "is-warning";
    const modelTone = data.available_model_count > 0 ? "is-ready" : "is-warning";
    const kbTone = data.knowledge_base && data.knowledge_base.ready ? "is-ready" : "is-warning";
    const providerText = `${data.available_model_count || 0} of ${data.model_count || 0} configured models are currently usable.`;

    return `
      <div class="status-summary-grid">
        <article class="status-card">
          <span class="status-pill ${appTone}">
            ${data.ready ? "Application ready" : "Attention required"}
          </span>
          <strong>Overall readiness</strong>
          <p>${escapeHtml(providerText)}</p>
        </article>
        <article class="status-card">
          <span class="status-pill ${kbTone}">
            ${data.knowledge_base && data.knowledge_base.ready ? "Knowledge base ready" : "Knowledge base issue"}
          </span>
          <strong>Retrieval layer</strong>
          <p>${escapeHtml(
            data.knowledge_base && data.knowledge_base.detail
              ? data.knowledge_base.detail
              : "No detail provided.",
          )}</p>
        </article>
        <article class="status-card">
          <span class="status-pill ${modelTone}">
            ${data.providers && data.providers.ollama && data.providers.ollama.online ? "Ollama online" : "Runtime check needed"}
          </span>
          <strong>Model providers</strong>
          <p>
            Gemini configured: ${escapeHtml(
              String(
                data.providers && data.providers.gemini
                  ? data.providers.gemini.configured
                  : false,
              ),
            )}. Installed Ollama models: ${escapeHtml(
              String(
                data.providers && data.providers.ollama
                  ? data.providers.ollama.installed_count
                  : 0,
              ),
            )}.
          </p>
        </article>
      </div>
    `;
  }

  async function loadHealthSummary() {
    if (healthSummaryContainers.length === 0) {
      return;
    }

    try {
      const response = await fetch("/health", {
        headers: { Accept: "application/json" },
      });
      const data = await response.json();
      const html = renderHealthSummary(data);
      healthSummaryContainers.forEach((container) => {
        container.innerHTML = html;
      });
    } catch (error) {
      healthSummaryContainers.forEach((container) => {
        container.innerHTML = `
          <div class="status-row">
            <strong>Health endpoint unavailable</strong>
            <p>The status summary could not be loaded from the backend.</p>
          </div>
        `;
      });
    }
  }

  applyTheme(resolveTheme(safeGetStoredTheme()));
  initRevealAnimations();
  loadHealthSummary();

  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  if (mediaQuery) {
    const syncWithSystemTheme = (event) => {
      if (!safeGetStoredTheme()) {
        applyTheme(event.matches ? "dark" : "light");
      }
    };

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", syncWithSystemTheme);
    } else if ("addListener" in mediaQuery) {
      mediaQuery.addListener(syncWithSystemTheme);
    }
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", toggleMenu);
  }

  if (siteNav) {
    siteNav.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest(".nav-link")) {
        closeMenu();
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!siteNav || !menuToggle) {
      return;
    }

    if (
      siteNav.classList.contains("is-open") &&
      !siteNav.contains(event.target) &&
      !menuToggle.contains(event.target)
    ) {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      closeMenu();
    }
  });
})();
