// A bounded DOM window: one previous chapter, the current chapter, and 2–3 ahead.
// Raw chapter HTML lives in the app cache only while its section is retained.
(() => {
  if (
    !reader.generalSettings.val.continuousReading ||
    reader.generalSettings.val.pageReader
  ) {
    return;
  }
  const MIN_AHEAD = 2;
  const MAX_AHEAD = 3;
  const BUFFER_CHARACTER_BUDGET = 128 * 1024;

  const root = document.getElementById('LNReader-chapter');
  // Every replacement WebView gets a different token, so old async replies
  // cannot append chapters to the wrong document.
  const token = `${Date.now()}-${Math.random()}`;
  const entries = [];
  const pending = { NEXT: null, PREV: null };
  const ended = { NEXT: false, PREV: false };
  const failed = { NEXT: false, PREV: false };
  let active;
  let activeTop = 0;
  let requestId = 0;
  let pendingJump = null;
  let scrollFrame;
  let restored = false;
  let appliedBionic = reader.generalSettings.val.bionicReading;
  let appliedSpacing = reader.generalSettings.val.removeExtraParagraphSpacing;
  let aheadCount =
    root.innerHTML.length > BUFFER_CHARACTER_BUDGET ? MIN_AHEAD : MAX_AHEAD;

  const post = (type, data = {}) =>
    reader.post({ type, data: { token, ...data } });
  const top = entry =>
    entry.element.getBoundingClientRect().top + window.scrollY;
  const activeIndex = () => entries.indexOf(active);

  const syncAdjacent = () => {
    const index = activeIndex();
    reader.setAdjacentChapters({
      nextChapter: entries[index + 1]?.chapter,
      prevChapter: entries[index - 1]?.chapter,
    });
  };

  const progress = entry =>
    Math.max(
      0,
      Math.min(
        1,
        (window.scrollY + window.innerHeight - top(entry)) /
          Math.max(1, entry.element.offsetHeight),
      ),
    );
  const save = (percentage = active && Math.floor(progress(active) * 100)) => {
    if (active) {
      post('continuous-progress', {
        chapterId: active.chapter.id,
        progress: percentage,
      });
    }
  };

  const createStatus = direction => {
    const element = document.createElement('div');
    element.className = 'continuous-status';
    element.hidden = true;
    element.setAttribute('role', 'status');
    element.addEventListener('click', event => {
      event.stopPropagation();
      if (failed[direction]) {
        failed[direction] = false;
        fill();
      }
    });
    element.addEventListener('keydown', event => {
      if (failed[direction] && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        element.click();
      }
    });
    return element;
  };

  const before = createStatus('PREV');
  const after = createStatus('NEXT');
  let displayedStatus = '';

  const updateStatus = () => {
    // fill() runs during scrolling. Avoid re-laying out the loader unless its
    // state changed, otherwise even an idle prefetch buffer would cause jank.
    const statusKey = `${Boolean(pending.PREV)}:${Boolean(pending.NEXT)}:${
      ended.PREV
    }:${ended.NEXT}:${failed.PREV}:${failed.NEXT}`;
    if (statusKey === displayedStatus) {
      return;
    }
    displayedStatus = statusKey;

    preservePosition(() => {
      for (const [direction, element] of [
        ['PREV', before],
        ['NEXT', after],
      ]) {
        const loading = Boolean(pending[direction]);
        element.classList.toggle('loading', loading);
        element.classList.toggle('retry', failed[direction]);
        element.setAttribute('aria-busy', String(loading));
        element.textContent = failed[direction]
          ? reader.strings.chapterLoadFailed
          : loading
          ? reader.strings.loadingChapter
          : direction === 'NEXT' && ended.NEXT
          ? reader.strings.endOfNovel
          : '';
        element.hidden = !element.textContent;
        element.tabIndex = failed[direction] ? 0 : -1;
      }
    });
  };
  const release = removed => {
    if (removed.length) {
      post('continuous-release', {
        evictedChapters: removed.map(entry => ({
          id: entry.chapter.id,
          requestId: entry.requestId,
        })),
      });
    }
  };

  // Prepending/evicting chapters and showing the top loader change document
  // height. Compensate by the active section's displacement, not total height.
  const preservePosition = change => {
    const oldTop = active ? top(active) : 0;
    const oldScroll = window.scrollY;
    change();
    if (active) {
      const newTop = top(active);
      if (newTop !== oldTop) {
        // Removing content can already clamp scrollY to the new document end.
        window.scrollTo({
          top: oldScroll + newTop - oldTop,
          behavior: 'instant',
        });
      }
      activeTop = newTop;
    }
  };

  const prune = () => {
    const removed = [];
    preservePosition(() => {
      while (activeIndex() > 1) {
        const entry = entries.shift();
        entry.element.remove();
        removed.push(entry);
        ended.PREV = false;
      }
      while (entries.length - activeIndex() - 1 > aheadCount) {
        const entry = entries.pop();
        entry.element.remove();
        removed.push(entry);
        ended.NEXT = false;
      }
    });
    release(removed);
  };

  const request = direction => {
    if (pending[direction] || failed[direction] || ended[direction]) {
      return;
    }
    const anchor =
      direction === 'NEXT' ? entries[entries.length - 1] : entries[0];
    pending[direction] = { id: ++requestId, anchorId: anchor.chapter.id };
    updateStatus();
    post('continuous-request', {
      requestId,
      direction,
      anchorId: anchor.chapter.id,
    });
  };

  function fill() {
    if (entries.length - activeIndex() - 1 < aheadCount) {
      request('NEXT');
    }

    if (activeIndex() < 1) {
      request('PREV');
    }
    updateStatus();
  }

  const select = (entry, autoStartTTS = false, completePrevious = false) => {
    if (!entry || active === entry) {
      return;
    }

    pendingJump = null;
    save(completePrevious ? 100 : undefined);
    window.tts?.stop();
    active = entry;
    aheadCount =
      entries
        .slice(activeIndex(), activeIndex() + MAX_AHEAD)
        .reduce((size, item) => size + item.size, 0) > BUFFER_CHARACTER_BUDGET
        ? MIN_AHEAD
        : MAX_AHEAD;
    activeTop = top(entry);
    reader.chapter = entry.chapter;
    reader.chapterElement = entry.body;
    reader.rawHTML = entry.raw;
    reader.refresh();
    syncAdjacent();
    window.readerSearch?.invalidateCache();
    const query = window.readerSearch?.query;
    if (query) {
      window.readerSearch.search(query);
    }
    post('continuous-active', { chapterId: entry.chapter.id, autoStartTTS });
    prune();
    fill();
  };

  const jump = (direction, autoStartTTS = false) => {
    pendingJump = null;
    const target = entries[activeIndex() + (direction === 'NEXT' ? 1 : -1)];
    if (!target) {
      if (!ended[direction]) {
        pendingJump = { direction, autoStartTTS };
        failed[direction] = false;
        request(direction);
      }
      return;
    }
    select(target, autoStartTTS, direction === 'NEXT');
    window.scrollTo({ top: top(target), behavior: 'instant' });
    save();
  };

  const makeEntry = (chapter, html, initial = false, requestId = 0) => {
    const element = document.createElement('section');
    element.className = 'continuous-chapter';
    element.dataset.chapterId = String(chapter.id);
    const heading = document.createElement('h2');
    heading.className = 'continuous-heading';
    heading.textContent = chapter.name;
    const body = document.createElement('div');
    body.className = 'continuous-body';
    const raw =
      !initial && window.applyContinuousCustomCode
        ? window.applyContinuousCustomCode(html)
        : html;
    body.innerHTML =
      !initial && window.prepareReaderText
        ? window.prepareReaderText(raw)
        : raw;
    element.append(heading, body);
    return {
      chapter,
      element,
      body,
      raw: initial ? reader.rawHTML : raw,
      size: html.length,
      requestId,
    };
  };

  const processScroll = () => {
    scrollFrame = undefined;
    const readingLine =
      window.scrollY + Math.min(100, window.innerHeight * 0.15);
    let visible = entries[0];
    for (const entry of entries) {
      if (top(entry) <= readingLine) {
        visible = entry;
      } else {
        break;
      }
    }
    // A short last chapter cannot reach the reading line at maximum scroll.
    const last = entries[entries.length - 1];
    if (
      ended.NEXT &&
      window.scrollY > 0 &&
      top(last) < window.scrollY + window.innerHeight &&
      window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 1
    ) {
      visible = last;
    }
    if (visible !== active) {
      select(visible);
      save();
    }
    fill();
  };

  const scheduleScroll = () => {
    if (scrollFrame === undefined) {
      scrollFrame = requestAnimationFrame(processScroll);
    }
  };

  const controller = {
    enabled: true,
    editText: (from, to) => {
      if (!from) return;
      const match = from.match(/^\/(.*)\/([gmiyuvsd]*)$/);
      let pattern;
      if (match) {
        try {
          pattern = new RegExp(match[1], match[2]);
        } catch {
          return;
        }
      }
      const updates = entries
        .map(entry => {
          if (pattern) pattern.lastIndex = 0;
          const raw = pattern
            ? entry.raw.replace(pattern, to)
            : entry.raw.split(from).join(to);
          return { entry, raw };
        })
        .filter(({ entry, raw }) => entry.raw !== raw);
      if (!updates.length) return;

      window.tts?.stop();
      preservePosition(() => {
        for (const { entry, raw } of updates) {
          entry.raw = raw;
          entry.size = raw.length;
          entry.body.innerHTML = window.prepareReaderText(raw);
        }
      });
      reader.rawHTML = active.raw;
      reader.refresh();
      window.readerSearch?.invalidateCache();
      if (window.readerSearch?.query)
        window.readerSearch.search(window.readerSearch.query);
    },
    hasNext: () => !ended.NEXT || activeIndex() < entries.length - 1,
    applyTextOptions: () => {
      const settings = reader.generalSettings.val;
      if (
        settings.bionicReading === appliedBionic &&
        settings.removeExtraParagraphSpacing === appliedSpacing
      ) {
        return;
      }
      appliedBionic = settings.bionicReading;
      appliedSpacing = settings.removeExtraParagraphSpacing;
      window.tts?.stop();
      preservePosition(() => {
        for (const entry of entries) {
          entry.body.innerHTML = window.prepareReaderText(entry.raw);
        }
      });
      window.readerSearch?.invalidateCache();
    },
    save,
    ratio: () => (active ? progress(active) : 0),
    seek: ratio => {
      if (!active) {
        return;
      }
      window.scrollTo({
        top: Math.max(
          top(active),
          top(active) +
            active.element.offsetHeight * ratio -
            window.innerHeight,
        ),
        behavior: 'instant',
      });
    },
    navigate: jump,
    // Native code awaits stop() before acknowledging this hand-off. This
    // prevents the old chapter's stop from cancelling the new speech queue.
    startSpeech: (sessionToken, chapterId) => {
      if (sessionToken === token && active?.chapter.id === chapterId) {
        window.tts?.start();
      }
    },
    start: () =>
      active && window.scrollTo({ top: top(active), behavior: 'smooth' }),
    restore: () => {
      if (restored || !active) {
        return;
      }
      restored = true;
      controller.seek((active.chapter.progress || 0) / 100);
    },
    receive: response => {
      if (response.token !== token) {
        return;
      }
      const direction = response.direction;
      const task = pending[direction];
      if (!task || task.id !== response.requestId) {
        return;
      }
      pending[direction] = null;
      if (response.error) {
        failed[direction] = true;
        updateStatus();
        return;
      }
      const edge =
        direction === 'NEXT' ? entries[entries.length - 1] : entries[0];
      if (edge.chapter.id !== task.anchorId) {
        if (
          response.chapter &&
          !entries.some(entry => entry.chapter.id === response.chapter.id)
        ) {
          release([
            { chapter: response.chapter, requestId: response.requestId },
          ]);
        }
        fill();
        return;
      }
      if (
        response.end ||
        entries.some(entry => entry.chapter.id === response.chapter?.id)
      ) {
        const existing = entries.find(
          entry => entry.chapter.id === response.chapter?.id,
        );
        if (existing)
          existing.requestId = Math.max(existing.requestId, response.requestId);
        ended[direction] = true;
        if (pendingJump?.direction === direction) {
          if (pendingJump.autoStartTTS) window.tts?.reset();
          pendingJump = null;
        }
      } else if (response.chapter && typeof response.html === 'string') {
        const entry = makeEntry(
          response.chapter,
          response.html,
          false,
          response.requestId,
        );
        if (
          direction === 'NEXT' &&
          entries
            .slice(activeIndex())
            .reduce((size, item) => size + item.size, entry.size) >
            BUFFER_CHARACTER_BUDGET
        ) {
          aheadCount = MIN_AHEAD;
        }
        preservePosition(() => {
          if (direction === 'NEXT') {
            entries.push(entry);
            root.insertBefore(entry.element, after);
          } else {
            entries.unshift(entry);
            root.insertBefore(entry.element, entries[1].element);
          }
        });
        prune();
        if (pendingJump?.direction === direction) {
          const autoStart = pendingJump.autoStartTTS;
          pendingJump = null;
          jump(direction, autoStart);
        }
      }
      fill();
      syncAdjacent();
      reader.refresh();
      // Content can arrive under a stationary viewport at the loading boundary.
      scheduleScroll();
    },
  };

  const init = () => {
    const entry = makeEntry(reader.chapter, root.innerHTML, true);
    root.replaceChildren(before, entry.element, after);
    root.style.overflowAnchor = 'none';
    entries.push(entry);
    active = entry;
    activeTop = top(entry);
    reader.chapterElement = entry.body;
    reader.rawHTML = entry.raw;
    window.continuousReader = controller;
    reader.getScrollRatio = controller.ratio;
    post('continuous-ready', { chapterId: entry.chapter.id });
    fill();
    window.addEventListener('scroll', scheduleScroll, { passive: true });
    new ResizeObserver(() => {
      const newTop = top(active);
      if (newTop !== activeTop) {
        window.scrollBy({ top: newTop - activeTop, behavior: 'instant' });
      }
      activeTop = newTop;
      reader.refresh();
    }).observe(root);
    requestAnimationFrame(controller.restore);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
