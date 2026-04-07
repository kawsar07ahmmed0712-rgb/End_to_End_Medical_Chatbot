(() => {
  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-button");
  const modelSelect = document.getElementById("model-select");
  const modelHelp = document.getElementById("model-help");
  const chatStatus = document.getElementById("chat-status");
  const healthContainer = document.getElementById("assistant-health");
  const clearSessionButton = document.getElementById("clear-session");
  const promptGrid = document.getElementById("prompt-grid");
  const sessionStorageKey = "assistant-session-v1";

  if (
    !chatLog ||
    !chatForm ||
    !messageInput ||
    !sendButton ||
    !modelSelect ||
    !modelHelp ||
    !chatStatus ||
    !healthContainer
  ) {
    return;
  }

  const state = {
    history: [],
    models: [],
    selectedModelId: "",
    pending: false,
    pendingMessage: "",
    health: null,
  };

  function safeStorageRead() {
    try {
      return sessionStorage.getItem(sessionStorageKey);
    } catch (error) {
      return null;
    }
  }

  function safeStorageWrite(value) {
    try {
      sessionStorage.setItem(sessionStorageKey, value);
    } catch (error) {
      return;
    }
  }

  function safeStorageClear() {
    try {
      sessionStorage.removeItem(sessionStorageKey);
    } catch (error) {
      return;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadSession() {
    const raw = safeStorageRead();
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.history)) {
        state.history = parsed.history
          .filter((item) => item && typeof item.content === "string")
          .map((item) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            content: item.content,
            meta: item.meta || null,
          }));
      }

      if (typeof parsed.modelId === "string") {
        state.selectedModelId = parsed.modelId;
      }
    } catch (error) {
      safeStorageClear();
    }
  }

  function saveSession() {
    safeStorageWrite(
      JSON.stringify({
        history: state.history,
        modelId: state.selectedModelId,
      }),
    );
  }

  function setStatus(message, tone = "neutral") {
    chatStatus.textContent = message;
    chatStatus.className = "chat-status";
    if (tone === "ready") {
      chatStatus.classList.add("is-ready");
    } else if (tone === "error") {
      chatStatus.classList.add("is-error");
    } else if (tone === "busy") {
      chatStatus.classList.add("is-busy");
    }
  }

  function getSelectedModel() {
    return state.models.find((model) => model.id === state.selectedModelId) || null;
  }

  function canSend() {
    const selectedModel = getSelectedModel();
    const hasText = messageInput.value.trim().length > 0;
    return Boolean(!state.pending && hasText && selectedModel && selectedModel.available);
  }

  function updateComposerState() {
    const selectedModel = getSelectedModel();
    const modelReady = Boolean(selectedModel && selectedModel.available);

    sendButton.disabled = !canSend();
    sendButton.textContent = state.pending ? "Sending..." : "Send question";
    messageInput.disabled = state.pending;
    modelSelect.disabled = state.pending || state.models.length === 0;

    if (!selectedModel) {
      modelHelp.textContent = "No available model is selected yet.";
    } else if (selectedModel.available) {
      modelHelp.textContent = selectedModel.status_text;
    } else {
      modelHelp.textContent = `${selectedModel.status_text}. Choose a ready model to send a question.`;
    }

    if (!modelReady && state.models.length > 0) {
      setStatus("Select a ready model before sending a question.", "error");
    }
  }

  function scrollChatToBottom() {
    window.requestAnimationFrame(() => {
      chatLog.scrollTop = chatLog.scrollHeight;
    });
  }

  function createTag(text) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = text;
    return tag;
  }

  function createSourceCard(source) {
    const card = document.createElement("article");
    card.className = "source-card";

    const title = document.createElement("strong");
    title.textContent = source.name || "Knowledge base";

    const preview = document.createElement("p");
    preview.textContent = source.preview || "No preview available.";

    const path = document.createElement("span");
    path.className = "source-path";
    path.textContent = source.path || "";

    card.append(title, preview, path);
    return card;
  }

  function createMessageCard(entry, options = {}) {
    const card = document.createElement("article");
    card.className = `message-card is-${entry.role}`;
    if (options.pending) {
      card.classList.add("is-pending");
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent = entry.role === "assistant" ? "Assistant" : "User";

    meta.append(role);

    if (entry.role === "assistant" && entry.meta && entry.meta.model) {
      const modelLabel = document.createElement("span");
      modelLabel.textContent = `${entry.meta.model.provider_label} / ${entry.meta.model.label}`;
      meta.append(modelLabel);
    }

    const body = document.createElement("div");
    body.className = "message-bubble";
    body.textContent = entry.content;

    card.append(meta, body);

    if (entry.role === "assistant" && entry.meta) {
      const tagRow = document.createElement("div");
      tagRow.className = "tag-row";

      if (entry.meta.context_count) {
        tagRow.append(createTag(`${entry.meta.context_count} source hits`));
      }

      if (entry.meta.latency_ms) {
        tagRow.append(createTag(`${entry.meta.latency_ms} ms`));
      }

      if (entry.meta.model && entry.meta.model.name) {
        tagRow.append(createTag(entry.meta.model.name));
      }

      if (tagRow.childNodes.length > 0) {
        card.append(tagRow);
      }

      if (Array.isArray(entry.meta.sources) && entry.meta.sources.length > 0) {
        const sourceGrid = document.createElement("div");
        sourceGrid.className = "source-grid";
        entry.meta.sources.forEach((source) => {
          sourceGrid.append(createSourceCard(source));
        });
        card.append(sourceGrid);
      }
    }

    return card;
  }

  function renderEmptyState() {
    chatLog.innerHTML = `
      <div class="empty-state">
        <p class="eyebrow">No messages yet</p>
        <h3>Ask a clinical or operational question to begin.</h3>
        <p>
          The assistant will return a concise answer with sources when the
          runtime and knowledge base are available.
        </p>
      </div>
    `;
  }

  function renderPendingIndicator() {
    const loadingCard = document.createElement("article");
    loadingCard.className = "message-card is-assistant is-pending";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent = "Assistant";

    meta.append(role);

    const loading = document.createElement("div");
    loading.className = "loading-message";
    loading.innerHTML = `
      <span class="loading-dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
      <span>Generating a sourced response...</span>
    `;

    loadingCard.append(meta, loading);
    chatLog.append(loadingCard);
  }

  function renderConversation() {
    chatLog.innerHTML = "";

    if (state.history.length === 0 && !state.pendingMessage) {
      renderEmptyState();
      return;
    }

    state.history.forEach((entry) => {
      chatLog.append(createMessageCard(entry));
    });

    if (state.pendingMessage) {
      chatLog.append(
        createMessageCard(
          {
            role: "user",
            content: state.pendingMessage,
          },
          { pending: true },
        ),
      );
    }

    if (state.pending) {
      renderPendingIndicator();
    }

    scrollChatToBottom();
  }

  function sanitizeHistoryForApi() {
    return state.history.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
  }

  function renderModelOptions(defaultModelId) {
    modelSelect.innerHTML = "";

    if (!Array.isArray(state.models) || state.models.length === 0) {
      const option = document.createElement("option");
      option.textContent = "No models available";
      option.value = "";
      modelSelect.append(option);
      state.selectedModelId = "";
      updateComposerState();
      return;
    }

    const availableModels = state.models.filter((model) => model.available);
    const fallbackModel =
      state.models.find(
        (model) => model.id === state.selectedModelId && model.available,
      ) ||
      state.models.find((model) => model.id === defaultModelId && model.available) ||
      availableModels[0] ||
      null;

    state.models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.disabled = !model.available;
      option.textContent = model.available
        ? `${model.provider_label} / ${model.label}`
        : `${model.provider_label} / ${model.label} (Unavailable)`;
      modelSelect.append(option);
    });

    state.selectedModelId = fallbackModel ? fallbackModel.id : "";
    modelSelect.value = state.selectedModelId;
    updateComposerState();
  }

  async function loadModels() {
    try {
      const response = await fetch("/api/models", {
        headers: { Accept: "application/json" },
      });
      const data = await response.json();

      state.models = Array.isArray(data.models) ? data.models : [];
      renderModelOptions(data.default_model_id || "");

      if (state.history.length > 0) {
        setStatus("Previous session restored.", "ready");
      }
    } catch (error) {
      state.models = [];
      modelSelect.innerHTML = '<option value="">Model catalog unavailable</option>';
      modelHelp.textContent = "The model catalog could not be loaded.";
      updateComposerState();
      setStatus(
        "Could not load the model catalog. Check the backend and try again.",
        "error",
      );
    }
  }

  function renderHealth(data) {
    if (!data) {
      healthContainer.innerHTML = `
        <div class="status-row">
          <strong>Health endpoint unavailable</strong>
          <p>The workspace could not load runtime readiness information.</p>
        </div>
      `;
      return;
    }

    const readyClass = data.ready ? "is-ready" : "is-warning";
    const providerSummary = `${data.available_model_count || 0} of ${data.model_count || 0} models ready`;
    const geminiState =
      data.providers && data.providers.gemini && data.providers.gemini.configured
        ? "Configured"
        : "Not configured";
    const ollamaState =
      data.providers && data.providers.ollama && data.providers.ollama.online
        ? "Online"
        : "Offline";

    healthContainer.innerHTML = `
      <div class="status-chip-row">
        <span class="status-pill ${readyClass}">
          ${data.ready ? "Ready" : "Needs attention"}
        </span>
        <span class="status-pill ${data.available_model_count ? "is-ready" : "is-warning"}">
          ${escapeHtml(providerSummary)}
        </span>
      </div>
      <div class="status-list">
        <div class="status-row">
          <span>Knowledge base</span>
          <strong>${data.knowledge_base && data.knowledge_base.ready ? "Ready" : "Issue detected"}</strong>
          <p>${escapeHtml(
            data.knowledge_base && data.knowledge_base.detail
              ? data.knowledge_base.detail
              : "No detail provided.",
          )}</p>
        </div>
        <div class="status-row">
          <span>Gemini provider</span>
          <strong>${escapeHtml(geminiState)}</strong>
          <p>Configured models: ${escapeHtml(
            String(
              data.providers && data.providers.gemini
                ? data.providers.gemini.count
                : 0,
            ),
          )}</p>
        </div>
        <div class="status-row">
          <span>Ollama runtime</span>
          <strong>${escapeHtml(ollamaState)}</strong>
          <p>Installed models: ${escapeHtml(
            String(
              data.providers && data.providers.ollama
                ? data.providers.ollama.installed_count
                : 0,
            ),
          )}</p>
        </div>
      </div>
    `;
  }

  async function loadHealth() {
    try {
      const response = await fetch("/health", {
        headers: { Accept: "application/json" },
      });
      const data = await response.json();
      state.health = data;
      renderHealth(data);

      if (!data.ready) {
        setStatus(
          "Runtime health needs attention before the assistant will be reliable.",
          "error",
        );
      }
    } catch (error) {
      renderHealth(null);
      setStatus(
        "Health information is unavailable. Verify server configuration.",
        "error",
      );
    }
  }

  async function submitMessage(event) {
    event.preventDefault();

    const message = messageInput.value.trim();
    const selectedModel = getSelectedModel();

    if (!message) {
      setStatus("Enter a question before sending.", "error");
      updateComposerState();
      return;
    }

    if (!selectedModel || !selectedModel.available) {
      setStatus("Select a ready model before sending a question.", "error");
      updateComposerState();
      return;
    }

    if (!navigator.onLine) {
      setStatus("You appear to be offline. Reconnect and try again.", "error");
      return;
    }

    state.pending = true;
    state.pendingMessage = message;
    setStatus("Sending question to the assistant...", "busy");
    renderConversation();
    updateComposerState();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message,
          model_id: state.selectedModelId,
          history: sanitizeHistoryForApi(),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload && payload.detail
            ? payload.detail
            : "The request could not be completed.",
        );
      }

      state.history.push({
        role: "user",
        content: message,
      });
      state.history.push({
        role: "assistant",
        content: payload.answer || "",
        meta: {
          model: payload.model || null,
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          latency_ms: payload.latency_ms || null,
          context_count: payload.context_count || 0,
        },
      });

      state.pending = false;
      state.pendingMessage = "";
      messageInput.value = "";
      saveSession();
      renderConversation();
      updateComposerState();
      setStatus("Response ready.", "ready");
      messageInput.focus();
    } catch (error) {
      state.pending = false;
      state.pendingMessage = "";
      renderConversation();
      updateComposerState();
      setStatus(
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    }
  }

  function handlePromptClick(event) {
    const button = event.target.closest("[data-prompt]");
    if (!button) {
      return;
    }

    messageInput.value = button.getAttribute("data-prompt") || "";
    updateComposerState();
    messageInput.focus();
  }

  function clearSession() {
    state.history = [];
    state.pending = false;
    state.pendingMessage = "";
    safeStorageClear();
    renderConversation();
    updateComposerState();
    setStatus("Session cleared.", "ready");
    messageInput.focus();
  }

  function handleInputKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sendButton.disabled) {
        chatForm.requestSubmit();
      }
    }
  }

  function handleConnectionChange() {
    if (!navigator.onLine) {
      setStatus("You are offline. Requests will fail until connectivity returns.", "error");
      return;
    }

    if (!state.pending) {
      setStatus("Connection restored.", "ready");
    }
  }

  loadSession();
  renderConversation();
  updateComposerState();

  chatForm.addEventListener("submit", submitMessage);
  messageInput.addEventListener("input", updateComposerState);
  messageInput.addEventListener("keydown", handleInputKeydown);
  modelSelect.addEventListener("change", () => {
    state.selectedModelId = modelSelect.value;
    saveSession();
    updateComposerState();
  });

  if (clearSessionButton) {
    clearSessionButton.addEventListener("click", clearSession);
  }

  if (promptGrid) {
    promptGrid.addEventListener("click", handlePromptClick);
  }

  window.addEventListener("online", handleConnectionChange);
  window.addEventListener("offline", handleConnectionChange);

  Promise.all([loadModels(), loadHealth()]).finally(() => {
    renderConversation();
    updateComposerState();
    if (state.history.length === 0 && navigator.onLine) {
      setStatus("Waiting for a question.", "neutral");
    }
  });
})();
