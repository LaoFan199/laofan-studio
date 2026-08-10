/**
 * 个人主页 — Apple 风格交互
 */

(function () {
  'use strict';

  const html = document.documentElement;
  const nav = document.getElementById('nav');
  const themeToggle = document.getElementById('theme-toggle');
  const navMenuBtn = document.getElementById('nav-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  const contactModal = document.getElementById('contact-modal');
  const btnContact = document.getElementById('btn-contact');
  const modalClose = document.getElementById('modal-close');
  const navLinks = document.querySelectorAll('.nav-link, .mobile-link');
  const sections = document.querySelectorAll('section[id]');
  const reveals = document.querySelectorAll('.reveal');
  const statNumbers = document.querySelectorAll('.stat-number');

  /* ===== Theme ===== */
  function getTheme() {
    return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function setTheme(theme) {
    if (theme === 'dark') {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
  }

  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  themeToggle.addEventListener('click', toggleTheme);

  /* ===== Mobile Nav ===== */
  function closeMobileMenu() {
    navMenuBtn.classList.remove('open');
    navMenuBtn.setAttribute('aria-expanded', 'false');
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden', 'true');
  }

  function toggleMobileMenu() {
    const isOpen = navMenuBtn.classList.toggle('open');
    navMenuBtn.setAttribute('aria-expanded', String(isOpen));
    mobileMenu.classList.toggle('open', isOpen);
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
  }

  navMenuBtn.addEventListener('click', toggleMobileMenu);

  document.querySelectorAll('.mobile-link').forEach((link) => {
    link.addEventListener('click', closeMobileMenu);
  });

  /* ===== Nav Scroll State ===== */
  const ambient = document.querySelector('.ambient');

  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ===== Active Nav Link ===== */
  const observerNav = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach((link) => {
            const href = link.getAttribute('href');
            link.classList.toggle('active', href === `#${id}`);
          });
        }
      });
    },
    { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
  );

  sections.forEach((section) => observerNav.observe(section));

  /* ===== Scroll Reveal ===== */
  const observerReveal = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observerReveal.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  reveals.forEach((el) => observerReveal.observe(el));

  /* ===== Counter Animation ===== */
  function animateCounter(el) {
    const target = parseInt(el.dataset.count, 10);
    const duration = 1800;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  const observerStats = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observerStats.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  statNumbers.forEach((el) => observerStats.observe(el));

  /* ===== Smooth Scroll (anchor links) ===== */
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const id = anchor.getAttribute('href');
      if (id === '#') return;

      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      closeMobileMenu();
      closeModal();

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.pushState(null, '', id);
    });
  });

  /* ===== Modal ===== */
  function openModal() {
    contactModal.classList.add('active');
    contactModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    contactModal.classList.remove('active');
    contactModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  btnContact.addEventListener('click', openModal);
  modalClose.addEventListener('click', closeModal);

  contactModal.addEventListener('click', (e) => {
    if (e.target === contactModal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeMobileMenu();
    }
  });

  /* ===== Mouse Parallax (subtle, desktop only) ===== */
  if (window.matchMedia('(pointer: fine)').matches && ambient) {
    document.addEventListener('mousemove', (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      ambient.style.transform = `translate(${x * 14}px, ${y * 10}px)`;
    });
  }

  /* ===== Page Enter ===== */
  window.addEventListener('load', () => {
    document.body.classList.add('loaded');
  });
})();
