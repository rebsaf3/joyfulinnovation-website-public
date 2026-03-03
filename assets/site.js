(() => {
  const nav = document.querySelector('.site-nav');
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('#primary-nav');

  if (nav && navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!isOpen));
      navToggle.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', (event) => {
      if (!nav.contains(event.target)) {
        nav.setAttribute('data-open', 'false');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const pathname = window.location.pathname.replace(/\/$/, '') || '/';
  const navAnchors = document.querySelectorAll('#primary-nav a[href]');
  navAnchors.forEach((link) => {
    const href = (link.getAttribute('href') || '').replace(/\/$/, '') || '/';
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
})();