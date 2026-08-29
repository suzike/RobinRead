/* 知更产品网站 — 轻量交互：错峰滚动入场 */
(function () {
  'use strict';

  var revealEls = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;

      // 若在错峰容器（.stagger / .reveal-wrap）内，按其兄弟顺序延迟入场
      var host = el.closest('.stagger, .reveal-wrap');
      if (host) {
        var siblings = Array.prototype.slice.call(host.querySelectorAll('.reveal'));
        var index = Math.max(0, siblings.indexOf(el));
        el.style.transitionDelay = (index * 60) + 'ms';
      }

      el.classList.add('visible');
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  revealEls.forEach(function (el) { io.observe(el); });
})();
