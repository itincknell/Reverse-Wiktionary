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
      viewToggle,
      flatList,
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
      this.viewToggle = viewToggle;
      this.flatList = flatList;
      this.languageFilterSearchContext = null;
      this.languageView = "tree";
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

      if (this.flatList) {
        this.flatList.addEventListener("change", (event) => {
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

      this.viewToggle?.addEventListener("click", () => {
        this.toggleLanguageView();
      });

      document.addEventListener("input", (event) => {
        if (event.target.matches("[data-language-search]")) {
          this.handleLanguageSearchValue(event.target.value);
        }
      });

      document.addEventListener("focusin", (event) => {
        if (event.target.matches("[data-language-search]")) {
          this.handleLanguageSearchValue(event.target.value);
        }
      });

      document.addEventListener("search", (event) => {
        if (event.target.matches("[data-language-search]")) {
          this.handleLanguageSearchValue(event.target.value);
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

    handleLanguageSearchValue(value) {
      if (!value.trim()) {
        this.languageFilterSearchContext = null;
      } else {
        this.beginLanguageFilterSearchContext();
      }
      this.applyLanguageSearch(value);
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

      if (this.flatList) {
        this.flatList.querySelectorAll("[data-language-checkbox]").forEach((checkbox) => {
          checkbox.checked = this.state.selectedLanguages.has(checkbox.dataset.languageId);
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

    toggleLanguageView() {
      this.languageView = this.languageView === "tree" ? "flat" : "tree";
      this.renderLanguageView();
    }

    renderLanguageView() {
      if (!this.viewToggle || !this.flatList) {
        return;
      }

      const isFlat = this.languageView === "flat";
      this.tree.hidden = isFlat;
      this.flatList.hidden = !isFlat;
      this.viewToggle.textContent = isFlat ? "Tree" : "List";
      this.viewToggle.setAttribute(
        "aria-label",
        isFlat ? "Show language tree" : "Show flat language list"
      );

      if (isFlat && this.flatList.children.length === 0) {
        this.renderFlatLanguageList();
      }
      this.syncCheckboxes();
    }

    renderFlatLanguageList() {
      const languages = Array.from(this.state.languageById.values())
        .filter((language) => Number(language.rows || 0) >= 100)
        .sort((left, right) => {
          const rowDelta = Number(right.rows || 0) - Number(left.rows || 0);
          return rowDelta || left.label.localeCompare(right.label);
        });

      languages.forEach((language) => {
        const row = document.createElement("label");
        row.className = "check-row";
        row.dataset.languageRow = "";
        row.dataset.languageId = language.id;
        row.dataset.languageLabel = language.label.toLowerCase();
        row.dataset.rowCount = String(language.rows || 0);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.languageId = language.id;
        checkbox.dataset.languageCheckbox = "";
        checkbox.value = language.label;
        row.appendChild(checkbox);

        const label = document.createElement("span");
        label.className = "filter-label";
        label.textContent = language.label;
        row.appendChild(label);

        const count = document.createElement("span");
        count.className = "filter-count";
        count.textContent = `(${Number(language.rows || 0).toLocaleString()})`;
        row.appendChild(count);
        this.flatList.appendChild(row);
      });
    }

  }

  return {
    LanguageFilterController,
  };
});
