(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const grid = $('#grid');
  const state = { data: null, filter: 'all', tag: '', q: '', nextAt: 0, loading: false };

  const nf = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function since(iso) {
    if (!iso) return '';
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return mins + ' phút';
    const h = Math.floor(mins / 60);
    return h + ' giờ' + (mins % 60 ? ' ' + (mins % 60) + ' phút' : '');
  }

  function skeleton(n) {
    grid.innerHTML = Array.from({ length: n }, () =>
      '<div class="card skeleton"><div class="cover"></div><div class="body"><div class="meta">' +
      '<div class="sk" style="width:70%"></div><div class="sk" style="width:40%"></div></div></div></div>'
    ).join('');
  }

  function card(ch, featured) {
    const live = ch.live;
    const href = live ? 'https://www.youtube.com/watch?v=' + live.videoId : ch.url;
    const cover = live ? live.thumbnail : ch.banner;
    const initial = esc((ch.title || '?').trim().charAt(0).toUpperCase());
    const subs = ch.subscribers != null ? nf.format(ch.subscribers) + ' người đăng ký'
      : ch.subscribersText ? esc(ch.subscribersText) + ' người đăng ký' : '';

    return (
      '<a class="card' + (live ? ' is-live' : '') + (featured ? ' is-featured' : '') + '" href="' + esc(href) +
      '" target="_blank" rel="noopener" aria-label="' + esc(ch.title) + (live ? ' — đang phát trực tiếp' : '') + '">' +
        '<div class="cover"' + (cover ? ' style="background-image:url(\'' + esc(cover) + '\')"' : '') + '>' +
          (cover ? '' : '<div class="cover-fallback">' + initial + '</div>') +
          (live ? '<span class="badge-live"><span class="pulse"></span>LIVE</span>' : '') +
          (live && live.viewers != null ? '<span class="viewers">' + nf.format(live.viewers) + ' đang xem</span>' : '') +
        '</div>' +
        '<div class="body">' +
          (ch.avatar ? '<img class="avatar" src="' + esc(ch.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
          '<div class="meta">' +
            '<p class="name">' + esc(ch.title) + '</p>' +
            '<div class="handle">' + esc(ch.handle) + '</div>' +
            (live ? '<div class="live-title">' + esc(live.title) + '</div>' : '') +
            '<div class="stats">' +
              (ch.tag ? '<span class="pill">' + esc(ch.tag) + '</span>' : '') +
              (live
                ? (live.startedAt ? '<span class="live-since">Live ' + since(live.startedAt) + '</span>' : '<span class="live-since">Đang live</span>')
                : '<span class="offline">Offline</span>') +
              (subs ? '<span>' + subs + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</a>'
    );
  }

  function render() {
    const d = state.data;
    if (!d) return;
    const all = d.channels;
    const liveCount = all.filter((c) => c.live).length;

    $('#count-all').textContent = all.length;
    $('#count-live').textContent = liveCount;
    $('#summary').innerHTML = liveCount
      ? '<strong>' + liveCount + '</strong> / ' + all.length + ' kênh bạn theo dõi đang phát trực tiếp.'
      : 'Chưa có kênh nào live. Trang tự kiểm tra lại mỗi ' + d.refreshSeconds + ' giây.';
    document.title = (liveCount ? '(' + liveCount + ' live) ' : '') + 'Kênh theo dõi';

    const tags = [...new Set(all.map((c) => c.tag).filter(Boolean))];
    $('#tags').innerHTML = tags.map((t) =>
      '<button class="tag-btn' + (state.tag === t ? ' is-active' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>'
    ).join('');

    const q = state.q.toLowerCase();
    const list = all
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => state.filter === 'all' || c.live)
      .filter(({ c }) => !state.tag || c.tag === state.tag)
      .filter(({ c }) => !q || (c.title + ' ' + c.handle).toLowerCase().includes(q))
      // Live first (most viewers first), then keep the order from channels.json.
      .sort((a, b) => (!!b.c.live - !!a.c.live) ||
        ((b.c.live && b.c.live.viewers || 0) - (a.c.live && a.c.live.viewers || 0)) || a.i - b.i)
      .map(({ c }) => c);

    // Feature (double-width) at most 2 live tiles, and only when there are also offline ones to balance.
    const featureN = liveCount < list.length ? Math.min(2, liveCount) : 0;
    grid.innerHTML = list.map((c, i) => card(c, i < featureN)).join('');
    $('#empty').hidden = list.length > 0;
    $('#source').textContent = 'Nguồn: ' + (d.source === 'youtube-data-api' ? 'YouTube Data API' : 'trang YouTube công khai') +
      ' · cập nhật ' + new Date(d.updatedAt).toLocaleTimeString('vi-VN');
  }

  async function load(force) {
    if (state.loading) return;
    state.loading = true;
    $('#refresh').classList.add('is-spinning');
    try {
      const res = await fetch('/api/channels' + (force ? '?force=1' : ''), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      state.data = body;
      $('#error').hidden = true;
      render();
    } catch (e) {
      $('#error').hidden = false;
      $('#error').textContent = 'Không tải được dữ liệu: ' + e.message;
      if (!state.data) grid.innerHTML = '';
    } finally {
      state.loading = false;
      $('#refresh').classList.remove('is-spinning');
      state.nextAt = Date.now() + ((state.data && state.data.refreshSeconds) || 60) * 1000;
    }
  }

  setInterval(() => {
    if (!state.nextAt) return;
    const left = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
    $('#countdown').textContent = left + 's';
    if (left === 0 && !document.hidden) load(false);
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() > state.nextAt) load(false);
  });

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    document.querySelectorAll('.seg-btn').forEach((x) => {
      x.classList.toggle('is-active', x === b);
      x.setAttribute('aria-selected', x === b);
    });
    render();
  }));
  $('#tags').addEventListener('click', (e) => {
    const b = e.target.closest('.tag-btn');
    if (!b) return;
    state.tag = state.tag === b.dataset.tag ? '' : b.dataset.tag;
    render();
  });
  $('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
  $('#refresh').addEventListener('click', () => load(true));

  skeleton(8);
  load(false);
})();
