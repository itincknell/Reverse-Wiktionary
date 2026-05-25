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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initializeMobilePanels();
      initializeResultScrolling();
      initializeQueryClear();
      initializePronunciationAudio();
    });
  } else {
    initializeMobilePanels();
    initializeResultScrolling();
    initializeQueryClear();
    initializePronunciationAudio();
  }
})();
