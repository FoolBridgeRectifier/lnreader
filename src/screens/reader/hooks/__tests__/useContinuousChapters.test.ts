import { act, renderHook } from '@testing-library/react-native';
import { ChapterInfo } from '@database/types';
import { useContinuousChapters } from '../useContinuousChapters';

const mockContext = {
  continuous: true,
  documentChapter: { id: 1, name: 'Chapter 1' } as ChapterInfo,
  webViewRef: { current: { injectJavaScript: jest.fn() } },
  loadAdjacentChapter: jest.fn(),
  loadChapterHtml: jest.fn(),
  activateContinuousChapter: jest.fn(),
  chapterTextCache: { clear: jest.fn(), remove: jest.fn() },
  saveProgress: jest.fn(),
};
let mockEdits = {
  removeText: [] as string[],
  replaceText: {} as Record<string, string>,
};
let mockFilters: string[] = [];
jest.mock('../../ChapterContext', () => ({
  useChapterContext: () => mockContext,
}));
jest.mock('@hooks/persisted/useSettings', () => ({
  useChapterReaderSettings: () => mockEdits,
}));
jest.mock('@hooks/persisted/useNovelSettings', () => ({
  useNovelSettings: () => ({ chapterTextFilters: mockFilters }),
}));

const next = { id: 2, name: 'Chapter 2' } as ChapterInfo;
const payload = {
  token: 'session',
  requestId: 1,
  anchorId: 1,
  direction: 'NEXT' as const,
};
const responses = () =>
  mockContext.webViewRef.current.injectJavaScript.mock.calls.map(
    ([script]: [string]) =>
      JSON.parse(
        script.slice(
          script.indexOf('receive(') + 8,
          script.lastIndexOf('); true;'),
        ),
      ),
  );

describe('continuous chapter bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContext.continuous = true;
    mockEdits = { removeText: [], replaceText: {} };
    mockFilters = [];
    mockContext.loadAdjacentChapter.mockResolvedValue(next);
    mockContext.loadChapterHtml.mockResolvedValue('<p>Story Ad</p>');
  });

  it('queues content without activating or marking a prefetched chapter as read', async () => {
    const { result } = renderHook(useContinuousChapters);
    mockFilters = ['Ad'];
    await act(async () => {
      await result.current('continuous-ready', {
        token: 'session',
        chapterId: 1,
      });
      await result.current('continuous-request', payload);
    });
    expect(mockContext.loadAdjacentChapter).toHaveBeenCalledWith(
      mockContext.documentChapter,
      'NEXT',
    );
    expect(responses()[0].chapter.id).toBe(2);
    expect(mockContext.activateContinuousChapter).not.toHaveBeenCalled();
    expect(mockContext.saveProgress).not.toHaveBeenCalled();
    await act(async () => {
      await result.current('continuous-progress', {
        token: 'session',
        chapterId: 2,
        progress: 43,
      });
      await result.current('continuous-active', {
        token: 'session',
        chapterId: 2,
      });
      await result.current('continuous-release', {
        token: 'session',
        evictedChapters: [{ id: 1, requestId: 0 }],
      });
    });
    expect(mockContext.saveProgress).toHaveBeenCalledWith(43, next);
    expect(mockContext.activateContinuousChapter).toHaveBeenCalledWith({
      ...next,
      progress: 43,
    });
    expect(mockContext.chapterTextCache.remove).toHaveBeenCalledWith(1);
  });

  it('keeps concurrently sent chapters until the page explicitly evicts that transfer', async () => {
    const previous = { id: 3, name: 'Previous chapter' } as ChapterInfo;
    const { result } = renderHook(useContinuousChapters);
    await act(async () => {
      await result.current('continuous-ready', {
        token: 'session',
        chapterId: 1,
      });
      await result.current('continuous-request', payload);
      mockContext.loadAdjacentChapter.mockResolvedValueOnce(previous);
      await result.current('continuous-request', {
        ...payload,
        direction: 'PREV',
        requestId: 2,
      });
      // One reply has reached the page while the other is still in transit.
      await result.current('continuous-release', {
        token: 'session',
        evictedChapters: [],
      });
      await result.current('continuous-active', {
        token: 'session',
        chapterId: 3,
      });
    });
    expect(mockContext.activateContinuousChapter).toHaveBeenCalledWith(
      previous,
    );
    expect(mockContext.chapterTextCache.remove).not.toHaveBeenCalled();
  });

  it('does not release a newer transfer when a delayed eviction refers to an older one', async () => {
    const { result } = renderHook(useContinuousChapters);
    await act(async () => {
      await result.current('continuous-ready', {
        token: 'session',
        chapterId: 1,
      });
      await result.current('continuous-request', payload);
      await result.current('continuous-request', { ...payload, requestId: 2 });
      await result.current('continuous-release', {
        token: 'session',
        evictedChapters: [{ id: 2, requestId: 1 }],
      });
      await result.current('continuous-active', {
        token: 'session',
        chapterId: 2,
      });
    });
    expect(mockContext.activateContinuousChapter).toHaveBeenCalledWith(next);
    expect(mockContext.chapterTextCache.remove).not.toHaveBeenCalled();
    await act(async () => {
      await result.current('continuous-release', {
        token: 'session',
        evictedChapters: [{ id: 2, requestId: 2 }],
      });
    });
    expect(mockContext.chapterTextCache.remove).toHaveBeenCalledWith(2);
  });

  it('applies current edits to an in-flight chapter and ignores old-document replies', async () => {
    let resolve!: (html: string) => void;
    mockContext.loadChapterHtml.mockReturnValue(
      new Promise<string>(done => {
        resolve = done;
      }),
    );
    const { result, rerender } = renderHook(useContinuousChapters);
    await act(async () => {
      await result.current('continuous-ready', {
        token: 'session',
        chapterId: 1,
      });
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current('continuous-request', payload);
    });
    mockEdits = { removeText: ['Remove'], replaceText: { Old: 'New' } };
    mockFilters = ['Ad'];
    rerender({});
    await act(async () => {
      resolve('<p>Remove Old Ad</p>');
      await pending;
    });
    expect(responses()[0].html).toBe('<p> New </p>');

    mockContext.webViewRef.current.injectJavaScript.mockClear();
    mockContext.loadChapterHtml.mockReturnValue(
      new Promise<string>(done => {
        resolve = done;
      }),
    );
    await act(async () => {
      pending = result.current('continuous-request', {
        ...payload,
        requestId: 2,
      });
    });
    await act(async () => {
      await result.current('continuous-ready', {
        token: 'new-session',
        chapterId: 1,
      });
    });
    // The old load must never append to the replacement document.
    await act(async () => {
      resolve('<p>Stale</p>');
      await pending;
    });
    expect(
      mockContext.webViewRef.current.injectJavaScript,
    ).not.toHaveBeenCalled();
  });

  it('reports failures separately from end-of-book and permits a retry', async () => {
    const { result } = renderHook(useContinuousChapters);
    await act(async () => {
      await result.current('continuous-ready', {
        token: 'session',
        chapterId: 1,
      });
    });
    mockContext.loadAdjacentChapter.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => {
      await result.current('continuous-request', payload);
    });
    expect(responses()[0].error).toBe(true);
    await act(async () => {
      await result.current('continuous-request', { ...payload, requestId: 2 });
    });
    expect(responses()[1].chapter.id).toBe(2);
    mockContext.loadAdjacentChapter.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current('continuous-request', { ...payload, requestId: 3 });
    });
    expect(responses()[2].end).toBe(true);
    await act(async () => {
      await result.current('continuous-request', {
        ...payload,
        token: 'obsolete',
        requestId: 4,
      });
    });
    expect(responses()).toHaveLength(3);
  });
});
