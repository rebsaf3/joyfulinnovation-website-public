(() => {
  const form = document.getElementById('decision-helper-form');
  if (!form) return;

  const output = document.getElementById('decision-result');
  const map = {
    content: {
      title: 'Start with NyLi Assets',
      copy: 'NyLi Assets is the content and knowledge backbone. Use it when your team needs one place to organize, search, and reuse approved materials.',
      href: '/product-assetpilot',
      cta: 'View NyLi Assets',
    },
    analytics: {
      title: 'Start with NyLi Insights',
      copy: 'NyLi Insights is built for dashboards, natural-language analytics, and clear decision visibility across teams.',
      href: '/product-insightpilot',
      cta: 'View NyLi Insights',
    },
    assistant: {
      title: 'Use NyLi Agent for Production Workflows',
      copy: 'NyLi Agent supports production implementations with scoped onboarding when you want assistant-led workflows and guided automation goals.',
      href: '/product-flowpilot',
      cta: 'View NyLi Agent',
    },
    strategy: {
      title: 'Start with Services',
      copy: 'If your first need is rollout planning, governance, or operating cadence, begin with a service engagement and then map products.',
      href: '/services',
      cta: 'View Services',
    },
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const goal = new FormData(form).get('goal');
    const recommendation = map[goal];

    if (!recommendation) {
      output.innerHTML = '<p class="field-error">Choose a goal to get a recommendation.</p>';
      return;
    }

    output.innerHTML = `
      <article class="card" aria-live="polite">
        <h3>${recommendation.title}</h3>
        <p>${recommendation.copy}</p>
        <div class="actions">
          <a class="btn btn-secondary" href="${recommendation.href}">${recommendation.cta}</a>
          <a class="btn btn-primary" href="/contact?intent=demo">Request a demo</a>
        </div>
      </article>
    `;
  });
})();
