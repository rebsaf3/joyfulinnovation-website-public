(() => {
  const grid = document.getElementById('support-grid');
  const count = document.getElementById('support-count');
  const search = document.getElementById('support-search');
  const productFilter = document.getElementById('support-product');
  const tagButtons = Array.from(document.querySelectorAll('[data-support-tag]'));
  const data = window.JOYFUL_SUPPORT_ARTICLES || [];

  if (!grid || !search || !productFilter || !tagButtons.length) return;

  let activeTag = 'all';

  function render() {
    const term = search.value.trim().toLowerCase();
    const product = productFilter.value;

    const filtered = data.filter((item) => {
      const productMatch = product === 'all' || item.product === product;
      const tagMatch = activeTag === 'all' || item.tags.includes(activeTag);
      const text = `${item.title} ${item.summary} ${item.tags.join(' ')} ${item.product}`.toLowerCase();
      const searchMatch = !term || text.includes(term);
      return productMatch && tagMatch && searchMatch;
    });

    grid.innerHTML = filtered
      .map(
        (item) => `
          <article class="card">
            <p class="post-label">${item.product === 'general' ? 'General' : `NyLi ${item.product.charAt(0).toUpperCase() + item.product.slice(1)}`}</p>
            <h3>${item.title}</h3>
            <p>${item.summary}</p>
            <p><strong>Tags:</strong> ${item.tags.join(', ')}</p>
          </article>
        `,
      )
      .join('');

    count.textContent = `Showing ${filtered.length} article${filtered.length === 1 ? '' : 's'}`;
  }

  tagButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeTag = button.getAttribute('data-support-tag') || 'all';
      tagButtons.forEach((tag) => {
        tag.setAttribute('aria-pressed', String(tag === button));
      });
      render();
    });
  });

  search.addEventListener('input', render);
  productFilter.addEventListener('change', render);

  render();
})();