(async function(){
  try{
    const r = await fetch('/api/auth/me');
    if(!r.ok) return;
    const me = await r.json();

    // ── Admin nav link ──────────────────────────────────────────────────
    if(me.role === 'admin' || me.role === 'superadmin'){
      const navs = document.querySelectorAll('.nav-links');
      navs.forEach(nav=>{
        const a = document.createElement('a');
        a.href = '/admin';
        a.textContent = 'Admin';
        a.style.color = getComputedStyle(nav).color || '#0d9488';
        nav.appendChild(a);
      });
    }

    // ── Trial banner ────────────────────────────────────────────────────
    if(me.trial && !me.trial.hasPaidPlan && !me.trial.expired){
      const days = me.trial.daysRemaining;
      const banner = document.createElement('div');
      banner.id = 'trialBanner';
      const urgency = days <= 2 ? '#dc2626' : days <= 4 ? '#d97706' : '#0d9488';
      const bgColor = days <= 2 ? '#fef2f2' : days <= 4 ? '#fffbeb' : '#f0fdfa';
      const borderColor = days <= 2 ? '#fecaca' : days <= 4 ? '#fde68a' : '#99f6e4';
      banner.style.cssText = `
        background: ${bgColor};
        border-bottom: 2px solid ${borderColor};
        padding: 10px 20px;
        text-align: center;
        font-size: 0.88rem;
        font-family: inherit;
        color: ${urgency};
        font-weight: 600;
        z-index: 999;
      `;
      const dayWord = days === 1 ? 'day' : 'days';
      banner.innerHTML = days === 0
        ? `⏱️ Your trial expires today! <a href="/settings#billing" style="color:${urgency};text-decoration:underline;margin-left:8px;">Upgrade now</a>`
        : `⏱️ ${days} ${dayWord} left in your free trial. <a href="/settings#billing" style="color:${urgency};text-decoration:underline;margin-left:8px;">Upgrade now</a>`;

      // Insert after the nav bar (or at top of body)
      const nav = document.querySelector('nav');
      if(nav && nav.nextSibling){
        nav.parentNode.insertBefore(banner, nav.nextSibling);
      } else {
        document.body.prepend(banner);
      }
    }
  }catch(e){/* silent */}
})();
