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
  const { formatCount } = domModule;

  Object.assign(LanguageFilterController.prototype, {
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
    },

    intentIdsAtStart(type) {
      return new Set(
        this.state.selectionIntents
          .filter((intent) => intent.type === type)
          .map((intent) => intent.id)
      );
    },

    activeFamilyIdsAtStart() {
      const familyIds = new Set();
      this.state.selectedLanguages.forEach((languageId) => {
        const familyId = this.state.languageById.get(languageId)?.family_id;
        if (familyId) {
          familyIds.add(familyId);
        }
      });
      return familyIds;
    },

    hasFullySelectedFamilyAtStart() {
      return Array.from(this.state.familyById.keys()).some((familyId) => {
        return this.state.isFullIntent("family", familyId);
      });
    },

    setTreeOpenState(open) {
      this.tree.querySelectorAll(".taxonomy-family, .taxonomy-branch").forEach((details) => {
        details.open = open;
      });
    },

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
    },

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
    },

    hideSearchResults() {
      if (!this.searchResults) {
        return;
      }
      this.searchResults.hidden = true;
      this.languageFilterSearchContext = null;
    },

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

    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    rowCountForGroup(type, id) {
      if (type === "family") {
        return this.state.familyById.get(id)?.rows || 0;
      }
      if (type === "branch") {
        return this.state.branchById.get(id)?.rows || 0;
      }
      return 0;
    },

    buildCountLabel(rows) {
      const count = document.createElement("span");
      count.className = "filter-count";
      count.textContent = `(${formatCount(rows)})`;
      return count;
    },
  });

  return controllerModule;
});
