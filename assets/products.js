(() => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  const isInteractiveElement = (element) => {
    if (!element) return false;
    return Boolean(element.closest('a, button, input, select, textarea, summary, details, label'));
  };

  const flashTarget = (element) => {
    if (!element) return;
    element.classList.add('nav-flash');
    window.setTimeout(() => {
      element.classList.remove('nav-flash');
    }, prefersReducedMotion ? 600 : 1400);
  };

  const flashWhenVisible = (section) => {
    if (!section) return;

    const target = section.querySelector('.product-row') || section;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((item) => item.isIntersecting);
        if (!entry) return;
        observer.disconnect();
        flashTarget(target);
      },
      { threshold: 0.6 }
    );

    observer.observe(section);
  };

  const focusSection = (section) => {
    const focusTarget = section.querySelector('h2, h3') || section;
    if (!focusTarget.hasAttribute('tabindex')) {
      focusTarget.setAttribute('tabindex', '-1');
    }
    focusTarget.focus({ preventScroll: true });
  };

  const scrollToSection = (hash, { updateUrl } = { updateUrl: true }) => {
    if (!hash || !hash.startsWith('#')) return;
    const section = document.querySelector(hash);
    if (!section) return;

    section.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });

    flashWhenVisible(section);
    focusSection(section);

    if (updateUrl) {
      history.pushState(null, '', hash);
    }
  };

  const enhancedScrollLinks = document.querySelectorAll(
    '.path-selector a[href^=\"#\"], .products-mini-nav a[href^=\"#\"], #how-to-choose a[href^=\"#\"]'
  );

  enhancedScrollLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const hash = link.getAttribute('href');
      if (!hash || !hash.startsWith('#')) return;
      const target = document.querySelector(hash);
      if (!target) return;

      event.preventDefault();
      scrollToSection(hash);
    });
  });

  const nav = document.querySelector('.products-mini-nav');
  const sectionIds = ['overview', 'nli-assets', 'nli-insights', 'nli-agent', 'next-step'];
  const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
  const navLinks = new Map();

  if (nav) {
    nav.querySelectorAll('a[href^=\"#\"]').forEach((link) => {
      const hash = link.getAttribute('href') || '';
      const id = hash.replace('#', '');
      if (id) navLinks.set(id, link);
    });

    const setActive = (id) => {
      const resolved = navLinks.has(id) ? id : 'overview';
      navLinks.forEach((link, key) => {
        if (key === resolved) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible[0]) return;
        setActive(visible[0].target.id);
      },
      {
        rootMargin: '-35% 0px -55% 0px',
        threshold: [0.15, 0.3, 0.6],
      }
    );

    sections.forEach((section) => observer.observe(section));

    window.addEventListener('hashchange', () => {
      const id = (window.location.hash || '').replace('#', '');
      if (id) setActive(id);
    });

    const initialActive = (window.location.hash || '').replace('#', '') || 'overview';
    setActive(initialActive);
  }

  const rows = document.querySelectorAll('.product-row[data-href]');
  rows.forEach((row) => {
    const href = row.getAttribute('data-href');
    if (!href) return;

    row.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (isInteractiveElement(event.target)) return;
      window.location.href = href;
    });

    row.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (isInteractiveElement(event.target)) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      window.location.href = href;
    });
  });

  if (window.location.hash) {
    const section = document.querySelector(window.location.hash);
    if (section) {
      flashWhenVisible(section);
    }
  }
})();
