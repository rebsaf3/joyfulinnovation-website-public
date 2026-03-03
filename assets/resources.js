(() => {
  const grid = document.getElementById('resources-grid');
  const count = document.getElementById('resource-count');
  const search = document.getElementById('resource-search');
  const filterButtons = Array.from(document.querySelectorAll('[data-resource-filter]'));
  const data = window.JOYFUL_RESOURCES || [];

  if (!grid || !search || !filterButtons.length) return;

  let activeCategory = 'all';

  function render() {
    const term = search.value.trim().toLowerCase();
    const filtered = data.filter((item) => {
      const categoryMatch = activeCategory === 'all' || item.category === activeCategory;
      const text = `${item.title} ${item.summary} ${item.categoryLabel}`.toLowerCase();
      const searchMatch = !term || text.includes(term);
      return categoryMatch && searchMatch;
    });

    grid.innerHTML = filtered
      .map(
        (item) => `
          <a class="card resource-card" href="${item.url}">
            <img class="post-image" src="${item.image}" alt="${item.imageAlt}" loading="lazy" decoding="async" />
            <p class="post-label">${item.categoryLabel}</p>
            <h3>${item.title}</h3>
            <p>${item.summary}</p>
            <p class="resource-link">Open resource</p>
          </a>
        `,
      )
      .join('');

    count.textContent = `Showing ${filtered.length} resource${filtered.length === 1 ? '' : 's'}`;
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.getAttribute('data-resource-filter') || 'all';
      filterButtons.forEach((btn) => {
        const selected = btn === button;
        btn.setAttribute('aria-pressed', String(selected));
      });
      render();
    });
  });

  search.addEventListener('input', render);
  render();
})();