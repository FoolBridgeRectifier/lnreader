/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';

const browser = window as typeof window & {
  reader: {
    chapter: { id: number; name: string; progress: number };
    chapterElement: Element;
    rawHTML: string;
    generalSettings: { val: Record<string, boolean> };
    strings: Record<string, string>;
    post: jest.Mock;
    refresh: jest.Mock;
    setAdjacentChapters: jest.Mock;
  };
  tts: { stop: jest.Mock };
  prepareReaderText: (html: string) => string;
  textRemover: {
    performRemove: (text: string) => void;
    performReplace: (from: string, to: string) => void;
  };
  continuousReader: {
    receive: (response: object) => void;
    navigate: (direction: string, autoStart?: boolean) => void;
    applyTextOptions: () => void;
  };
};

function layoutChapters(heights: Record<number, number>) {
  const sections = () => [
    ...document.querySelectorAll<HTMLElement>('.continuous-chapter'),
  ];
  for (const element of document.querySelectorAll<HTMLElement>(
    '.continuous-chapter',
  )) {
    const height = heights[Number(element.dataset.chapterId)] ?? 1000;
    element.getBoundingClientRect = () =>
      ({
        top:
          sections()
            .slice(0, sections().indexOf(element))
            .reduce((offset, section) => offset + section.offsetHeight, 0) -
          window.scrollY,
      } as DOMRect);
    Object.defineProperty(element, 'offsetHeight', { value: height });
  }
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () =>
      sections().reduce((offset, section) => offset + section.offsetHeight, 0),
  });
}

function flushScrollFrame() {
  const callback = (window.requestAnimationFrame as jest.Mock).mock.calls.at(
    -1,
  )![0];
  callback();
}

function receive(direction: 'NEXT' | 'PREV', chapterId: number) {
  const messages = browser.reader.post.mock.calls.map(([message]) => message);
  const request = messages
    .filter(
      message =>
        message.type === 'continuous-request' &&
        message.data.direction === direction,
    )
    .pop();
  browser.continuousReader.receive({
    ...request.data,
    chapter: { id: chapterId, name: `Chapter ${chapterId}`, progress: 0 },
    html: '<p>Old text. Remove me.</p>',
  });
}

describe('continuous reader DOM integration', () => {
  beforeEach(() => {
    delete (window as Partial<typeof browser>).continuousReader;
    document.body.innerHTML =
      '<div id="LNReader-chapter"><p>Old text. Remove me.</p></div>';
    const root = document.getElementById('LNReader-chapter')!;
    window.scrollTo = jest.fn();
    window.scrollBy = jest.fn();
    window.requestAnimationFrame = jest.fn();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 600,
    });
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    browser.reader = {
      chapter: { id: 2, name: 'Chapter 2', progress: 0 },
      chapterElement: root,
      rawHTML: root.innerHTML,
      generalSettings: { val: { continuousReading: true, pageReader: false } },
      strings: {},
      post: jest.fn(),
      refresh: jest.fn(),
      setAdjacentChapters: jest.fn(),
    };
    browser.tts = { stop: jest.fn() };
    browser.prepareReaderText = html => html;
    for (const file of ['continuous.js', 'textRemover.js']) {
      window.eval(
        fs.readFileSync(
          path.join(process.cwd(), 'assets/reader/js', file),
          'utf8',
        ),
      );
    }
    if (!browser.continuousReader) {
      document.dispatchEvent(new Event('DOMContentLoaded'));
    }
  });

  it('keeps sections and loaders connected after live remove/replace, formatting, and further navigation', () => {
    receive('NEXT', 3);
    receive('NEXT', 4);
    receive('NEXT', 5);
    receive('PREV', 1);
    const root = document.getElementById('LNReader-chapter')!;
    const sections = [...root.querySelectorAll('.continuous-chapter')];
    const loaders = [...root.querySelectorAll('.continuous-status')];
    browser.textRemover.performRemove('Remove me.');
    browser.textRemover.performReplace('Old', 'New');

    expect(
      [...sections, ...loaders].every(element => element.isConnected),
    ).toBe(true);
    expect(
      sections.every(element => element.textContent?.includes('New text.')),
    ).toBe(true);
    expect(root.textContent).not.toContain('Remove me.');
    browser.reader.generalSettings.val.bionicReading = true;
    browser.continuousReader.applyTextOptions();
    expect(root.textContent).not.toContain('Old');
    expect(root.textContent).not.toContain('Remove me.');

    browser.continuousReader.navigate('NEXT');
    receive('NEXT', 6);
    expect(browser.reader.chapter.id).toBe(3);
    expect(root.querySelector('[data-chapter-id="6"]')).not.toBeNull();
    expect(loaders.every(element => element.isConnected)).toBe(true);
  });

  it('cancels a pending speech jump when the user navigates in the other direction', () => {
    receive('PREV', 1);
    browser.continuousReader.navigate('NEXT', true);
    browser.continuousReader.navigate('PREV');
    receive('NEXT', 3);
    expect(browser.reader.chapter.id).toBe(1);
  });

  it('completes the outgoing chapter before Next activates the next chapter', () => {
    receive('NEXT', 3);
    layoutChapters({ 2: 3000, 3: 3000 });
    browser.reader.post.mockClear();

    browser.continuousReader.navigate('NEXT');

    const messages = browser.reader.post.mock.calls.map(([message]) => message);
    expect(messages[0]).toMatchObject({
      type: 'continuous-progress',
      data: { chapterId: 2, progress: 100 },
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'continuous-active',
        data: expect.objectContaining({ chapterId: 3 }),
      }),
    );
  });

  it('activates the chapter reached by scrolling and saves the completed chapter', () => {
    receive('NEXT', 3);
    layoutChapters({ 2: 2000, 3: 2000 });
    Object.defineProperty(window, 'scrollY', { value: 2050 });
    flushScrollFrame();

    expect(browser.reader.chapter.id).toBe(3);
    expect(browser.reader.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'continuous-progress',
        data: expect.objectContaining({ chapterId: 2, progress: 100 }),
      }),
    );
  });

  it('activates a short final chapter when the reader reaches the bottom', () => {
    receive('NEXT', 3);
    const request = browser.reader.post.mock.calls
      .map(([message]) => message)
      .filter(
        message =>
          message.type === 'continuous-request' &&
          message.data.direction === 'NEXT',
      )
      .pop();
    browser.continuousReader.receive({ ...request.data, end: true });
    layoutChapters({ 2: 2000, 3: 200 });
    Object.defineProperty(window, 'scrollY', { value: 1600 });
    flushScrollFrame();

    expect(browser.reader.chapter.id).toBe(3);
    expect(browser.reader.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'continuous-progress',
        data: expect.objectContaining({ chapterId: 3, progress: 100 }),
      }),
    );
  });

  it('retries a failed next chapter when Next is pressed again', () => {
    const request = browser.reader.post.mock.calls
      .map(([message]) => message)
      .find(
        message =>
          message.type === 'continuous-request' &&
          message.data.direction === 'NEXT',
      );
    browser.continuousReader.receive({ ...request.data, error: true });
    browser.reader.post.mockClear();

    browser.continuousReader.navigate('NEXT');
    expect(browser.reader.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'continuous-request',
        data: expect.objectContaining({ direction: 'NEXT', anchorId: 2 }),
      }),
    );
    receive('NEXT', 3);
    expect(browser.reader.chapter.id).toBe(3);
  });

  it('preserves the reading position when eviction clamps the browser scroll offset', () => {
    receive('NEXT', 3);
    receive('NEXT', 4);
    layoutChapters({ 2: 1000, 3: 1000, 4: 1000 });
    const setScroll = (value: number) => {
      Object.defineProperty(window, 'scrollY', { value });
    };
    window.scrollTo = jest.fn(
      (options?: ScrollToOptions | number, y?: number) => {
        const top = typeof options === 'number' ? y : options?.top;
        setScroll(
          Math.max(
            0,
            Math.min(
              top ?? window.scrollY,
              document.documentElement.scrollHeight - window.innerHeight,
            ),
          ),
        );
      },
    );
    window.scrollBy = jest.fn(
      (options?: ScrollToOptions | number, y?: number) => {
        const top = typeof options === 'number' ? y : options?.top;
        window.scrollTo({
          top: window.scrollY + (top ?? 0),
          behavior: 'instant',
        });
      },
    );
    const first = document.querySelector<HTMLElement>('[data-chapter-id="2"]')!;
    const remove = first.remove.bind(first);
    first.remove = () => {
      remove();
      setScroll(
        Math.min(
          window.scrollY,
          document.documentElement.scrollHeight - window.innerHeight,
        ),
      );
    };
    setScroll(2400);

    flushScrollFrame();

    expect(browser.reader.chapter.id).toBe(4);
    expect(window.scrollY).toBe(1400);
    expect(browser.reader.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'continuous-progress',
        data: expect.objectContaining({ chapterId: 4, progress: 100 }),
      }),
    );
  });
});
