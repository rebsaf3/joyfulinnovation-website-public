(() => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const form = document.getElementById('contact-form');
  if (!form) return;

  const status = document.getElementById('contact-status');
  const success = document.getElementById('contact-success');
  const submitButton = document.getElementById('contact-submit');
  const startButton = document.querySelector('[data-contact-start]');
  const nameField = document.getElementById('contact-name');
  const emailField = document.getElementById('contact-email');
  const interestField = document.getElementById('contact-interest');
  const interestGuidance = document.getElementById('contact-interest-guidance');
  const messageField = document.getElementById('contact-message');
  const endpoint = (window.JOYFUL_SITE_CONFIG && window.JOYFUL_SITE_CONFIG.contactForm && window.JOYFUL_SITE_CONFIG.contactForm.endpoint) || '';
  const submitLabel = submitButton ? submitButton.textContent : 'Submit request';
  const formReadyAt = Date.now();
  const minSubmitDelayMs = 1200;

  const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter(
    (el) => el.name && el.type !== 'hidden' && el.name !== 'company_website'
  );
  const validationFields = fields.filter((field) => field.required || field === emailField);
  const interestGuidanceByValue = {
    'Request a demo': 'For demo requests, include products of interest and approximate team size.',
    Services: 'For implementation planning, include systems involved and your timeline.',
    'NyLi Assets': 'For NyLi Assets, include key repositories or asset types and intended users.',
    'NyLi Insights': 'For NyLi Insights, include current reporting workflow and decision needs.',
    'NyLi Agent': 'For NyLi Agent, include target use cases and governance expectations.',
    Partnerships: 'For partnerships, include partnership type and goals.',
    Other: 'For other requests, include your goal, timeline, and primary stakeholders.',
  };

  const normalize = (value) => (value || '').trim().toLowerCase();

  function showStatus(message, type) {
    if (!status) return;
    status.textContent = message;
    status.className = 'form-status';
    if (type) {
      status.classList.add(type);
    }
  }

  function setSubmitting(isSubmitting) {
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.setAttribute('aria-busy', String(isSubmitting));
    submitButton.textContent = isSubmitting ? 'Submitting...' : submitLabel;
  }

  function scrollToFormAndFocus(targetField = nameField) {
    form.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });

    window.setTimeout(
      () => {
        if (targetField && typeof targetField.focus === 'function') {
          targetField.focus({ preventScroll: true });
        }
      },
      prefersReducedMotion ? 80 : 420
    );
  }

  function clearValidation() {
    validationFields.forEach((field) => {
      field.setAttribute('aria-invalid', 'false');
      const error = form.querySelector(`[data-error-for="${field.id}"]`);
      if (error) {
        error.textContent = '';
      }
    });
  }

  function updateInterestGuidance() {
    if (!interestGuidance || !interestField) return;
    const value = interestField.value;
    interestGuidance.textContent =
      interestGuidanceByValue[value] || 'Select an interest to see the most helpful details to include.';
  }

  function resolveRequestedInterest(rawValue) {
    if (!interestField || !rawValue) return '';
    const normalized = normalize(rawValue).replace(/[_-]+/g, ' ');
    const options = Array.from(interestField.options).filter((option) => option.value);
    const directMatch = options.find((option) => normalize(option.value) === normalized);
    if (directMatch) return directMatch.value;

    const aliases = {
      demo: 'Request a demo',
      'request a demo': 'Request a demo',
      implementation: 'Services',
      'implementation planning': 'Services',
      service: 'Services',
      services: 'Services',
      assets: 'NyLi Assets',
      'nyli assets': 'NyLi Assets',
      insights: 'NyLi Insights',
      'nyli insights': 'NyLi Insights',
      agent: 'NyLi Agent',
      'nyli agent': 'NyLi Agent',
      partnership: 'Partnerships',
      partnerships: 'Partnerships',
      other: 'Other',
    };

    const alias = aliases[normalized];
    if (!alias) return '';
    return options.some((option) => option.value === alias) ? alias : '';
  }

  const urlParams = new URLSearchParams(window.location.search);
  const requestedInterest = urlParams.get('interest');
  const requestedIntent = urlParams.get('intent');
  const requestedMessage = urlParams.get('message');

  let shouldScrollToFormOnLoad = false;
  if (interestField) {
    const resolvedInterest =
      resolveRequestedInterest(requestedInterest) || (normalize(requestedIntent) === 'demo' ? resolveRequestedInterest('demo') : '');
    if (resolvedInterest) {
      interestField.value = resolvedInterest;
      shouldScrollToFormOnLoad = true;
    }
  }

  if (messageField && requestedMessage) {
    messageField.value = requestedMessage.trim();
    shouldScrollToFormOnLoad = true;
  }

  if (shouldScrollToFormOnLoad) {
    window.setTimeout(() => {
      scrollToFormAndFocus();
    }, 80);
  }

  function validateField(field) {
    const error = form.querySelector(`[data-error-for="${field.id}"]`);

    let message = '';
    if (field === nameField && !field.value.trim()) {
      message = 'Enter your name.';
    } else if (field === emailField) {
      const emailValue = field.value.trim();
      if (!emailValue) {
        message = 'Enter your work email.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        message = 'Enter a valid work email in the format name@company.com.';
      }
    } else if (field === messageField && !field.value.trim()) {
      message = 'Enter a message with your request details.';
    } else if (!field.checkValidity()) {
      if (field.validity.valueMissing) {
        message = 'This field is required.';
      } else if (field.validity.typeMismatch) {
        message = 'Enter a valid value.';
      } else {
        message = 'Please review this field.';
      }
    }

    if (!message) {
      field.setAttribute('aria-invalid', 'false');
      if (error) error.textContent = '';
      return true;
    }

    field.setAttribute('aria-invalid', 'true');
    if (error) {
      error.textContent = message;
    }
    return false;
  }

  if (startButton) {
    startButton.addEventListener('click', (event) => {
      event.preventDefault();
      scrollToFormAndFocus();
    });
  }

  if (interestField) {
    interestField.addEventListener('change', () => {
      updateInterestGuidance();
      if (interestField.getAttribute('aria-invalid') === 'true') {
        validateField(interestField);
      }
    });
  }

  updateInterestGuidance();

  validationFields.forEach((field) => {
    field.addEventListener('blur', () => validateField(field));
    field.addEventListener('input', () => {
      if (field.getAttribute('aria-invalid') === 'true') {
        validateField(field);
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearValidation();
    showStatus('', '');
    if (success) {
      success.hidden = true;
    }

    const honeypot = form.querySelector('input[name="company_website"]');
    if (honeypot && honeypot.value.trim() !== '') {
      showStatus('Thanks. Your request has been received.', 'success');
      form.reset();
      updateInterestGuidance();
      return;
    }

    if (Date.now() - formReadyAt < minSubmitDelayMs) {
      showStatus('Please wait a moment, then submit your request.', 'error');
      return;
    }

    let valid = true;
    let firstInvalidField = null;
    validationFields.forEach((field) => {
      if (!validateField(field)) {
        valid = false;
        if (!firstInvalidField) {
          firstInvalidField = field;
        }
      }
    });

    if (!valid) {
      showStatus('Please fix the highlighted fields and resubmit.', 'error');
      if (firstInvalidField) {
        firstInvalidField.focus();
      }
      return;
    }

    if (!endpoint) {
      showStatus('Contact submission is not configured here yet. Please use the live form endpoint before enabling this page.', 'error');
      return;
    }

    setSubmitting(true);

    try {
      const payload = new FormData(form);
      const response = await fetch(endpoint, {
        method: 'POST',
        body: payload,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Submission failed');
      }

      form.reset();
      updateInterestGuidance();
      showStatus('Thanks. Your request was submitted successfully.', 'success');
      if (success) {
        success.hidden = false;
        if (!success.hasAttribute('tabindex')) {
          success.setAttribute('tabindex', '-1');
        }
        success.focus({ preventScroll: true });
      }
    } catch (error) {
      showStatus('We could not submit the form right now. Your entries are still in place. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
})();
