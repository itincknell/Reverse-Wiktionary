(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReverseWiktionaryLanguageFilterState = factory();
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
  };
});
