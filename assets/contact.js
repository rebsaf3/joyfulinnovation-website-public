(() => {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const status = document.getElementById('contact-status');
  const success = document.getElementById('contact-success');
  const interestField = document.getElementById('contact-interest');
  const endpoint = (window.JOYFUL_SITE_CONFIG && window.JOYFUL_SITE_CONFIG.contactForm && window.JOYFUL_SITE_CONFIG.contactForm.endpoint) || '';

  const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter((el) => el.name && el.type !== 'hidden');

  function showStatus(message, type) {
    if (!status) return;
    status.textContent = message;
    status.className = `form-status ${type}`;
  }

  function clearValidation() {
    fields.forEach((field) => {
      field.setAttribute('aria-invalid', 'false');
      const error = form.querySelector(`[data-error-for="${field.id}"]`);
      if (error) {
        error.textContent = '';
      }
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const requestedInterest = urlParams.get('interest');
  const requestedIntent = urlParams.get('intent');
  if (interestField && requestedInterest) {
    const option = Array.from(interestField.options).find((item) => item.value.toLowerCase() === requestedInterest.toLowerCase());
    if (option) {
      interestField.value = option.value;
    }
  } else if (interestField && requestedIntent && requestedIntent.toLowerCase() === 'demo') {
    const demoOption = Array.from(interestField.options).find((item) => item.value.toLowerCase() === 'request a demo');
    if (demoOption) {
      interestField.value = demoOption.value;
    }
  }

  function validateField(field) {
    const error = form.querySelector(`[data-error-for="${field.id}"]`);
    if (field.checkValidity()) {
      field.setAttribute('aria-invalid', 'false');
      if (error) error.textContent = '';
      return true;
    }

    field.setAttribute('aria-invalid', 'true');
    if (error) {
      if (field.validity.valueMissing) {
        error.textContent = 'This field is required.';
      } else if (field.validity.typeMismatch) {
        error.textContent = 'Enter a valid value.';
      } else {
        error.textContent = 'Please review this field.';
      }
    }
    return false;
  }

  fields.forEach((field) => {
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
    if (success) {
      success.hidden = true;
    }

    const honeypot = form.querySelector('input[name="company_website"]');
    if (honeypot && honeypot.value.trim() !== '') {
      showStatus('Thanks. Your request has been received.', 'success');
      form.reset();
      return;
    }

    let valid = true;
    fields.forEach((field) => {
      if (!validateField(field)) {
        valid = false;
      }
    });

    if (!valid) {
      showStatus('Please fix the highlighted fields and resubmit.', 'error');
      return;
    }

    if (!endpoint) {
      showStatus('Form endpoint is not configured. Set JOYFUL_SITE_CONFIG.contactForm.endpoint in /assets/site-config.js.', 'error');
      return;
    }

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
      showStatus('Thanks. We received your request.', 'success');
      if (success) {
        success.hidden = false;
      }
    } catch (error) {
      showStatus('We could not submit the form right now. Please try again or use the Request a Demo buttons.', 'error');
    }
  });
})();
