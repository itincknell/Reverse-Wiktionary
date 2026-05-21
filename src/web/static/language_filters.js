(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./language_filter_state.js"),
      require("./language_filter_controller.js"),
      require("./language_filter_chips.js"),
      require("./language_filter_search.js")
    );
  } else {
    root.ReverseWiktionaryLanguageFilters = factory(
      root.ReverseWiktionaryLanguageFilterState,
      root.ReverseWiktionaryLanguageFilterController
    );
  }
})(typeof self !== "undefined" ? self : this, function (stateModule, controllerModule) {
  const { LanguageFilterState } = stateModule;
  const { LanguageFilterController } = controllerModule;

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

  return {
    LanguageFilterState,
    initializeLanguageFilters,
  };
});
