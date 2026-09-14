// Client-side JavaScript

// SweetAlert confirmation handler
// Usage: Add data-confirm="Your message here" to any form
// Optional: data-confirm-title="Title" data-confirm-icon="warning"
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('form[data-confirm]').forEach(function(form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const message = form.getAttribute('data-confirm');
      const title = form.getAttribute('data-confirm-title') || 'Are you sure?';
      const icon = form.getAttribute('data-confirm-icon') || 'warning';
      const confirmText = form.getAttribute('data-confirm-btn') || 'Yes, proceed';
      const isDestructive = form.getAttribute('data-confirm-danger') === 'true';

      Swal.fire({
        title: title,
        text: message,
        icon: icon,
        showCancelButton: true,
        confirmButtonColor: isDestructive ? '#dc3545' : '#3085d6',
        cancelButtonColor: '#6c757d',
        confirmButtonText: confirmText,
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(function(result) {
        if (result.isConfirmed) {
          // Disable submit button to prevent double-click
          const btn = form.querySelector('[type="submit"]');
          if (btn) btn.disabled = true;
          form.removeEventListener('submit', arguments.callee);
          form.submit();
        }
      });
    });
  });

  // Also handle buttons/links with data-confirm (non-form elements)
  document.querySelectorAll('button[data-confirm]:not(form [data-confirm]), a[data-confirm]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.preventDefault();
      const message = el.getAttribute('data-confirm');
      const title = el.getAttribute('data-confirm-title') || 'Are you sure?';
      const icon = el.getAttribute('data-confirm-icon') || 'warning';
      const confirmText = el.getAttribute('data-confirm-btn') || 'Yes, proceed';
      const isDestructive = el.getAttribute('data-confirm-danger') === 'true';

      Swal.fire({
        title: title,
        text: message,
        icon: icon,
        showCancelButton: true,
        confirmButtonColor: isDestructive ? '#dc3545' : '#3085d6',
        cancelButtonColor: '#6c757d',
        confirmButtonText: confirmText,
        cancelButtonText: 'Cancel',
        reverseButtons: true
      }).then(function(result) {
        if (result.isConfirmed) {
          if (el.tagName === 'A') {
            window.location.href = el.href;
          }
        }
      });
    });
  });
});
