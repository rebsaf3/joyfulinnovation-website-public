(() => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.site-nav');
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('#primary-nav');

  const closeNav = () => {
    if (!nav || !navToggle) return;
    nav.setAttribute('data-open', 'false');
    navToggle.setAttribute('aria-expanded', 'false');
  };

  const syncHeaderOffset = () => {
    if (!header) return;
    document.documentElement.style.setProperty('--header-offset', `${header.offsetHeight}px`);
  };

  const updateHeaderState = () => {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 10);
    syncHeaderOffset();
  };

  if (nav && navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!isOpen));
      navToggle.setAttribute('aria-expanded', String(!isOpen));
    });

    navLinks.querySelectorAll('a[href]').forEach((link) => {
      link.addEventListener('click', () => {
        closeNav();
      });
    });

    document.addEventListener('click', (event) => {
      if (!nav.contains(event.target)) {
        closeNav();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeNav();
      }
    });
  }

  window.addEventListener('scroll', updateHeaderState, { passive: true });
  window.addEventListener('resize', syncHeaderOffset);
  updateHeaderState();

  const toPathname = (href) => {
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return '';

    try {
      const url = new URL(href, window.location.origin);
      return url.pathname.replace(/\/$/, '') || '/';
    } catch {
      return '';
    }
  };

  const pathname = window.location.pathname.replace(/\/$/, '') || '/';
  const navAnchors = document.querySelectorAll('#primary-nav a[href]:not(.btn)');
  navAnchors.forEach((link) => {
    const href = toPathname(link.getAttribute('href') || '');
    if (!href) return;

    if (href === pathname || (href !== '/' && pathname.startsWith(href))) {
      link.setAttribute('aria-current', 'page');
    }
  });

  const yearTarget = document.getElementById('footer-year');
  if (yearTarget) {
    yearTarget.textContent = String(new Date().getFullYear());
  }

  const images = document.querySelectorAll('img:not([loading])');
  images.forEach((img, index) => {
    if (index > 1) {
      img.loading = 'lazy';
      img.decoding = 'async';
    }
  });

  const isInteractiveElement = (element) => {
    if (!element) return false;
    return Boolean(element.closest('a, button, input, select, textarea, summary, details, label'));
  };

  const flashTarget = (element) => {
    if (!element) return;
    element.classList.add('nav-flash');
    window.setTimeout(() => {
      element.classList.remove('nav-flash');
    }, prefersReducedMotion ? 700 : 1400);
  };

  const focusSection = (section) => {
    if (!section) return;

    const focusTarget = section.matches('h1, h2, h3, h4')
      ? section
      : section.querySelector('h2, h3, h4') || section;

    if (!focusTarget.hasAttribute('tabindex')) {
      focusTarget.setAttribute('tabindex', '-1');
    }

    focusTarget.focus({ preventScroll: true });
  };

  const scrollToHash = (hash, { updateUrl } = { updateUrl: true }) => {
    if (!hash || !hash.startsWith('#')) return;
    const target = document.querySelector(hash);
    if (!target) return;

    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });

    window.setTimeout(
      () => {
        flashTarget(target);
        focusSection(target);
      },
      prefersReducedMotion ? 80 : 420
    );

    if (updateUrl) {
      history.pushState(null, '', hash);
    }
  };

  const enhancedScrollLinks = document.querySelectorAll('[data-scroll-link], .home-section-nav a[href^="#"]');
  enhancedScrollLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const hash = link.getAttribute('href');
      if (!hash || !hash.startsWith('#')) return;
      const target = document.querySelector(hash);
      if (!target) return;

      event.preventDefault();
      scrollToHash(hash);
    });
  });

  const homeSectionNav = document.querySelector('.home-section-nav[data-track-sections]');
  if (homeSectionNav) {
    const sectionIds = (homeSectionNav.getAttribute('data-track-sections') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
    const navLinksById = new Map();

    homeSectionNav.querySelectorAll('a[href^="#"]').forEach((link) => {
      const id = (link.getAttribute('href') || '').replace('#', '');
      if (id) {
        navLinksById.set(id, link);
      }
    });

    const setActive = (id) => {
      const fallbackId = sectionIds[0] || '';
      const resolvedId = navLinksById.has(id) ? id : fallbackId;

      navLinksById.forEach((link, key) => {
        if (key === resolvedId) {
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
        rootMargin: '-36% 0px -50% 0px',
        threshold: [0.15, 0.3, 0.55],
      }
    );

    sections.forEach((section) => observer.observe(section));

    window.addEventListener('hashchange', () => {
      const id = (window.location.hash || '').replace('#', '');
      if (id) {
        setActive(id);
      }
    });

    const initialActive = (window.location.hash || '').replace('#', '') || sectionIds[0];
    setActive(initialActive);
  }

  if (window.location.hash) {
    const target = document.querySelector(window.location.hash);
    if (target) {
      window.setTimeout(() => {
        flashTarget(target);
      }, prefersReducedMotion ? 100 : 280);
    }
  }

  const clickableCards = document.querySelectorAll('[data-card-link]');
  clickableCards.forEach((card) => {
    const href = card.getAttribute('data-card-link');
    if (!href) return;

    card.addEventListener('click', (event) => {
      if (event.defaultPrevented || isInteractiveElement(event.target)) return;
      window.location.href = href;
    });

    card.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || isInteractiveElement(event.target)) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      window.location.href = href;
    });
  });
})();

