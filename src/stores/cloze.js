(function () {
  'use strict';

  function resetClozeState(clozeItems, clozeAnswerStates) {
    if (clozeItems) clozeItems.length = 0;
    if (clozeAnswerStates) clozeAnswerStates.length = 0;
  }

  window.__clozeStore = {
    resetClozeState: resetClozeState
  };
})();
