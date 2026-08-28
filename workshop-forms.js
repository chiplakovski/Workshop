(function () {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), select, textarea) {
      min-height: 40px;
      border-radius: 0;
      transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease;
    }
    :where(input, select, textarea):hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--spark, var(--blue, #4a90ff)) 62%, var(--field-line, #789) 38%);
    }
    :where(input, select, textarea):focus-visible {
      outline: 0;
      border-color: var(--spark, var(--blue, #4a90ff)) !important;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--spark, var(--blue, #4a90ff)) 20%, transparent);
    }
    :where(input, select, textarea):user-invalid {
      border-color: var(--danger, var(--red, #ff6b6b)) !important;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger, var(--red, #ff6b6b)) 16%, transparent);
    }
    :where(input, select, textarea):disabled { opacity: .55; cursor: not-allowed; }
    textarea { min-height: 96px; resize: vertical; line-height: 1.45; }
    input[type="checkbox"], input[type="radio"] { accent-color: var(--spark, var(--blue, #4a90ff)); }
    :where(.frow, .field, .row, .form-field) > label { display: block; }
    :where(.fbtns, .modal-actions, .actions, .save) { align-items: center; }
    :where(.fbtns, .modal-actions, .actions, .save) button { min-height: 40px; }
    :where(.modal, #fov)[aria-hidden="true"] { display: none; }
    @media (prefers-reduced-motion: reduce) {
      :where(input, select, textarea) { transition: none; }
    }
  `;
  document.head.appendChild(style);

  function enhance() {
    document.querySelectorAll('input, select, textarea').forEach(control => {
      if (control.type !== 'hidden' && control.type !== 'range' && control.type !== 'file') {
        control.classList.add('workshop-form-control');
      }
      if (control.matches('input[type="email"]')) control.autocomplete ||= 'email';
      if (control.matches('input[type="tel"]')) control.autocomplete ||= 'tel';
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const openModal = document.querySelector('.modal.show, #fov.show');
      const close = openModal?.querySelector('[data-close], .modal-actions button[type="button"], .fbtns .tbtn');
      if (close) close.click();
    }

    if (event.key !== 'Enter' || event.target.matches('textarea, select, button')) return;
    const modal = event.target.closest('.modal.show, #fov.show');
    if (!modal || modal.querySelector('textarea:focus')) return;
    const primary = modal.querySelector('.primary[type="submit"], .primary:not([type="button"]), .fbtns .primary, .modal-actions .primary');
    if (primary) {
      event.preventDefault();
      primary.click();
    }
  });

  document.addEventListener('DOMContentLoaded', enhance);
  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
})();
