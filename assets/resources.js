(() => {
  const grid = document.getElementById('resources-grid');
  const count = document.getElementById('resource-count');
  const search = document.getElementById('resource-search');
  const totalBadge = document.getElementById('resource-total-badge');
  const activeChips = document.getElementById('active-filter-chips');
  const emptyState = document.getElementById('resource-empty-state');
  const loadMoreButton = document.getElementById('resources-load-more');
  const categoryList = document.getElementById('resource-category-list');
  const secondaryWrap = document.getElementById('resource-secondary-filter-wrap');
  const secondaryList = document.getElementById('resource-secondary-list');
  const secondaryPills = document.getElementById('resource-secondary-pills');
  const presetsWrap = document.getElementById('resource-presets-wrap');
  const quickFilterWrap = document.querySelector('.resources-quick-filters');
  const sortControls = Array.from(document.querySelectorAll('[data-resource-sort]'));
  const clearAllButtons = Array.from(document.querySelectorAll('[data-clear-all]'));
  const presetButtons = Array.from(document.querySelectorAll('[data-resource-preset]'));

  const layout = document.querySelector('[data-resources-layout]');
  const sidebar = document.getElementById('resources-sidebar');
  const sidebarToggle = document.querySelector('[data-sidebar-collapse]');
  const openFiltersButton = document.querySelector('[data-open-filters]');
  const backdrop = document.querySelector('[data-filters-backdrop]');
  const mobileQuery = window.matchMedia('(max-width: 960px)');

  const data = window.JOYFUL_RESOURCES || [];
  if (!grid || !search || !count || !quickFilterWrap || !sortControls.length) return;

  const PAGE_SIZE = 6;
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const isInputLike = (element) => {
    if (!element) return false;
    return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
  };

  const focusGrid = () => {
    if (!grid.hasAttribute('tabindex')) {
      grid.setAttribute('tabindex', '-1');
    }
    grid.focus();
  };

  const setDrawerOpen = (open) => {
    if (!sidebar || !backdrop || !openFiltersButton) return;
    const isOpen = Boolean(open);
    document.body.classList.toggle('resources-filters-open', isOpen);
    backdrop.hidden = !isOpen;
    openFiltersButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      sidebar.focus({ preventScroll: true });
    }
  };

  const closeDrawer = () => setDrawerOpen(false);

  const updateSidebarToggleLabel = () => {
    if (!sidebarToggle || !layout) return;
    if (mobileQuery.matches) {
      sidebarToggle.textContent = 'Close';
      return;
    }
    sidebarToggle.textContent = layout.classList.contains('sidebar-collapsed') ? 'Expand' : 'Collapse';
  };

  const categoryLabelMap = new Map();
  data.forEach((item) => {
    if (item.category && item.categoryLabel && !categoryLabelMap.has(item.category)) {
      categoryLabelMap.set(item.category, item.categoryLabel);
    }
  });

  const quickButtonsInitial = Array.from(quickFilterWrap.querySelectorAll('[data-resource-filter]'));
  const knownQuickCategories = new Set(
    quickButtonsInitial
      .map((button) => button.getAttribute('data-resource-filter') || '')
      .filter((value) => value && value !== 'all'),
  );

  const dataCategories = Array.from(new Set(data.map((item) => item.category).filter(Boolean)));
  dataCategories.forEach((category) => {
    if (knownQuickCategories.has(category)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('data-resource-filter', category);
    button.textContent = categoryLabelMap.get(category) || category;
    quickFilterWrap.appendChild(button);
  });

  const categoryOrder = Array.from(
    new Set(
      Array.from(quickFilterWrap.querySelectorAll('[data-resource-filter]'))
        .map((button) => button.getAttribute('data-resource-filter') || '')
        .filter((value) => value && value !== 'all'),
    ),
  );

  const tags = Array.from(
    new Set(
      data
        .flatMap((item) => (Array.isArray(item.tags) ? item.tags : []))
        .map((tag) => String(tag).trim())
        .filter(Boolean),
    ),
  );

  const hasTags = tags.length > 0;
  const featuredResources = data.filter((item) => item.featured === true);

  if (presetsWrap && featuredResources.length > 0) {
    const featuredCards = featuredResources
      .slice(0, 6)
      .map(
        (item) => `
          <a class="card resource-featured-card" href="${escapeHtml(item.url)}">
            <p class="post-label">${escapeHtml(item.categoryLabel || 'Resource')}</p>
            <h4>${escapeHtml(item.title || '')}</h4>
          </a>
        `,
      )
      .join('');

    presetsWrap.innerHTML = `
      <h3 class="resource-presets-title">Featured resources</h3>
      <div class="resource-featured-row" role="list">${featuredCards}</div>
    `;
  }
  const hasReliableDates = data.length > 0 && data.every((item) => item.date && !Number.isNaN(Date.parse(item.date)));
  const defaultSort = hasReliableDates ? 'newest' : 'az';

  const sortOptions = [];
  if (hasReliableDates) {
    sortOptions.push({ value: 'newest', label: 'Newest first' });
  }
  sortOptions.push({ value: 'az', label: 'A to Z' });
  sortOptions.push({ value: 'category', label: 'Category' });

  sortControls.forEach((select) => {
    select.innerHTML = sortOptions.map((option) => `<option value="${option.value}">${option.label}</option>`).join('');
  });

  if (categoryList) {
    categoryList.innerHTML = [
      '<button class="chip" type="button" data-resource-filter="all" aria-pressed="true">All</button>',
      ...categoryOrder.map(
        (category) =>
          `<button class="chip" type="button" data-resource-filter="${escapeHtml(category)}" aria-pressed="false">${escapeHtml(categoryLabelMap.get(category) || category)}</button>`,
      ),
    ].join('');
  }

  if (hasTags && secondaryWrap && secondaryList && secondaryPills) {
    secondaryWrap.hidden = false;
    const tagButtons = tags
      .map(
        (tag) =>
          `<button class="chip" type="button" data-resource-tag="${escapeHtml(tag)}" aria-pressed="false">${escapeHtml(tag)}</button>`,
      )
      .join('');
    secondaryList.innerHTML = tagButtons;
    secondaryPills.hidden = false;
    secondaryPills.innerHTML = tagButtons;
  } else {
    if (secondaryWrap) secondaryWrap.hidden = true;
    if (secondaryPills) secondaryPills.hidden = true;
  }

  const sortLabelMap = new Map(sortOptions.map((option) => [option.value, option.label]));

  const state = {
    searchTerm: '',
    selectedCategories: new Set(),
    selectedTags: new Set(),
    sort: defaultSort,
    visibleCount: PAGE_SIZE,
  };

  const parseCsv = (value) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const applyUrlState = () => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const cat = params.get('cat');
    const tag = params.get('tag');
    const sort = params.get('sort');

    if (q) {
      state.searchTerm = q;
    }

    if (cat) {
      parseCsv(cat).forEach((item) => {
        if (categoryOrder.includes(item)) {
          state.selectedCategories.add(item);
        }
      });
    }

    if (hasTags && tag) {
      parseCsv(tag).forEach((item) => {
        if (tags.includes(item)) {
          state.selectedTags.add(item);
        }
      });
    }

    if (sort && sortLabelMap.has(sort)) {
      state.sort = sort;
    }
  };

  const updateUrlState = () => {
    const params = new URLSearchParams();
    if (state.searchTerm) {
      params.set('q', state.searchTerm);
    }
    if (state.selectedCategories.size) {
      params.set('cat', Array.from(state.selectedCategories).join(','));
    }
    if (hasTags && state.selectedTags.size) {
      params.set('tag', Array.from(state.selectedTags).join(','));
    }
    if (state.sort !== defaultSort) {
      params.set('sort', state.sort);
    }

    const query = params.toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    history.replaceState(null, '', next);
  };

  const syncFilterControls = () => {
    search.value = state.searchTerm;

    sortControls.forEach((select) => {
      select.value = state.sort;
    });

    const categoryButtons = Array.from(document.querySelectorAll('[data-resource-filter]'));
    categoryButtons.forEach((button) => {
      const value = button.getAttribute('data-resource-filter') || 'all';
      const active = value === 'all' ? state.selectedCategories.size === 0 : state.selectedCategories.has(value);
      button.setAttribute('aria-pressed', String(active));
    });

    const tagButtons = Array.from(document.querySelectorAll('[data-resource-tag]'));
    tagButtons.forEach((button) => {
      const value = button.getAttribute('data-resource-tag') || '';
      button.setAttribute('aria-pressed', String(state.selectedTags.has(value)));
    });
  };

  const sortData = (items) => {
    const sorted = [...items];

    if (state.sort === 'newest' && hasReliableDates) {
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return sorted;
    }

    if (state.sort === 'category') {
      sorted.sort((a, b) => {
        const categoryA = a.categoryLabel || a.category || '';
        const categoryB = b.categoryLabel || b.category || '';
        const categoryCmp = collator.compare(categoryA, categoryB);
        if (categoryCmp !== 0) return categoryCmp;
        return collator.compare(a.title || '', b.title || '');
      });
      return sorted;
    }

    sorted.sort((a, b) => collator.compare(a.title || '', b.title || ''));
    return sorted;
  };

  const matchesFilters = (item) => {
    const categoryMatch = state.selectedCategories.size === 0 || state.selectedCategories.has(item.category);

    const itemTags = Array.isArray(item.tags)
      ? item.tags
          .map((tag) => String(tag).trim())
          .filter(Boolean)
      : [];

    const tagMatch = !hasTags || state.selectedTags.size === 0 || itemTags.some((tag) => state.selectedTags.has(tag));

    const haystack = [item.title, item.summary, item.categoryLabel, ...(itemTags || [])].join(' ').toLowerCase();
    const searchMatch = !state.searchTerm || haystack.includes(state.searchTerm.toLowerCase());

    return categoryMatch && tagMatch && searchMatch;
  };

  const renderActiveFilterChips = () => {
    if (!activeChips) return;

    const chips = [];

    if (state.searchTerm) {
      chips.push(
        `<button class="chip" type="button" data-remove-kind="search" aria-label="Remove search filter">Search: ${escapeHtml(state.searchTerm)} x</button>`,
      );
    }

    state.selectedCategories.forEach((category) => {
      const label = categoryLabelMap.get(category) || category;
      chips.push(
        `<button class="chip" type="button" data-remove-kind="category" data-remove-value="${escapeHtml(category)}" aria-label="Remove category filter ${escapeHtml(label)}">${escapeHtml(label)} x</button>`,
      );
    });

    state.selectedTags.forEach((tag) => {
      chips.push(
        `<button class="chip" type="button" data-remove-kind="tag" data-remove-value="${escapeHtml(tag)}" aria-label="Remove tag filter ${escapeHtml(tag)}">${escapeHtml(tag)} x</button>`,
      );
    });

    if (state.sort !== defaultSort) {
      chips.push(
        `<button class="chip" type="button" data-remove-kind="sort" aria-label="Reset sort option">Sort: ${escapeHtml(sortLabelMap.get(state.sort) || state.sort)} x</button>`,
      );
    }

    activeChips.innerHTML = chips.join('');
    activeChips.hidden = chips.length === 0;
  };

  const renderGrid = (items) => {
    grid.innerHTML = items
      .map((item) => {
        const format = item.formatType || item.formatLabel || item.categoryLabel || '';
        const metaBits = [];
        if (item.readingTime) metaBits.push(item.readingTime);
        if (format) metaBits.push(format);

        const metaRow = metaBits.length
          ? `<p class="small resource-meta-row">${escapeHtml(metaBits.join(' • '))}</p>`
          : '';

        return `
          <article
            class="card resource-card clickable-card"
            data-card-link="${escapeHtml(item.url)}"
            role="link"
            tabindex="0"
            aria-label="Open resource: ${escapeHtml(item.title)}"
          >
            <img class="post-image resource-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.imageAlt || '')}" loading="lazy" decoding="async" />
            <p class="post-label">${escapeHtml(item.categoryLabel || '')}</p>
            ${metaRow}
            <h3 class="resource-title">${escapeHtml(item.title || '')}</h3>
            <p class="resource-summary">${escapeHtml(item.summary || '')}</p>
            <div class="resource-footer">
              <a class="resource-link" href="${escapeHtml(item.url)}">Open resource</a>
            </div>
          </article>
        `;
      })
      .join('');
  };

  const updateCount = (visibleCount, filteredCount) => {
    if (filteredCount === 0) {
      count.textContent = `Showing 0 of ${data.length}`;
      return;
    }

    if (filteredCount === data.length) {
      count.textContent = `Showing ${visibleCount} of ${filteredCount}`;
      return;
    }

    count.textContent = `Showing ${visibleCount} of ${filteredCount} (${data.length} total)`;
  };

  const render = ({ keepScroll = false } = {}) => {
    const previousY = window.scrollY;

    const filtered = sortData(data.filter(matchesFilters));
    const visible = filtered.slice(0, state.visibleCount);

    renderGrid(visible);
    renderActiveFilterChips();
    syncFilterControls();
    updateCount(visible.length, filtered.length);
    updateUrlState();

    if (totalBadge) {
      totalBadge.textContent = `${data.length} available`;
    }

    const hasResults = filtered.length > 0;
    grid.hidden = !hasResults;
    if (emptyState) {
      emptyState.hidden = hasResults;
    }

    if (loadMoreButton) {
      const remaining = filtered.length - visible.length;
      loadMoreButton.hidden = remaining <= 0;
      if (remaining > 0) {
        loadMoreButton.textContent = `Load more (${remaining} remaining)`;
      }
    }

    if (keepScroll) {
      window.scrollTo({ top: previousY, behavior: 'auto' });
    }
  };

  const clearAll = () => {
    state.searchTerm = '';
    state.selectedCategories.clear();
    state.selectedTags.clear();
    state.sort = defaultSort;
    state.visibleCount = PAGE_SIZE;
    render();
  };

  const handleCategoryToggle = (value) => {
    if (value === 'all') {
      state.selectedCategories.clear();
    } else if (state.selectedCategories.has(value)) {
      state.selectedCategories.delete(value);
    } else {
      state.selectedCategories.add(value);
    }

    state.visibleCount = PAGE_SIZE;
    render();
  };

  const handleTagToggle = (value) => {
    if (state.selectedTags.has(value)) {
      state.selectedTags.delete(value);
    } else {
      state.selectedTags.add(value);
    }

    state.visibleCount = PAGE_SIZE;
    render();
  };

  quickFilterWrap.addEventListener('click', (event) => {
    const button = event.target.closest('[data-resource-filter]');
    if (!button) return;
    const value = button.getAttribute('data-resource-filter') || 'all';
    handleCategoryToggle(value);
  });

  if (categoryList) {
    categoryList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-resource-filter]');
      if (!button) return;
      const value = button.getAttribute('data-resource-filter') || 'all';
      handleCategoryToggle(value);
    });
  }

  if (secondaryList) {
    secondaryList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-resource-tag]');
      if (!button) return;
      const value = button.getAttribute('data-resource-tag') || '';
      if (!value) return;
      handleTagToggle(value);
    });
  }

  if (secondaryPills) {
    secondaryPills.addEventListener('click', (event) => {
      const button = event.target.closest('[data-resource-tag]');
      if (!button) return;
      const value = button.getAttribute('data-resource-tag') || '';
      if (!value) return;
      handleTagToggle(value);
    });
  }

  sortControls.forEach((select) => {
    select.addEventListener('change', () => {
      const nextSort = select.value;
      if (!sortLabelMap.has(nextSort)) return;
      state.sort = nextSort;
      state.visibleCount = PAGE_SIZE;
      render();
    });
  });

  search.addEventListener('input', () => {
    state.searchTerm = search.value.trim();
    state.visibleCount = PAGE_SIZE;
    render();
  });

  clearAllButtons.forEach((button) => {
    button.addEventListener('click', () => {
      clearAll();
    });
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const preset = button.getAttribute('data-resource-preset') || '';
      state.selectedTags.clear();
      state.sort = defaultSort;

      if (preset === 'templates') {
        state.searchTerm = '';
        state.selectedCategories = new Set(['templates']);
      } else if (preset === 'governance') {
        state.searchTerm = 'governance';
        state.selectedCategories.clear();
      } else if (preset === 'rollout') {
        state.searchTerm = 'rollout';
        state.selectedCategories.clear();
      }

      state.visibleCount = PAGE_SIZE;
      render();
    });
  });

  if (activeChips) {
    activeChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-kind]');
      if (!button) return;

      const kind = button.getAttribute('data-remove-kind') || '';
      const value = button.getAttribute('data-remove-value') || '';

      if (kind === 'search') {
        state.searchTerm = '';
      } else if (kind === 'category' && value) {
        state.selectedCategories.delete(value);
      } else if (kind === 'tag' && value) {
        state.selectedTags.delete(value);
      } else if (kind === 'sort') {
        state.sort = defaultSort;
      }

      state.visibleCount = PAGE_SIZE;
      render();
    });
  }

  if (loadMoreButton) {
    loadMoreButton.addEventListener('click', () => {
      state.visibleCount += PAGE_SIZE;
      render({ keepScroll: true });
      loadMoreButton.focus({ preventScroll: true });
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;

    if (event.key === '/' && !isInputLike(event.target)) {
      event.preventDefault();
      search.focus();
      search.select();
      return;
    }

    if (event.key !== 'Escape') return;

    if (document.body.classList.contains('resources-filters-open')) {
      closeDrawer();
      return;
    }

    const hadSearch = state.searchTerm.length > 0;
    if (hadSearch) {
      state.searchTerm = '';
      state.visibleCount = PAGE_SIZE;
      render();
      focusGrid();
      return;
    }

    if (document.activeElement === search) {
      focusGrid();
    }
  });

  if (openFiltersButton) {
    openFiltersButton.addEventListener('click', () => {
      if (mobileQuery.matches) {
        setDrawerOpen(true);
        return;
      }

      if (layout?.classList.contains('sidebar-collapsed')) {
        layout.classList.remove('sidebar-collapsed');
        updateSidebarToggleLabel();
        return;
      }

      sidebar?.focus({ preventScroll: true });
    });
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      if (mobileQuery.matches) {
        closeDrawer();
        return;
      }

      layout?.classList.toggle('sidebar-collapsed');
      updateSidebarToggleLabel();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeDrawer();
    });
  }

  mobileQuery.addEventListener('change', () => {
    if (!mobileQuery.matches) {
      closeDrawer();
    }
    updateSidebarToggleLabel();
  });

  applyUrlState();
  updateSidebarToggleLabel();
  render();
})();
