(function () {
  "use strict";

  const MOBILE_QUERY = "(max-width: 760px)";

  function initializeMobilePanels() {
    const media = window.matchMedia(MOBILE_QUERY);
    const panels = Array.from(document.querySelectorAll("[data-mobile-collapsible]"));

    function syncPanels() {
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
    let pendingScrollMode = null;

    document.body.addEventListener("htmx:beforeRequest", (event) => {
      const trigger = event.detail.elt;
      if (trigger?.matches("[data-search-form]")) {
        pendingScrollMode = "first";
      } else if (trigger?.classList.contains("load-more")) {
        pendingScrollMode = "latest";
      }
    });

    document.body.addEventListener("htmx:afterSwap", () => {
      if (!pendingScrollMode) {
        return;
      }

      const selector = pendingScrollMode === "latest"
        ? ".result-list:last-of-type .result-card"
        : "#results .result-card";
      const target = document.querySelector(selector);
      pendingScrollMode = null;

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initializeMobilePanels();
      initializeResultScrolling();
    });
  } else {
    initializeMobilePanels();
    initializeResultScrolling();
  }
})();
