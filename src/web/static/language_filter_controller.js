(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./language_filter_state.js"),
      require("./language_filter_dom.js")
    );
  } else {
    root.ReverseWiktionaryLanguageFilterController = factory(
      root.ReverseWiktionaryLanguageFilterState,
      root.ReverseWiktionaryLanguageFilterDom
    );
  }
})(typeof self !== "undefined" ? self : this, function (stateModule, domModule) {
  const { LanguageFilterState } = stateModule;
  const { readFamiliesFromDom } = domModule;

  class LanguageFilterController {
    /*
     * DOM adapter for the language filter. It translates checkbox/search/chip
     * events into state transitions, then renders hidden form inputs and chips.
     */
    constructor({
      tree,
      chipList,
      emptyState,
      filterSizeWarning,
      clearFilters,
      inputHost,
      selectAll,
      selectAllLabel,
      searchResults,
    }) {
      this.tree = tree;
      this.chipList = chipList;
      this.emptyState = emptyState;
      this.filterSizeWarning = filterSizeWarning;
      this.clearFilters = clearFilters;
      this.inputHost = inputHost;
      this.selectAll = selectAll;
      this.selectAllLabel = selectAllLabel;
      this.searchResults = searchResults;
      this.languageFilterSearchContext = null;
      this.state = new LanguageFilterState({
        families: readFamiliesFromDom(tree),
        allLanguages: JSON.parse(tree.dataset.allLanguages || "[]"),
        initialSelectedLabels: JSON.parse(tree.dataset.selectedLangs || "[]"),
      });
    }

    bind() {
      const expandAll = document.querySelector("[data-taxonomy-expand-all]");
      const collapseAll = document.querySelector("[data-taxonomy-collapse-all]");

      this.tree.addEventListener("click", (event) => {
        if (
          event.target.closest("[data-language-group-row]") ||
          event.target.closest("[data-language-select-all-row]") ||
          event.target.matches("[data-language-group]") ||
          event.target.matches("[data-language-checkbox]") ||
          event.target.matches("[data-language-select-all]")
        ) {
          event.stopPropagation();
        }
      });

      this.tree.addEventListener("change", (event) => {
        const target = event.target;
        this.handleLanguageChange(target);
      });

      if (this.searchResults) {
        this.searchResults.addEventListener("change", (event) => {
          this.handleLanguageChange(event.target);
        });
      }

      expandAll?.addEventListener("click", () => {
        this.setTreeOpenState(true);
      });

      collapseAll?.addEventListener("click", () => {
        this.setTreeOpenState(false);
      });

      this.clearFilters?.addEventListener("click", () => {
        this.clearAllFilters();
      });

      document.addEventListener("input", (event) => {
        if (event.target.matches("[data-language-search]")) {
          if (!event.target.value.trim()) {
            this.languageFilterSearchContext = null;
          } else {
            this.beginLanguageFilterSearchContext();
          }
          this.applyLanguageSearch(event.target.value);
        }
      });

      document.addEventListener("focusin", (event) => {
        if (event.target.matches("[data-language-search]")) {
          this.beginLanguageFilterSearchContext();
          this.applyLanguageSearch(event.target.value);
        }
      });

      document.addEventListener("search", (event) => {
        if (event.target.matches("[data-language-search]")) {
          if (!event.target.value.trim()) {
            this.languageFilterSearchContext = null;
          } else {
            this.beginLanguageFilterSearchContext();
          }
          this.applyLanguageSearch(event.target.value);
        }
      });

      document.addEventListener("click", (event) => {
        if (!this.searchResults) {
          return;
        }
        if (event.target.closest(".language-search-box")) {
          return;
        }
        this.hideSearchResults();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.hideSearchResults();
        }
      });

      document.addEventListener("change", (event) => {
        if (event.target.matches("[name='pos']")) {
          this.renderChips();
          this.syncClearFiltersButton();
        }
      });

      this.syncUi();
    }


    handleLanguageChange(target) {
      if (target.matches("[data-language-select-all]")) {
        this.state.toggleAll();
        this.syncUi();
        return;
      }

      if (target.matches("[data-language-group]")) {
        this.state.toggleGroup(target.dataset.languageGroup, target.dataset.groupId, target.checked);
        this.syncUi();
        this.updateLanguageFilterSearchContextAfterGroupChange(
          target.dataset.languageGroup,
          target.dataset.groupId,
          target.checked
        );
        return;
      }

      if (target.matches("[data-language-checkbox], [data-language-search-checkbox]")) {
        this.state.toggleLanguage(target.dataset.languageId, target.checked);
        this.syncUi();
      }
    }

    syncUi() {
      this.syncCheckboxes();
      this.syncHiddenInputs();
      this.renderChips();
      this.renderFilterSizeWarning();
      this.syncClearFiltersButton();
    }

    syncCheckboxes() {
      this.tree.querySelectorAll("[data-language-checkbox]").forEach((checkbox) => {
        checkbox.checked = this.state.selectedLanguages.has(checkbox.dataset.languageId);
      });

      if (this.searchResults) {
        this.searchResults.querySelectorAll("[data-language-search-checkbox]").forEach((checkbox) => {
          checkbox.checked = this.state.selectedLanguages.has(checkbox.dataset.languageId);
        });

        this.searchResults.querySelectorAll("[data-language-group]").forEach((checkbox) => {
          this.applyGroupCheckboxState(checkbox);
        });
      }

      this.tree.querySelectorAll("[data-language-group]").forEach((checkbox) => {
        this.applyGroupCheckboxState(checkbox);
      });

      if (this.selectAll) {
        const allSelected = (
          this.state.selectedLanguages.size === this.state.languageById.size &&
          this.state.languageById.size > 0
        );
        this.selectAll.checked = allSelected;
        this.selectAll.indeterminate = this.state.selectedLanguages.size > 0 && !allSelected;
        this.selectAllLabel.textContent = allSelected ? "Deselect all" : "Select all";
      }
    }

    syncHiddenInputs() {
      this.inputHost.innerHTML = "";

      if (this.state.selectedLanguages.size === 0) {
        return;
      }

      this.state.submittedLanguages().forEach((language) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "langs";
        input.value = language.label;
        this.inputHost.appendChild(input);
      });
    }


    applyGroupCheckboxState(checkbox) {
      const ids = this.state.groupLanguageIds(checkbox.dataset.languageGroup, checkbox.dataset.groupId);
      const selectedCount = ids.filter((languageId) => this.state.selectedLanguages.has(languageId)).length;
      checkbox.checked = ids.length > 0 && selectedCount === ids.length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    }

  }

  return {
    LanguageFilterController,
  };
});