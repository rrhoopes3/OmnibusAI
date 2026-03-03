/**
 * app.js - Client-side interactivity for OmnibusAI
 */

(function() {
  'use strict';

  // Title accordion toggle
  document.querySelectorAll('.title-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var expanded = this.getAttribute('aria-expanded') === 'true';
      var content = this.closest('.title-card').querySelector('.title-content');

      this.setAttribute('aria-expanded', !expanded);
      if (expanded) {
        content.setAttribute('hidden', '');
      } else {
        content.removeAttribute('hidden');
      }
    });
  });

  // Expand all / collapse all (if future feature)
  // Smooth scroll to division anchors
  if (window.location.hash) {
    var target = document.querySelector(window.location.hash);
    if (target) {
      setTimeout(function() {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  // Highlight dollar amounts on hover (optional enhancement)
  document.querySelectorAll('.dollar').forEach(function(el) {
    el.title = 'Dollar amount from bill text';
  });

})();
