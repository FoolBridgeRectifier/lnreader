import { useCallback, useEffect, useRef } from 'react';
import { ChapterInfo } from '@database/types';
import { useChapterContext } from '../ChapterContext';
import { useChapterReaderSettings } from '@hooks/persisted/useSettings';
import { useNovelSettings } from '@hooks/persisted/useNovelSettings';
import { applyTextModifications } from '@utils/customCode';
import { filterChapterText } from '../utils/filterChapterText';

export type ContinuousMessage = {
  token: string;
  chapterId?: number;
  anchorId?: number;
  requestId?: number;
  direction?: 'NEXT' | 'PREV';
  evictedChapters?: { id: number; requestId: number }[];
  progress?: number;
  autoStartTTS?: boolean;
};

export function useContinuousChapters() {
  const {
    continuous,
    documentChapter,
    webViewRef,
    loadAdjacentChapter,
    loadChapterHtml,
    activateContinuousChapter,
    chapterTextCache,
    saveProgress,
  } = useChapterContext();
  const { removeText, replaceText } = useChapterReaderSettings();
  const { chapterTextFilters = [] } = useNovelSettings();

  // Requests can outlive a settings edit. Read the latest edits after loading,
  // rather than applying the settings captured when the request started.
  const editsRef = useRef({ removeText, replaceText, chapterTextFilters });

  useEffect(() => {
    editsRef.current = { removeText, replaceText, chapterTextFilters };
  }, [removeText, replaceText, chapterTextFilters]);

  const session = useRef({
    token: '',
    chapters: new Map<number, ChapterInfo>(),
    pending: new Set<number>(),
    receipts: new Map<number, number>(),
  });

  useEffect(
    () => () => {
      session.current.token = '';
    },
    [],
  );

  useEffect(() => {
    if (!continuous) session.current.token = '';
  }, [continuous]);

  return useCallback(
    async (type: string, data: ContinuousMessage) => {
      if (!continuous || !data || typeof data.token !== 'string') return;
      const current = session.current;

      // A new document invalidates pending work and releases the old window.
      if (type === 'continuous-ready') {
        if (data.chapterId !== documentChapter.id) return;
        chapterTextCache.clear();
        session.current = {
          token: data.token,
          chapters: new Map([[documentChapter.id, documentChapter]]),
          pending: new Set(),
          receipts: new Map([[documentChapter.id, 0]]),
        };
        return;
      }

      if (current.token !== data.token) return;

      if (type === 'continuous-active') {
        const chapter = current.chapters.get(data.chapterId!);
        if (chapter) activateContinuousChapter(chapter);
        return;
      }

      if (type === 'continuous-progress') {
        const chapter = current.chapters.get(data.chapterId!);
        if (
          chapter &&
          typeof data.progress === 'number' &&
          Number.isFinite(data.progress)
        ) {
          saveProgress(data.progress, chapter);
          current.chapters.set(chapter.id, {
            ...chapter,
            progress: Math.max(0, Math.min(100, data.progress)),
          });
        }
        return;
      }

      if (
        type === 'continuous-release' &&
        Array.isArray(data.evictedChapters)
      ) {
        // Only release a transfer the page actually evicted. A retention
        // snapshot can arrive before another direction's reply reaches the DOM.
        for (const { id, requestId } of data.evictedChapters) {
          if (current.receipts.get(id) === requestId) {
            current.chapters.delete(id);
            current.receipts.delete(id);
            chapterTextCache.remove(id);
          }
        }
        return;
      }

      if (
        type !== 'continuous-request' ||
        typeof data.requestId !== 'number' ||
        !['NEXT', 'PREV'].includes(data.direction ?? '') ||
        current.pending.has(data.requestId)
      ) {
        return;
      }
      const anchor = current.chapters.get(data.anchorId!);
      if (!anchor) return;
      current.pending.add(data.requestId);

      const response = {
        token: data.token,
        requestId: data.requestId,
        direction: data.direction,
      };

      const send = (value: object) => {
        if (session.current !== current || current.token !== data.token) return;
        webViewRef.current?.injectJavaScript(
          `window.continuousReader?.receive(${JSON.stringify({
            ...response,
            ...value,
          })}); true;`,
        );
      };

      try {
        const chapter = await loadAdjacentChapter(anchor, data.direction!);
        if (session.current !== current || current.token !== data.token) return;

        if (!chapter) {
          send({ end: true });
          return;
        }

        const raw = await loadChapterHtml(chapter);
        if (session.current !== current) {
          return;
        }
        if ((current.receipts.get(chapter.id) ?? -1) <= data.requestId) {
          current.chapters.set(chapter.id, chapter);
          current.receipts.set(chapter.id, data.requestId);
        }

        const edits = editsRef.current;
        const html = filterChapterText(
          applyTextModifications(raw, edits.removeText, edits.replaceText),
          edits.chapterTextFilters,
        );
        send({ chapter, html });
      } catch {
        send({ error: true });
      } finally {
        current.pending.delete(data.requestId);
      }
    },
    [
      continuous,
      documentChapter,
      chapterTextCache,
      activateContinuousChapter,
      saveProgress,
      loadAdjacentChapter,
      loadChapterHtml,
      webViewRef,
    ],
  );
}
