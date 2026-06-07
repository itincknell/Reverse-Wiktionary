(function () {
  "use strict";

  const MOBILE_QUERY = "(max-width: 760px)";

  function initializeMobilePanels() {
    const media = window.matchMedia(MOBILE_QUERY);
    const panels = Array.from(document.querySelectorAll("[data-mobile-collapsible]"));

    function syncPanels() {
      // Mobile starts with compact panels; desktop keeps the filter controls visible.
      panels.forEach((panel) => {
        if (media.matches) {
          if (panel.hasAttribute("data-mobile-default-open")) {
            panel.setAttribute("open", "");
          } else {
            panel.removeAttribute("open");
          }
          return;
        }
        panel.setAttribute("open", "");
      });
      document.documentElement.classList.add("filter-ui-ready");
    }

    panels.forEach((panel) => {
      const summary = panel.querySelector("summary");
      if (!summary) {
        return;
      }

      summary.addEventListener("click", (event) => {
        if (!media.matches) {
          event.preventDefault();
          panel.setAttribute("open", "");
        }
      });

      summary.addEventListener("keydown", (event) => {
        if (!media.matches && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          panel.setAttribute("open", "");
        }
      });

      panel.addEventListener("toggle", () => {
        if (!media.matches && !panel.open) {
          panel.setAttribute("open", "");
        }
      });
    });

    syncPanels();
    media.addEventListener("change", syncPanels);
  }

  function initializeResultScrolling() {
    const media = window.matchMedia(MOBILE_QUERY);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let shouldScrollToResults = false;

    document.body.addEventListener("htmx:beforeRequest", (event) => {
      if (!media.matches) {
        shouldScrollToResults = false;
        return;
      }

      const trigger = event.detail.elt;
      // New searches reveal the refreshed result set; load-more keeps the reader's place.
      shouldScrollToResults = Boolean(trigger?.matches("[data-search-form]"));
    });

    document.body.addEventListener("htmx:afterSwap", () => {
      if (!shouldScrollToResults || !media.matches) {
        shouldScrollToResults = false;
        return;
      }

      shouldScrollToResults = false;
      const target = document.querySelector("#results .result-card");

      if (target) {
        target.scrollIntoView({
          behavior: reducedMotion.matches ? "auto" : "smooth",
          block: "start",
        });
      }
    });
  }

  function initializeQueryClear() {
    const query = document.querySelector("#query");
    const clearButton = document.querySelector("[data-clear-query]");

    if (!query || !clearButton) {
      return;
    }

    clearButton.addEventListener("click", () => {
      query.value = "";
      query.focus();
    });
  }

  function initializePronunciationAudio() {
    const audioByButton = new WeakMap();
    let activeAudio = null;
    const icons = {
      idle: [
        '<path d="M4 9v6h4l5 4V5L8 9H4z"></path>',
        '<path d="M16 8.5a5 5 0 0 1 0 7"></path>',
        '<path d="M18.5 6a8.5 8.5 0 0 1 0 12"></path>',
      ].join(""),
      ready: '<path d="M8 5v14l11-7L8 5z" fill="currentColor" stroke="none"></path>',
      playing: [
        '<path d="M7 5h4v14H7z" fill="currentColor" stroke="none"></path>',
        '<path d="M13 5h4v14h-4z" fill="currentColor" stroke="none"></path>',
      ].join(""),
    };

    function setButtonState(button, state) {
      const word = button.getAttribute("data-audio-word") || "word";
      const icon = button.querySelector(".audio-icon");
      button.setAttribute("data-audio-state", state);

      if (icon) {
        icon.innerHTML = icons[state] || icons.idle;
      }

      if (state === "playing") {
        button.setAttribute("aria-label", `Pause pronunciation for ${word}`);
      } else {
        button.setAttribute("aria-label", `Play pronunciation for ${word}`);
      }
    }

    function attachButtonAudio(button) {
      const sourceUrl = button.getAttribute("data-audio-url");
      if (!sourceUrl) {
        return null;
      }

      const audio = new Audio(`/api/audio-cache?url=${encodeURIComponent(sourceUrl)}`);
      audio.preload = "auto";
      audio.addEventListener("play", () => setButtonState(button, "playing"));
      audio.addEventListener("pause", () => setButtonState(button, "ready"));
      audio.addEventListener("ended", () => setButtonState(button, "ready"));
      audioByButton.set(button, audio);
      setButtonState(button, "ready");
      return audio;
    }

    document.body.addEventListener("click", async (event) => {
      const button = event.target.closest
        ? event.target.closest("[data-audio-url]")
        : null;
      if (!button) {
        return;
      }

      event.preventDefault();
      let audio = audioByButton.get(button);

      if (!audio) {
        button.disabled = true;
        audio = attachButtonAudio(button);
        button.disabled = false;
      }

      if (!audio) {
        return;
      }

      if (audio.paused) {
        if (activeAudio && activeAudio !== audio) {
          activeAudio.pause();
        }

        try {
          await audio.play();
          activeAudio = audio;
        } catch {
          setButtonState(button, "ready");
        }
        return;
      }

      audio.pause();
    });
  }

  function initializeAutoPronunciation() {
    const resultByButton = new WeakMap();
    const voicePromises = new Map();
    let runtimePromise = null;
    let configPromise = null;

    function loadRuntime() {
      if (window.meSpeak) {
        return Promise.resolve(window.meSpeak);
      }

      if (runtimePromise) {
        return runtimePromise;
      }

      runtimePromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/api/pronunciation-assets/mespeak.js";
        script.async = true;
        script.onload = () => {
          if (window.meSpeak) {
            resolve(window.meSpeak);
            return;
          }
          reject(new Error("pronunciation runtime did not initialize"));
        };
        script.onerror = () => reject(new Error("pronunciation runtime failed to load"));
        document.head.appendChild(script);
      });

      return runtimePromise;
    }

    async function loadJson(url) {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`failed to load ${url}`);
      }
      return response.json();
    }

    async function ensureConfig() {
      const meSpeak = await loadRuntime();
      if (meSpeak.isConfigLoaded()) {
        return meSpeak;
      }

      if (!configPromise) {
        configPromise = loadJson("/api/pronunciation-assets/config").then((config) => {
          meSpeak.loadConfig(config);
          return meSpeak;
        });
      }

      return configPromise;
    }

    async function ensureVoice(voice, playbackVoice) {
      const meSpeak = await ensureConfig();
      if (meSpeak.isVoiceLoaded(playbackVoice)) {
        return meSpeak;
      }

      if (!voicePromises.has(voice)) {
        voicePromises.set(
          voice,
          loadJson(`/api/pronunciation-assets/voices/${encodeURIComponent(voice)}`).then(
            (voiceData) => {
              meSpeak.loadVoice(voiceData);
              if (!meSpeak.isVoiceLoaded(playbackVoice)) {
                throw new Error(`pronunciation voice failed to load: ${voice}`);
              }
              return meSpeak;
            },
          ),
        );
      }

      return voicePromises.get(voice);
    }

    function setAutoButtonState(button, state) {
      const word = button.getAttribute("data-audio-word") || "word";
      button.setAttribute("data-audio-state", state);

      if (state === "ready") {
        button.setAttribute("aria-label", `Automatic pronunciation is ready for ${word}`);
        return;
      }

      if (state === "loading") {
        button.setAttribute("aria-label", `Preparing automatic pronunciation for ${word}`);
        return;
      }

      button.setAttribute("aria-label", `Prepare automatic pronunciation for ${word}`);
    }

    async function fetchAutoPronunciation(button) {
      const cached = resultByButton.get(button);
      if (cached) {
        return cached;
      }

      const voice = button.getAttribute("data-auto-pronunciation-voice");
      const ipa = button.getAttribute("data-auto-pronunciation-ipa");
      if (!voice || !ipa) {
        return null;
      }

      const params = new URLSearchParams({ voice, ipa });
      const response = await fetch(`/api/ipa-pronunciation?${params.toString()}`, {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      if (!payload.supported || !payload.phonemes) {
        return null;
      }

      resultByButton.set(button, payload);
      button.dataset.autoPronunciationPhonemes = payload.phonemes;
      return payload;
    }

    async function playAutoPronunciation(payload) {
      const voice = payload.voice;
      const playbackVoice = payload.playback_voice || voice;
      if (!voice || !playbackVoice || !payload.phonemes) {
        return false;
      }

      const meSpeak = await ensureVoice(voice, playbackVoice);
      const spoken = meSpeak.speak(`[[${payload.phonemes}]]`, { voice: playbackVoice, speed: 60 });
      return Boolean(spoken);
    }

    document.body.addEventListener("click", async (event) => {
      const button = event.target.closest
        ? event.target.closest("[data-auto-pronunciation]")
        : null;
      if (!button) {
        return;
      }

      event.preventDefault();
      button.disabled = true;
      setAutoButtonState(button, "loading");

      try {
        const payload = await fetchAutoPronunciation(button);
        if (payload && (await playAutoPronunciation(payload))) {
          setAutoButtonState(button, "ready");
        } else {
          setAutoButtonState(button, "idle");
        }
      } catch {
        setAutoButtonState(button, "idle");
      } finally {
        button.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initializeMobilePanels();
      initializeResultScrolling();
      initializeQueryClear();
      initializePronunciationAudio();
      initializeAutoPronunciation();
    });
  } else {
    initializeMobilePanels();
    initializeResultScrolling();
    initializeQueryClear();
    initializePronunciationAudio();
    initializeAutoPronunciation();
  }
})();
