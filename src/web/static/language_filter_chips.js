(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./language_filter_controller.js"),
      require("./language_filter_dom.js")
    );
  } else {
    factory(
      root.ReverseWiktionaryLanguageFilterController,
      root.ReverseWiktionaryLanguageFilterDom
    );
  }
})(typeof self !== "undefined" ? self : this, function (controllerModule, domModule) {
  const { LanguageFilterController } = controllerModule;
  const { buildPosChip } = domModule;

  Object.assign(LanguageFilterController.prototype, {
    renderChips() {
      this.chipList.innerHTML = "";

      this.state.chipModels().forEach((chipModel) => {
        this.chipList.appendChild(this.buildLanguageChip(chipModel));
      });

      document.querySelectorAll("[name='pos']:checked").forEach((checkbox) => {
        this.chipList.appendChild(buildPosChip(checkbox, () => this.renderChips()));
      });

      if (this.emptyState) {
        this.emptyState.hidden = this.chipList.children.length > 0;
      }
    },

    renderFilterSizeWarning() {
      if (!this.filterSizeWarning) {
        return;
      }

      const hasLanguageFilter = this.state.selectedLanguages.size > 0;
      const selectedRows = this.selectedLanguageRows();
      this.filterSizeWarning.hidden = !hasLanguageFilter || selectedRows >= 1000;
    },

    syncClearFiltersButton() {
      if (!this.clearFilters) {
        return;
      }

      const hasLanguageFilters = this.state.selectedLanguages.size > 0;
      const hasPosFilters = Boolean(document.querySelector("[name='pos']:checked"));
      const hasFilters = hasLanguageFilters || hasPosFilters;
      this.clearFilters.disabled = !hasFilters;
      this.clearFilters.textContent = hasFilters ? "Clear all filters" : "No filters selected";
    },

    clearAllFilters() {
      this.state.selectedLanguages.clear();
      this.state.selectionIntents = [];
      document.querySelectorAll("[name='pos']:checked").forEach((checkbox) => {
        checkbox.checked = false;
      });
      this.syncUi();

      const searchInput = document.querySelector("[data-language-search]");
      if (searchInput?.value.trim()) {
        this.languageFilterSearchContext = null;
        this.applyLanguageSearch(searchInput.value);
      }
    },

    selectedLanguageRows() {
      return Array.from(this.state.selectedLanguages).reduce((total, languageId) => {
        return total + Number(this.state.languageById.get(languageId)?.rows || 0);
      }, 0);
    },

    buildLanguageChip(chipModel) {
      const chip = document.createElement("span");
      chip.className = "filter-chip filter-chip-complex";
      chip.dataset.languageChip = `${chipModel.intent.type}:${chipModel.intent.id}`;

      const label = document.createElement("span");
      label.textContent = chipModel.label;
      chip.appendChild(label);

      if (chipModel.exclusions.length > 0) {
        const exclusionList = document.createElement("span");
        exclusionList.className = "chip-exclusions";
        exclusionList.append(" (- ");
        chipModel.exclusions.forEach((exclusion, index) => {
          if (index > 0) {
            exclusionList.append(", ");
          }
          const exclusionButton = document.createElement("button");
          exclusionButton.type = "button";
          exclusionButton.className = "chip-exclusion";
          exclusionButton.textContent = exclusion.label;
          exclusionButton.addEventListener("click", () => {
            exclusion.languageIds.forEach((languageId) => this.state.selectedLanguages.add(languageId));
            this.state.normalizeIntents();
            this.syncUi();
          });
          exclusionList.appendChild(exclusionButton);
        });
        exclusionList.append(")");
        chip.appendChild(exclusionList);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.textContent = "x";
      remove.setAttribute("aria-label", `Remove ${chipModel.label}`);
      remove.addEventListener("click", () => {
        this.state.groupLanguageIds(chipModel.intent.type, chipModel.intent.id).forEach((languageId) => {
          this.state.selectedLanguages.delete(languageId);
        });
        this.state.selectionIntents = this.state.selectionIntents.filter((candidate) => {
          return candidate !== chipModel.intent;
        });
        this.state.normalizeIntents();
        this.syncUi();
      });
      chip.appendChild(remove);

      return chip;
    },
  });

  return controllerModule;
});
