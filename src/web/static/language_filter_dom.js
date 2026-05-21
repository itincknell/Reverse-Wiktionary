(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReverseWiktionaryLanguageFilterDom = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
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

  return {
    readFamiliesFromDom,
    buildPosChip,
    formatCount,
  };
});
