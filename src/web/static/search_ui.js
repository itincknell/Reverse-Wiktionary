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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initializeMobilePanels();
      initializeResultScrolling();
      initializeQueryClear();
    });
  } else {
    initializeMobilePanels();
    initializeResultScrolling();
    initializeQueryClear();
  }
})();
