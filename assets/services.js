(() => {
  const router = document.querySelector('[data-service-router]');
  if (!router) return;

  const cards = Array.from(document.querySelectorAll('[data-service-card]'));
  if (!cards.length) return;

  const intentButtons = Array.from(router.querySelectorAll('button[data-intent]'));
  const resetButton = router.querySelector('[data-router-reset]');
  const guidanceTarget = router.querySelector('[data-router-guidance]');
  const countTarget = router.querySelector('[data-router-count]');

  const intentLabels = {
    'live-fast': 'Get live fast with a first milestone',
    governance: 'Set governance and decision rules',
    workflows: 'Map and improve workflows',
    enablement: 'Enable the team after launch',
  };

  const guidanceByIntent = {
    'live-fast':
      'Recommended starting point: Start with discovery and scope, then move into a fixed milestone for the highest-priority workflow.',
    governance:
      'Recommended starting point: Prioritize AI adoption planning and knowledge operations to establish clear decision and review rules.',
    workflows:
      'Recommended starting point: Begin with analytics operating model and knowledge operations to improve flow and decision context.',
    enablement:
      'Recommended starting point: Use cross-functional rollout support to define handoffs, training rhythm, and sustained adoption steps.',
  };

  let activeIntent = '';

  const updateCount = (visibleCount) => {
    if (!countTarget) return;

    if (!activeIntent) {
      countTarget.textContent = `Showing all ${cards.length} services.`;
      return;
    }

    const label = intentLabels[activeIntent] || 'selected intent';
    const suffix = visibleCount === 1 ? 'service' : 'services';
    countTarget.textContent = `Showing ${visibleCount} ${suffix} for \"${label}\".`;
  };

  const updateGuidance = () => {
    if (!guidanceTarget) return;

    if (!activeIntent) {
      guidanceTarget.textContent = 'Recommended starting point: Select an intent to focus the services list.';
      return;
    }

    guidanceTarget.textContent = guidanceByIntent[activeIntent] || 'Recommended starting point: Start with the service that matches your immediate decision need.';
  };

  const applyIntent = (intent = '') => {
    activeIntent = intent;

    intentButtons.forEach((button) => {
      const isActive = button.dataset.intent === activeIntent;
      button.setAttribute('aria-pressed', String(isActive));
    });

    let visibleCount = 0;

    cards.forEach((card) => {
      const intents = (card.dataset.intents || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const shouldShow = !activeIntent || intents.includes(activeIntent);
      card.hidden = !shouldShow;

      if (shouldShow) {
        visibleCount += 1;
      }
    });

    if (resetButton) {
      resetButton.hidden = !activeIntent;
    }

    updateGuidance();
    updateCount(visibleCount);
  };

  intentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const intent = button.dataset.intent || '';
      applyIntent(intent === activeIntent ? '' : intent);
    });
  });

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      applyIntent('');
    });
  }

  applyIntent('');
})();