(() => {
  const grid = document.getElementById('support-grid');
  const count = document.getElementById('support-count');
  const search = document.getElementById('support-search');
  const productFilter = document.getElementById('support-product');
  const sortControl = document.getElementById('support-sort');
  const activeChips = document.getElementById('support-active-chips');
  const emptyState = document.getElementById('support-empty-state');
  const tagWrap = document.querySelector('.kb-tags');
  const clearAllButtons = Array.from(document.querySelectorAll('[data-support-clear-all]'));
  const presetButtons = Array.from(document.querySelectorAll('[data-support-preset]'));

  const stepCards = Array.from(document.querySelectorAll('.support-step-card[data-step-target]'));
  const stepIndicator = document.getElementById('support-step-indicator');
  const knowledgeSection = document.getElementById('knowledge-base');
  const contactSection = document.getElementById('support-contact');
  const consultSection = document.getElementById('support-consult');
  const contactNameField = document.getElementById('support-contact-name');
  const consultPrimaryCta = consultSection?.querySelector('a.btn.btn-primary') || null;

  const contactForm = document.getElementById('support-contact-form');
  const formSuccess = document.getElementById('support-form-success');

  const data = window.JOYFUL_SUPPORT_ARTICLES || [];

  if (!grid || !count || !search || !productFilter || !sortControl || !tagWrap || !knowledgeSection) return;

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  const knownProducts = new Set(['all', 'assets', 'insights', 'agent', 'general']);

  const productLabelMap = {
    assets: 'NyLi Assets',
    insights: 'NyLi Insights',
    agent: 'NyLi Agent',
    general: 'General',
  };

  const humanizeTag = (tag) =>
    String(tag || '')
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const normalize = (value) => String(value || '').trim().toLowerCase();

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

  const articleId = (item) => `support-article-${item.id}`;
  const articleUrl = (item) => (item.url ? item.url : `#${articleId(item)}`);

  const availableTags = Array.from(
    new Set(
      data
        .flatMap((item) => (Array.isArray(item.tags) ? item.tags : []))
        .map((tag) => normalize(tag))
        .filter(Boolean),
    ),
  );

  const existingTagButtons = Array.from(tagWrap.querySelectorAll('[data-support-tag]'));
  const existingTagValues = new Set(
    existingTagButtons
      .map((button) => normalize(button.getAttribute('data-support-tag')))
      .filter((value) => value && value !== 'all'),
  );

  availableTags.forEach((tag) => {
    if (existingTagValues.has(tag)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kb-tag';
    button.setAttribute('data-support-tag', tag);
    button.setAttribute('aria-pressed', 'false');
    button.textContent = humanizeTag(tag);
    tagWrap.appendChild(button);
  });

  const tagButtons = () => Array.from(tagWrap.querySelectorAll('[data-support-tag]'));
  const hasReliableDates = data.length > 0 && data.every((item) => item.date && !Number.isNaN(Date.parse(item.date)));

  const state = {
    searchTerm: '',
    selectedTags: new Set(),
    product: 'all',
    sort: 'az',
    activeStep: 'knowledge',
  };

  const defaultSort = () => (state.searchTerm ? 'relevance' : 'az');

  const scrollIntoView = (target) => {
    if (!target) return;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const focusWithDelay = (element) => {
    if (!element) return;
    window.setTimeout(
      () => {
        if (typeof element.matches === 'function' && !element.matches('a, button, input, select, textarea, [tabindex]')) {
          element.setAttribute('tabindex', '-1');
        }
        element.focus({ preventScroll: true });
      },
      prefersReducedMotion ? 60 : 360,
    );
  };

  const parseCsv = (value) =>
    String(value || '')
      .split(',')
      .map((item) => normalize(item))
      .filter(Boolean);

  const updateSortOptions = () => {
    const options = [];
    if (state.searchTerm) {
      options.push({ value: 'relevance', label: 'Relevance' });
    }
    options.push({ value: 'az', label: 'A to Z' });
    options.push({ value: 'product', label: 'Product grouped' });
    if (hasReliableDates) {
      options.push({ value: 'newest', label: 'Newest first' });
    }

    sortControl.innerHTML = options.map((option) => `<option value="${option.value}">${option.label}</option>`).join('');
    const optionValues = new Set(options.map((option) => option.value));
    if (!optionValues.has(state.sort)) {
      state.sort = defaultSort();
    }
    sortControl.value = state.sort;
    return optionValues;
  };

  const updateUrlState = () => {
    const params = new URLSearchParams();
    if (state.searchTerm) {
      params.set('q', state.searchTerm);
    }
    if (state.selectedTags.size) {
      params.set('tags', Array.from(state.selectedTags).join(','));
    }
    if (state.product !== 'all') {
      params.set('product', state.product);
    }
    if (state.sort !== defaultSort()) {
      params.set('sort', state.sort);
    }

    const query = params.toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    history.replaceState(null, '', next);
  };

  const applyUrlState = () => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const tagCsv = params.get('tags');
    const product = normalize(params.get('product'));
    const sort = normalize(params.get('sort'));

    if (q) {
      state.searchTerm = q.trim();
    }

    if (tagCsv) {
      parseCsv(tagCsv).forEach((tag) => {
        if (availableTags.includes(tag)) {
          state.selectedTags.add(tag);
        }
      });
    }

    if (knownProducts.has(product)) {
      state.product = product;
    }

    const optionValues = updateSortOptions();
    if (sort && optionValues.has(sort)) {
      state.sort = sort;
    } else {
      state.sort = defaultSort();
    }
  };

  const syncControls = () => {
    search.value = state.searchTerm;
    productFilter.value = state.product;

    tagButtons().forEach((button) => {
      const value = normalize(button.getAttribute('data-support-tag'));
      const active = value === 'all' ? state.selectedTags.size === 0 : state.selectedTags.has(value);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const scoreRelevance = (item, terms) => {
    const title = normalize(item.title);
    const summary = normalize(item.summary);
    const product = normalize(productLabelMap[item.product] || item.product);
    const tags = Array.isArray(item.tags) ? item.tags.map((tag) => normalize(tag)) : [];

    let score = 0;
    terms.forEach((term) => {
      if (!term) return;
      if (title.includes(term)) score += 6;
      if (summary.includes(term)) score += 3;
      if (product.includes(term)) score += 2;
      if (tags.some((tag) => tag.includes(term))) score += 4;
    });
    return score;
  };

  const matchesFilters = (item, terms) => {
    const productMatch = state.product === 'all' || item.product === state.product;

    const itemTags = Array.isArray(item.tags) ? item.tags.map((tag) => normalize(tag)).filter(Boolean) : [];
    const tagMatch = state.selectedTags.size === 0 || itemTags.some((tag) => state.selectedTags.has(tag));

    const haystack = `${item.title || ''} ${item.summary || ''} ${(itemTags || []).join(' ')} ${productLabelMap[item.product] || item.product || ''}`.toLowerCase();
    const searchMatch = terms.length === 0 || terms.every((term) => haystack.includes(term));

    return productMatch && tagMatch && searchMatch;
  };

  const sortArticles = (items, terms) => {
    const sorted = [...items];

    if (state.sort === 'newest' && hasReliableDates) {
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return sorted;
    }

    if (state.sort === 'product') {
      sorted.sort((a, b) => {
        const productA = productLabelMap[a.product] || a.product || '';
        const productB = productLabelMap[b.product] || b.product || '';
        const cmp = collator.compare(productA, productB);
        if (cmp !== 0) return cmp;
        return collator.compare(a.title || '', b.title || '');
      });
      return sorted;
    }

    if (state.sort === 'relevance' && terms.length) {
      sorted.sort((a, b) => {
        const scoreDelta = scoreRelevance(b, terms) - scoreRelevance(a, terms);
        if (scoreDelta !== 0) return scoreDelta;
        return collator.compare(a.title || '', b.title || '');
      });
      return sorted;
    }

    sorted.sort((a, b) => collator.compare(a.title || '', b.title || ''));
    return sorted;
  };

  const renderActiveChips = () => {
    if (!activeChips) return;
    const chips = [];

    if (state.searchTerm) {
      chips.push(
        `<button class="chip" type="button" data-remove-kind="search" aria-label="Remove search filter">Search: ${escapeHtml(state.searchTerm)} x</button>`,
      );
    }

    if (state.product !== 'all') {
      const label = productLabelMap[state.product] || state.product;
      chips.push(
        `<button class="chip" type="button" data-remove-kind="product" aria-label="Remove product filter ${escapeHtml(label)}">Product: ${escapeHtml(label)} x</button>`,
      );
    }

    state.selectedTags.forEach((tag) => {
      chips.push(
        `<button class="chip" type="button" data-remove-kind="tag" data-remove-value="${escapeHtml(tag)}" aria-label="Remove tag filter ${escapeHtml(humanizeTag(tag))}">Tag: ${escapeHtml(humanizeTag(tag))} x</button>`,
      );
    });

    if (state.sort !== defaultSort()) {
      const sortLabelMap = {
        relevance: 'Relevance',
        az: 'A to Z',
        product: 'Product grouped',
        newest: 'Newest first',
      };
      chips.push(
        `<button class="chip" type="button" data-remove-kind="sort" aria-label="Reset sort option">Sort: ${escapeHtml(sortLabelMap[state.sort] || state.sort)} x</button>`,
      );
    }

    activeChips.innerHTML = chips.join('');
    activeChips.hidden = chips.length === 0;
  };

  const renderGrid = (items) => {
    grid.innerHTML = items
      .map((item) => {
        const normalizedTags = Array.isArray(item.tags) ? item.tags.map((tag) => normalize(tag)).filter(Boolean) : [];
        const visibleTags = normalizedTags.slice(0, 3);
        const overflow = normalizedTags.length - visibleTags.length;
        const tagsHtml = [
          ...visibleTags.map((tag) => `<span class="kb-inline-tag">${escapeHtml(humanizeTag(tag))}</span>`),
          ...(overflow > 0 ? [`<span class="kb-inline-tag">+${overflow}</span>`] : []),
        ].join('');

        const url = articleUrl(item);
        const copyUrl = new URL(url, window.location.href).toString();
        const label = productLabelMap[item.product] || 'General';

        return `
          <article
            id="${escapeHtml(articleId(item))}"
            class="card support-article-card clickable-card"
            data-card-link="${escapeHtml(url)}"
            role="link"
            tabindex="0"
            aria-label="Open article: ${escapeHtml(item.title)}"
          >
            <p class="post-label">${escapeHtml(label)}</p>
            <p class="support-article-tags" aria-label="Article tags">${tagsHtml}</p>
            <h3 class="support-article-title">${escapeHtml(item.title || '')}</h3>
            <p class="support-article-summary">${escapeHtml(item.summary || '')}</p>
            <div class="support-article-footer">
              <a class="resource-link" href="${escapeHtml(url)}">Open article</a>
              <button class="btn btn-quiet support-copy-link" type="button" data-copy-url="${escapeHtml(copyUrl)}">Copy link</button>
            </div>
          </article>
        `;
      })
      .join('');
  };

  const updateCount = (filteredCount) => {
    count.textContent = `Showing ${filteredCount} of ${data.length} articles`;
  };

  const render = () => {
    const terms = state.searchTerm
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    const allowedSorts = updateSortOptions();
    if (!allowedSorts.has(state.sort)) {
      state.sort = defaultSort();
    }

    const filtered = sortArticles(data.filter((item) => matchesFilters(item, terms)), terms);

    renderGrid(filtered);
    syncControls();
    renderActiveChips();
    updateCount(filtered.length);
    updateUrlState();

    const hasResults = filtered.length > 0;
    grid.hidden = !hasResults;
    if (emptyState) {
      emptyState.hidden = hasResults;
    }
  };

  const clearAll = () => {
    state.searchTerm = '';
    state.selectedTags.clear();
    state.product = 'all';
    state.sort = 'az';
    render();
  };

  const goToStep = (step) => {
    if (step === 'knowledge') {
      scrollIntoView(knowledgeSection);
      focusWithDelay(search);
      return;
    }

    if (step === 'contact') {
      if (contactSection) {
        scrollIntoView(contactSection);
        focusWithDelay(contactNameField || contactSection);
        return;
      }
      window.location.href = '/contact?interest=Other';
      return;
    }

    if (step === 'consult') {
      if (consultSection) {
        scrollIntoView(consultSection);
        focusWithDelay(consultPrimaryCta || consultSection);
        return;
      }
      window.location.href = '/contact?interest=Services';
    }
  };

  const setActiveStep = (step) => {
    state.activeStep = step;
    stepCards.forEach((card) => {
      const isActive = card.getAttribute('data-step-target') === step;
      card.classList.toggle('is-active', isActive);
      if (isActive) {
        card.setAttribute('aria-current', 'step');
      } else {
        card.removeAttribute('aria-current');
      }
    });

    if (!stepIndicator) return;
    const labels = {
      knowledge: 'Current step: Step 1',
      contact: 'Current step: Step 2',
      consult: 'Current step: Step 3',
    };
    stepIndicator.textContent = labels[step] || labels.knowledge;
  };

  const observeStepSections = () => {
    const stepSections = [
      { section: knowledgeSection, step: 'knowledge' },
      { section: contactSection, step: 'contact' },
      { section: consultSection, step: 'consult' },
    ].filter((item) => item.section);

    if (!stepSections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible[0]) return;
        const hit = stepSections.find((item) => item.section === visible[0].target);
        if (hit) {
          setActiveStep(hit.step);
        }
      },
      {
        rootMargin: '-34% 0px -48% 0px',
        threshold: [0.2, 0.4, 0.6],
      },
    );

    stepSections.forEach((item) => observer.observe(item.section));
  };

  const copyText = async (value) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const temp = document.createElement('textarea');
    temp.value = value;
    temp.setAttribute('readonly', 'true');
    temp.style.position = 'absolute';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.select();

    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(temp);
    }
  };

  applyUrlState();
  setActiveStep('knowledge');
  observeStepSections();
  render();

  stepCards.forEach((card) => {
    const target = card.getAttribute('data-step-target') || '';
    card.addEventListener('click', () => {
      goToStep(target);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      goToStep(target);
    });
  });

  tagWrap.addEventListener('click', (event) => {
    const button = event.target.closest('[data-support-tag]');
    if (!button) return;

    const value = normalize(button.getAttribute('data-support-tag'));
    if (!value || value === 'all') {
      state.selectedTags.clear();
    } else if (state.selectedTags.has(value)) {
      state.selectedTags.delete(value);
    } else {
      state.selectedTags.add(value);
    }

    render();
  });

  productFilter.addEventListener('change', () => {
    state.product = knownProducts.has(productFilter.value) ? productFilter.value : 'all';
    render();
  });

  search.addEventListener('input', () => {
    state.searchTerm = search.value.trim();
    if (!state.searchTerm && state.sort === 'relevance') {
      state.sort = 'az';
    }
    render();
  });

  sortControl.addEventListener('change', () => {
    state.sort = sortControl.value;
    render();
  });

  clearAllButtons.forEach((button) => {
    button.addEventListener('click', () => {
      clearAll();
    });
  });

  const presetMap = {
    setup: ['setup'],
    troubleshooting: ['troubleshooting'],
    workflows: ['workflows'],
    governance: ['governance'],
    'access-security': ['access', 'security'],
  };

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-support-preset') || '';
      const mappedTags = (presetMap[key] || []).filter((tag) => availableTags.includes(tag));
      state.selectedTags = new Set(mappedTags);
      state.searchTerm = '';
      state.product = 'all';
      state.sort = 'az';
      render();
      scrollIntoView(knowledgeSection);
      window.setTimeout(
        () => {
          focusGrid();
        },
        prefersReducedMotion ? 60 : 360,
      );
    });
  });

  if (activeChips) {
    activeChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-kind]');
      if (!button) return;

      const kind = button.getAttribute('data-remove-kind') || '';
      const value = normalize(button.getAttribute('data-remove-value'));
      if (kind === 'search') {
        state.searchTerm = '';
      } else if (kind === 'product') {
        state.product = 'all';
      } else if (kind === 'tag' && value) {
        state.selectedTags.delete(value);
      } else if (kind === 'sort') {
        state.sort = defaultSort();
      }
      render();
    });
  }

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy-url]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const copyUrl = button.getAttribute('data-copy-url') || '';
    if (!copyUrl) return;

    const original = button.textContent || 'Copy link';
    const ok = await copyText(copyUrl);
    button.textContent = ok ? 'Copied' : 'Copy failed';
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;

    if (event.key === '/' && !isInputLike(event.target)) {
      event.preventDefault();
      search.focus();
      search.select();
      return;
    }

    if (event.key !== 'Escape') return;

    if (state.searchTerm) {
      state.searchTerm = '';
      render();
      focusGrid();
      return;
    }

    if (document.activeElement === search) {
      focusGrid();
    }
  });

  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;

      if (formSuccess) {
        formSuccess.hidden = false;
        if (!formSuccess.hasAttribute('tabindex')) {
          formSuccess.setAttribute('tabindex', '-1');
        }
        focusWithDelay(formSuccess);
      }
      contactForm.reset();
    });
  }
})();
