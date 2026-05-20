(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReverseWiktionaryLanguageFilters = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /*
   * Language filtering keeps two related states:
   * - selectedLanguages is the exact flat set submitted to the backend.
   * - selectionIntents preserves how the user got there so chips can explain
   *   broad selections, exclusions, and explicit add-backs compactly.
   */
  class LanguageFilterState {
    /*
     * Pure selection model. This class has no DOM dependency, which keeps the
     * chip-collapse rules testable outside the browser.
     */
    constructor({ families, allLanguages = [], initialSelectedLabels = [] }) {
      this.languageById = new Map();
      this.languageIdByLabel = new Map();
      this.languagesByFamily = new Map();
      this.languagesByBranch = new Map();
      this.branchById = new Map();
      this.familyById = new Map();
      this.familyIdByLabel = new Map();
      this.branchIdByFamilyAndLabel = new Map();
      this.selectedLanguages = new Set();
      this.selectionIntents = [];
      this.intentClock = 0;

      families.forEach((family) => this.addFamily(family));
      this.addSearchOnlyLanguages(allLanguages);

      initialSelectedLabels.forEach((label) => {
        const languageId = this.languageIdByLabel.get(label);
        if (languageId) {
          this.selectedLanguages.add(languageId);
          this.selectionIntents.push(this.createIntent("language", languageId));
        }
      });

      this.normalizeIntents();
    }

    addFamily(family) {
      this.familyById.set(family.id, {
        id: family.id,
        label: family.label,
        rows: Number(family.rows || 0),
        branches: family.branches,
      });
      this.familyIdByLabel.set(family.label, family.id);
      this.languagesByFamily.set(family.id, []);

      family.branches.forEach((branch) => {
        this.branchById.set(branch.id, {
          id: branch.id,
          label: branch.label,
          rows: Number(branch.rows || 0),
          family_id: family.id,
        });
        this.branchIdByFamilyAndLabel.set(groupKey(family.id, branch.label), branch.id);
        this.languagesByBranch.set(branch.id, []);

        branch.languages.forEach((language) => {
          this.languageById.set(language.id, {
            id: language.id,
            label: language.label,
            rows: Number(language.rows || 0),
            family_id: family.id,
            branch_id: branch.id,
          });
          this.languageIdByLabel.set(language.label, language.id);
          this.languagesByFamily.get(family.id).push(language.id);
          this.languagesByBranch.get(branch.id).push(language.id);
        });
      });
    }

    addSearchOnlyLanguages(languages) {
      languages.forEach((language) => {
        const label = language.label || language.lang;
        if (!label || this.languageIdByLabel.has(label)) {
          return;
        }

        const familyLabel = displayFamilyLabel(language.family);
        const branchLabel = displayBranchLabel(familyLabel, language.branch);
        const familyId = this.ensureSearchFamily(familyLabel);
        const branchId = this.ensureSearchBranch(familyId, branchLabel);
        const languageId = language.id || `search:${label}`;

        this.languageById.set(languageId, {
          id: languageId,
          label,
          rows: Number(language.rows || 0),
          family_id: familyId,
          branch_id: branchId,
          search_only: true,
        });
        this.languageIdByLabel.set(label, languageId);
        this.languagesByFamily.get(familyId).push(languageId);
        this.languagesByBranch.get(branchId).push(languageId);
      });
    }

    ensureSearchFamily(label) {
      const familyLabel = label || "Unclassified";
      const existingId = this.familyIdByLabel.get(familyLabel);
      if (existingId) {
        return existingId;
      }

      const familyId = `search-family:${familyLabel}`;
      const family = {
        id: familyId,
        label: familyLabel,
        rows: 0,
        branches: [],
      };
      this.familyById.set(familyId, family);
      this.familyIdByLabel.set(familyLabel, familyId);
      this.languagesByFamily.set(familyId, []);
      return familyId;
    }

    ensureSearchBranch(familyId, label) {
      const branchLabel = label || "";
      const key = groupKey(familyId, branchLabel);
      const existingId = this.branchIdByFamilyAndLabel.get(key);
      if (existingId) {
        return existingId;
      }

      const branchId = `search-branch:${familyId}:${branchLabel || "unclassified"}`;
      const branch = {
        id: branchId,
        label: branchLabel,
        rows: 0,
        family_id: familyId,
      };
      this.branchById.set(branchId, branch);
      this.branchIdByFamilyAndLabel.set(key, branchId);
      this.languagesByBranch.set(branchId, []);
      this.familyById.get(familyId).branches.push(branch);
      return branchId;
    }

    createIntent(type, id) {
      this.intentClock += 1;
      return { type, id, createdAt: this.intentClock };
    }

    toggleAll() {
      if (this.selectedLanguages.size === this.languageById.size) {
        this.selectedLanguages = new Set();
        this.selectionIntents = [];
      } else {
        this.selectedLanguages = new Set(this.languageById.keys());
        this.selectionIntents = [this.createIntent("all", "all")];
      }

      this.normalizeIntents();
    }

    toggleGroup(type, id, checked) {
      const languageIds = this.groupLanguageIds(type, id);

      if (checked) {
        const fillsExistingExclusion = this.isExactExcludedItem(type, id);
        languageIds.forEach((languageId) => this.selectedLanguages.add(languageId));

        if (!fillsExistingExclusion) {
          this.removeCoveredIntents(type, id);
          this.selectionIntents.push(this.createIntent(type, id));
        }
      } else {
        languageIds.forEach((languageId) => this.selectedLanguages.delete(languageId));
        this.selectionIntents = this.selectionIntents.filter((intent) => {
          return !(intent.type === type && intent.id === id) && !this.isIntentInside(intent, type, id);
        });
      }

      this.normalizeIntents();
    }

    toggleLanguage(languageId, checked) {
      if (checked) {
        const fillsExistingExclusion = this.isExactExcludedItem("language", languageId);
        this.selectedLanguages.add(languageId);

        if (
          !fillsExistingExclusion &&
          (!this.coveringGroupIntent(languageId) || this.isInsidePartialAncestorSelection(languageId))
        ) {
          this.selectionIntents.push(this.createIntent("language", languageId));
        }
      } else {
        this.selectedLanguages.delete(languageId);
        this.selectionIntents = this.selectionIntents.filter((intent) => {
          return !(intent.type === "language" && intent.id === languageId);
        });
      }

      this.normalizeIntents();
    }

    normalizeIntents() {
      this.selectionIntents = this.dedupeIntents(this.selectionIntents)
        .filter((intent) => this.selectedCountForIntent(intent) > 0);

      this.branchById.forEach((branch) => {
        const ids = this.languagesByBranch.get(branch.id) || [];
        const selectedAll = ids.length > 0 && ids.every((languageId) => this.selectedLanguages.has(languageId));
        const explicitLanguageCoverage = ids.length > 0 && ids.every((languageId) => this.hasIntent("language", languageId));
        const alreadyHasBranch = this.hasIntent("branch", branch.id);
        const hasFullAncestor = this.selectionIntents.some((intent) => {
          return (
            intent.type === "all" && this.isFullIntent("all", "all")
          ) || (
            intent.type === "family" &&
            intent.id === branch.family_id &&
            this.isFullIntent("family", branch.family_id)
          );
        });

        if (selectedAll && !hasFullAncestor && (explicitLanguageCoverage || alreadyHasBranch)) {
          this.removeCoveredIntents("branch", branch.id);
          this.ensureIntent("branch", branch.id);
        }
      });

      if (this.languageById.size > 0 && this.selectedLanguages.size === this.languageById.size) {
        this.selectionIntents = this.selectionIntents.filter((intent) => intent.type === "all");
        this.ensureIntent("all", "all");
      }

      this.familyById.forEach((family) => {
        const ids = this.languagesByFamily.get(family.id) || [];
        const hasAllIntent = this.selectionIntents.some((intent) => intent.type === "all");
        const selectedAll = ids.length > 0 && ids.every((languageId) => this.selectedLanguages.has(languageId));
        const explicitBranchCoverage = family.branches.every((branch) => this.hasIntent("branch", branch.id));

        if (selectedAll && !hasAllIntent && explicitBranchCoverage) {
          this.removeCoveredIntents("family", family.id);
          this.ensureIntent("family", family.id);
        }
      });

      this.selectionIntents = this.dedupeIntents(this.selectionIntents)
        .filter((intent) => this.selectedCountForIntent(intent) > 0)
        .filter((intent) => !this.hasFullAncestorIntent(intent))
        .sort((left, right) => left.createdAt - right.createdAt);
    }

    dedupeIntents(intents) {
      const seen = new Set();
      const deduped = [];

      intents.forEach((intent) => {
        const key = `${intent.type}:${intent.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(intent);
        }
      });

      return deduped;
    }

    ensureIntent(type, id) {
      if (!this.hasIntent(type, id)) {
        this.selectionIntents.push(this.createIntent(type, id));
      }
    }

    hasIntent(type, id) {
      return this.selectionIntents.some((intent) => intent.type === type && intent.id === id);
    }

    removeCoveredIntents(type, id) {
      this.selectionIntents = this.selectionIntents.filter((intent) => {
        return !(intent.type === type && intent.id === id) && !this.isIntentInside(intent, type, id);
      });
    }

    isIntentInside(intent, type, id) {
      if (type === "family") {
        if (intent.type === "all") {
          return false;
        }
        if (intent.type === "branch") {
          return this.branchById.get(intent.id)?.family_id === id;
        }
        if (intent.type === "language") {
          return this.languageById.get(intent.id)?.family_id === id;
        }
      }

      if (type === "branch" && intent.type === "language") {
        return this.languageById.get(intent.id)?.branch_id === id;
      }

      if (type === "all") {
        return intent.type !== "all";
      }

      return false;
    }

    hasFullAncestorIntent(intent) {
      if (
        intent.type !== "all" &&
        this.selectionIntents.some((candidate) => candidate.type === "all")
      ) {
        return this.isFullIntent("all", "all");
      }

      if (intent.type === "branch") {
        return this.selectionIntents.some((candidate) => {
          return (
            candidate.type === "family" &&
            candidate.id === this.branchById.get(intent.id)?.family_id &&
            this.isFullIntent(candidate.type, candidate.id)
          );
        });
      }

      if (intent.type === "language") {
        const language = this.languageById.get(intent.id);
        if (!language || language.search_only) {
          return false;
        }
        return this.selectionIntents.some((candidate) => {
          return (
            candidate.type === "family" &&
            candidate.id === language.family_id &&
            this.isFullIntent(candidate.type, candidate.id)
          ) || (
            candidate.type === "branch" &&
            candidate.id === language.branch_id &&
            this.isFullIntent(candidate.type, candidate.id)
          );
        });
      }

      return false;
    }

    isFullIntent(type, id) {
      const ids = this.groupLanguageIds(type, id);
      return ids.length > 0 && ids.every((languageId) => this.selectedLanguages.has(languageId));
    }

    coveringGroupIntent(languageId) {
      const language = this.languageById.get(languageId);
      if (!language || language.search_only) {
        return false;
      }
      return this.selectionIntents.some((intent) => {
        return (
          (intent.type === "family" && intent.id === language.family_id) ||
          (intent.type === "branch" && intent.id === language.branch_id)
        );
      });
    }

    isInsidePartialAncestorSelection(languageId) {
      const language = this.languageById.get(languageId);
      if (!language || language.search_only) {
        return false;
      }
      return this.selectionIntents.some((intent) => {
        if (intent.type === "all") {
          return this.selectedLanguages.size < this.languageById.size;
        }

        if (intent.type === "family" && intent.id === language.family_id) {
          const familyIds = this.languagesByFamily.get(intent.id) || [];
          return familyIds.some((id) => !this.selectedLanguages.has(id));
        }

        if (intent.type === "branch" && intent.id === language.branch_id) {
          const branchIds = this.languagesByBranch.get(intent.id) || [];
          return branchIds.some((id) => !this.selectedLanguages.has(id));
        }

        return false;
      });
    }

    groupLanguageIds(type, id) {
      if (type === "family") {
        return this.languagesByFamily.get(id) || [];
      }
      if (type === "branch") {
        return this.languagesByBranch.get(id) || [];
      }
      if (type === "all") {
        return Array.from(this.languageById.keys());
      }
      return [id];
    }

    selectedCountForIntent(intent) {
      return this.groupLanguageIds(intent.type, intent.id)
        .filter((languageId) => this.selectedLanguages.has(languageId))
        .length;
    }

    submittedLanguages() {
      return Array.from(this.selectedLanguages)
        .map((languageId) => this.languageById.get(languageId))
        .sort((left, right) => left.label.localeCompare(right.label));
    }

    chipModels() {
      return this.selectionIntents
        .map((intent) => ({
          intent,
          label: this.intentLabel(intent),
          exclusions: this.exclusionItems(intent),
        }))
        .filter((chip) => this.selectedCountForIntent(chip.intent) > 0);
    }

    intentLabel(intent) {
      if (intent.type === "family") {
        return this.familyById.get(intent.id)?.label || intent.id;
      }
      if (intent.type === "all") {
        return "All languages";
      }
      if (intent.type === "branch") {
        return this.branchById.get(intent.id)?.label || intent.id;
      }
      return this.languageById.get(intent.id)?.label || intent.id;
    }

    exclusionItems(intent) {
      if (intent.type === "language") {
        return [];
      }

      return this.groupedExclusionItems(intent, { includeLaterIntents: true });
    }

    groupedExclusionItems(intent, { includeLaterIntents }) {
      const missing = new Set(
        this.groupLanguageIds(intent.type, intent.id).filter((languageId) => {
          return (
            !this.selectedLanguages.has(languageId) ||
            (includeLaterIntents && this.isCoveredByLaterIntent(languageId, intent))
          );
        })
      );
      const exclusions = [];

      if (intent.type === "all") {
        this.familyById.forEach((family) => {
          const familyLanguageIds = this.languagesByFamily.get(family.id) || [];
          const allMissing = familyLanguageIds.length > 0 && familyLanguageIds.every((id) => missing.has(id));
          if (allMissing) {
            exclusions.push({ label: family.label, languageIds: familyLanguageIds });
            familyLanguageIds.forEach((id) => missing.delete(id));
          }
        });

        this.familyById.forEach((family) => {
          family.branches.forEach((branch) => {
            const branchLanguageIds = this.languagesByBranch.get(branch.id) || [];
            const allMissing = branchLanguageIds.length > 0 && branchLanguageIds.every((id) => missing.has(id));
            if (allMissing) {
              exclusions.push({ label: branch.label, languageIds: branchLanguageIds });
              branchLanguageIds.forEach((id) => missing.delete(id));
            }
          });
        });
      }

      if (intent.type === "family") {
        const family = this.familyById.get(intent.id);
        family.branches.forEach((branch) => {
          const branchLanguageIds = this.languagesByBranch.get(branch.id) || [];
          const allMissing = branchLanguageIds.length > 0 && branchLanguageIds.every((id) => missing.has(id));
          if (allMissing) {
            exclusions.push({ label: branch.label, languageIds: branchLanguageIds });
            branchLanguageIds.forEach((id) => missing.delete(id));
          }
        });
      }

      Array.from(missing)
        .map((languageId) => this.languageById.get(languageId))
        .sort((left, right) => left.label.localeCompare(right.label))
        .forEach((language) => {
          exclusions.push({ label: language.label, languageIds: [language.id] });
        });

      return exclusions;
    }

    isExactExcludedItem(type, id) {
      const targetIds = sortedIds(this.groupLanguageIds(type, id));
      return this.selectionIntents.some((intent) => {
        if (!this.isIntentInside({ type, id }, intent.type, intent.id)) {
          return false;
        }

        return this.groupedExclusionItems(intent, { includeLaterIntents: true }).some((exclusion) => {
          return arraysEqual(sortedIds(exclusion.languageIds), targetIds);
        });
      });
    }

    isCoveredByLaterIntent(languageId, intent) {
      return this.selectionIntents.some((candidate) => {
        return (
          candidate.createdAt > intent.createdAt &&
          candidate.type !== "all" &&
          this.groupLanguageIds(candidate.type, candidate.id).includes(languageId)
        );
      });
    }
  }

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

    beginLanguageFilterSearchContext() {
      if (this.languageFilterSearchContext) {
        return;
      }

      this.languageFilterSearchContext = {
        allSelectedAtStart: this.state.selectionIntents.some((intent) => intent.type === "all"),
        selectedFamilyIds: this.intentIdsAtStart("family"),
        hasFullySelectedFamilyAtStart: this.hasFullySelectedFamilyAtStart(),
        selectedBranchIds: this.intentIdsAtStart("branch"),
        selectedLanguageIds: this.intentIdsAtStart("language"),
        activeFamilyIds: this.activeFamilyIdsAtStart(),
      };
    }

    intentIdsAtStart(type) {
      return new Set(
        this.state.selectionIntents
          .filter((intent) => intent.type === type)
          .map((intent) => intent.id)
      );
    }

    activeFamilyIdsAtStart() {
      const familyIds = new Set();
      this.state.selectedLanguages.forEach((languageId) => {
        const familyId = this.state.languageById.get(languageId)?.family_id;
        if (familyId) {
          familyIds.add(familyId);
        }
      });
      return familyIds;
    }

    hasFullySelectedFamilyAtStart() {
      return Array.from(this.state.familyById.keys()).some((familyId) => {
        return this.state.isFullIntent("family", familyId);
      });
    }

    setTreeOpenState(open) {
      this.tree.querySelectorAll(".taxonomy-family, .taxonomy-branch").forEach((details) => {
        details.open = open;
      });
    }

    updateLanguageFilterSearchContextAfterGroupChange(type, id, checked) {
      if (!this.languageFilterSearchContext || !checked || type !== "branch") {
        return;
      }

      if (
        this.languageFilterSearchContext.allSelectedAtStart ||
        this.languageFilterSearchContext.selectedFamilyIds.size > 0
      ) {
        return;
      }

      this.languageFilterSearchContext.selectedBranchIds.add(id);
      const searchInput = document.querySelector("[data-language-search]");
      if (searchInput?.value.trim()) {
        this.applyLanguageSearch(searchInput.value);
      }
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
    }

    renderFilterSizeWarning() {
      if (!this.filterSizeWarning) {
        return;
      }

      const hasLanguageFilter = this.state.selectedLanguages.size > 0;
      const selectedRows = this.selectedLanguageRows();
      this.filterSizeWarning.hidden = !hasLanguageFilter || selectedRows >= 1000;
    }

    syncClearFiltersButton() {
      if (!this.clearFilters) {
        return;
      }

      const hasLanguageFilters = this.state.selectedLanguages.size > 0;
      const hasPosFilters = Boolean(document.querySelector("[name='pos']:checked"));
      const hasFilters = hasLanguageFilters || hasPosFilters;
      this.clearFilters.disabled = !hasFilters;
      this.clearFilters.textContent = hasFilters ? "Clear all filters" : "No filters selected";
    }

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
    }

    selectedLanguageRows() {
      return Array.from(this.state.selectedLanguages).reduce((total, languageId) => {
        return total + Number(this.state.languageById.get(languageId)?.rows || 0);
      }, 0);
    }

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
    }

    applyGroupCheckboxState(checkbox) {
      const ids = this.state.groupLanguageIds(checkbox.dataset.languageGroup, checkbox.dataset.groupId);
      const selectedCount = ids.filter((languageId) => this.state.selectedLanguages.has(languageId)).length;
      checkbox.checked = ids.length > 0 && selectedCount === ids.length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    }

    applyLanguageSearch(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      const matches = this.searchResultGroups(query, this.languageFilterSearchContext);
      const matchingFamilies = new Set(matches.families.map((family) => family.id));
      const matchingBranches = new Set();
      const matchingLanguages = new Set();

      matches.families.forEach((family) => {
        family.branches.forEach((branch) => {
          matchingBranches.add(branch.id);
          branch.languages.forEach((language) => matchingLanguages.add(language.id));
        });
      });

      this.tree.querySelectorAll("[data-language-row]").forEach((row) => {
        const languageId = row.dataset.languageId;
        row.classList.toggle("is-hidden", Boolean(query) && !matchingLanguages.has(languageId));
      });

      this.tree.querySelectorAll("[data-branch-id]").forEach((details) => {
        const isMatch = !query || matchingBranches.has(details.dataset.branchId);
        details.classList.toggle("is-hidden", !isMatch);
        if (isMatch && query) {
          details.open = true;
        }
      });

      this.tree.querySelectorAll("[data-family-id]").forEach((details) => {
        const isMatch = !query || matchingFamilies.has(details.dataset.familyId);
        details.classList.toggle("is-hidden", !isMatch);
        if (isMatch && query) {
          details.open = true;
        }
      });

      this.renderSearchMatches(query, matches);
    }

    hideSearchResults() {
      if (!this.searchResults) {
        return;
      }
      this.searchResults.hidden = true;
      this.languageFilterSearchContext = null;
    }

    renderSearchMatches(query, matches) {
      if (!this.searchResults) {
        return;
      }

      this.searchResults.innerHTML = "";
      this.searchResults.hidden = !query;

      if (!query) {
        return;
      }

      if (matches.families.length === 0) {
        this.searchResults.hidden = true;
        return;
      }

      matches.families.forEach((family) => {
        this.searchResults.appendChild(this.buildSearchGroupRow("family", family.id, family.label));

        if (family.branches.length > 0) {
          const branchHost = document.createElement("div");
          branchHost.className = "language-search-branches";
          family.branches.forEach((branch) => {
            if (branch.label) {
              branchHost.appendChild(this.buildSearchGroupRow("branch", branch.id, branch.label));
            }

            const languageHost = document.createElement("div");
            languageHost.className = "language-search-languages";
            if (!branch.label) {
              languageHost.classList.add("language-search-languages-branchless");
            }
            branch.languages.forEach((language) => {
              languageHost.appendChild(this.buildSearchLanguageRow(language));
            });
            branchHost.appendChild(languageHost);
          });
          this.searchResults.appendChild(branchHost);
        }
      });

    }

    searchResultGroups(query, context) {
      if (!query) {
        return { families: [] };
      }

      if (context?.allSelectedAtStart) {
        return this.defaultLanguageFilterSearchGroups(query);
      }

      if (context?.hasFullySelectedFamilyAtStart && context.activeFamilyIds.size > 0) {
        const results = this.defaultLanguageFilterSearchGroups(query, context.activeFamilyIds);
        context.selectedBranchIds.forEach((branchId) => {
          this.addFullBranchSearchContext(results.familyMap, branchId, query);
        });
        return this.finalizeLanguageFilterSearchGroups(results.familyMap);
      }

      const results = this.defaultLanguageFilterSearchGroups(query);
      context?.selectedBranchIds.forEach((branchId) => {
        this.addFullBranchSearchContext(results.familyMap, branchId, query);
      });
      return this.finalizeLanguageFilterSearchGroups(results.familyMap);
    }

    defaultLanguageFilterSearchGroups(query, familyScope = null) {
      const familyMap = new Map();

      this.state.familyById.forEach((family) => {
        if (familyScope && !familyScope.has(family.id)) {
          return;
        }

        const familyMatches = family.label.toLowerCase().includes(query);
        if (familyMatches) {
          this.ensureSearchFamilyResult(familyMap, family);
        }

        family.branches.forEach((branch) => {
          const branchMatches = branch.label.toLowerCase().includes(query);
          const branchLanguages = (this.state.languagesByBranch.get(branch.id) || [])
            .map((languageId) => this.state.languageById.get(languageId))
            .filter(Boolean)
            .sort((left, right) => left.label.localeCompare(right.label));
          const languages = branchLanguages
            .filter((language) => {
              return language.label.toLowerCase().includes(query);
            });

          if (branchMatches || languages.length > 0) {
            this.addBranchSearchResult(familyMap, family, branch, languages);
          }
        });
      });

      return this.finalizeLanguageFilterSearchGroups(familyMap);
    }

    addFullBranchSearchContext(familyMap, branchId, query) {
      const branch = this.state.branchById.get(branchId);
      if (!branch) {
        return;
      }
      if (!branch.label.toLowerCase().includes(query)) {
        return;
      }

      const family = this.state.familyById.get(branch.family_id);
      if (!family) {
        return;
      }

      const languages = (this.state.languagesByBranch.get(branch.id) || [])
        .map((languageId) => this.state.languageById.get(languageId))
        .filter(Boolean)
        .sort((left, right) => left.label.localeCompare(right.label));
      this.addBranchSearchResult(familyMap, family, branch, languages);
    }

    ensureSearchFamilyResult(familyMap, family) {
      if (!familyMap.has(family.id)) {
        familyMap.set(family.id, {
          id: family.id,
          label: family.label,
          rows: family.rows,
          branches: new Map(),
        });
      }
      return familyMap.get(family.id);
    }

    addBranchSearchResult(familyMap, family, branch, languages) {
      const familyResult = this.ensureSearchFamilyResult(familyMap, family);
      if (!familyResult.branches.has(branch.id)) {
        familyResult.branches.set(branch.id, {
          id: branch.id,
          label: branch.label,
          rows: branch.rows,
          languages: new Map(),
        });
      }

      const branchResult = familyResult.branches.get(branch.id);
      languages.forEach((language) => {
        branchResult.languages.set(language.id, language);
      });
    }

    finalizeLanguageFilterSearchGroups(familyMap) {
      return {
        familyMap,
        families: Array.from(familyMap.values()).map((family) => ({
          id: family.id,
          label: family.label,
          rows: family.rows,
          branches: Array.from(family.branches.values())
            .map((branch) => ({
              id: branch.id,
              label: branch.label,
              rows: branch.rows,
              languages: Array.from(branch.languages.values())
                .sort((left, right) => left.label.localeCompare(right.label)),
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        })),
      };
    }

    buildSearchGroupRow(type, id, label) {
      const row = document.createElement("label");
      row.className = "check-row taxonomy-summary";
      row.dataset.languageGroupRow = "";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.languageGroup = type;
      checkbox.dataset.groupId = id;
      this.applyGroupCheckboxState(checkbox);
      row.appendChild(checkbox);

      const text = document.createElement("span");
      text.className = "filter-label";
      text.textContent = label;
      row.appendChild(text);

      const count = this.rowCountForGroup(type, id);
      row.appendChild(this.buildCountLabel(count));
      return row;
    }

    buildSearchLanguageRow(language) {
      const row = document.createElement("label");
      row.className = "check-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.languageSearchCheckbox = "";
      checkbox.dataset.languageId = language.id;
      checkbox.value = language.label;
      checkbox.checked = this.state.selectedLanguages.has(language.id);
      row.appendChild(checkbox);

      const label = document.createElement("span");
      label.className = "filter-label";
      label.textContent = language.label;
      row.appendChild(label);
      row.appendChild(this.buildCountLabel(language.rows));
      return row;
    }

    rowCountForGroup(type, id) {
      if (type === "family") {
        return this.state.familyById.get(id)?.rows || 0;
      }
      if (type === "branch") {
        return this.state.branchById.get(id)?.rows || 0;
      }
      return 0;
    }

    buildCountLabel(rows) {
      const count = document.createElement("span");
      count.className = "filter-count";
      count.textContent = `(${formatCount(rows)})`;
      return count;
    }
  }

  function readFamiliesFromDom(tree) {
    return Array.from(tree.querySelectorAll("[data-family-id]")).map((familyElement) => {
      return {
        id: familyElement.dataset.familyId,
        label: familyElement.dataset.familyLabel,
        rows: Number(familyElement.dataset.rowCount || 0),
        branches: Array.from(familyElement.querySelectorAll("[data-branch-id]")).map((branchElement) => {
          return {
            id: branchElement.dataset.branchId,
            label: branchElement.dataset.branchLabel,
            rows: Number(branchElement.dataset.rowCount || 0),
            languages: Array.from(branchElement.querySelectorAll("[data-language-row]")).map((languageElement) => {
              const checkbox = languageElement.querySelector("[data-language-checkbox]");
              return {
                id: languageElement.dataset.languageId,
                label: checkbox.value,
                rows: Number(languageElement.dataset.rowCount || 0),
              };
            }),
          };
        }),
      };
    });
  }

  function buildPosChip(checkbox, onRemove) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.setAttribute("aria-label", `Remove ${checkbox.value}`);
    chip.append(checkbox.value, " x");
    chip.addEventListener("click", () => {
      checkbox.checked = false;
      onRemove();
    });
    return chip;
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  function initializeLanguageFilters() {
    const tree = document.querySelector("[data-language-tree]");
    const chipList = document.querySelector("[data-filter-chips]");
    const emptyState = document.querySelector("[data-filter-chip-empty]");
    const filterSizeWarning = document.querySelector("[data-filter-size-warning]");
    const clearFilters = document.querySelector("[data-clear-filters]");
    const inputHost = document.querySelector("[data-language-inputs]");
    const selectAll = document.querySelector("[data-language-select-all]");
    const selectAllLabel = document.querySelector("[data-language-select-all-label]");
    const searchResults = document.querySelector("[data-language-search-results]");

    if (!tree || !chipList || !inputHost) {
      return null;
    }

    const controller = new LanguageFilterController({
      tree,
      chipList,
      emptyState,
      filterSizeWarning,
      clearFilters,
      inputHost,
      selectAll,
      selectAllLabel,
      searchResults,
    });
    controller.bind();
    return controller;
  }

  function sortedIds(ids) {
    return Array.from(ids).sort();
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function groupKey(familyId, label) {
    return `${familyId}:${label || ""}`;
  }

  function displayFamilyLabel(family) {
    if (!family || isUnclassifiedBucket(family)) {
      return "Unclassified";
    }
    return family;
  }

  function displayBranchLabel(family, branch) {
    if (family === "Unclassified") {
      return "";
    }
    if (!branch || isUnclassifiedBucket(branch) || branch === "Review") {
      return "";
    }
    return branch;
  }

  function isUnclassifiedBucket(label) {
    return [
      "Unmatched",
      "Unclassifiable",
      "Bookkeeping",
      "Speech Register",
      "Unattested",
    ].includes(label);
  }

  return {
    LanguageFilterState,
    initializeLanguageFilters,
  };
});
