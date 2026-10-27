import { render, screen, fireEvent, waitFor, act } from '@test-utils';
import ChapterDrawer from '..';

const mockUseNovelValue = jest.fn();
const mockUseNovelActions = jest.fn();
const mockUseChapterContext = jest.fn();
const mockScrollToIndex = jest.fn();
const mockScrollToEnd = jest.fn();
const mockLegendProps = jest.fn();

jest.mock('@hooks/persisted/useTheme');
jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('@screens/novel/NovelContext', () => ({
  useNovelValue: (key: string) => mockUseNovelValue(key),
  useNovelActions: () => mockUseNovelActions(),
}));

jest.mock('@screens/reader/ChapterContext', () => ({
  useChapterContext: () => mockUseChapterContext(),
}));

jest.mock('@hooks/persisted', () => ({
  useTheme: () => ({
    surface: '#111',
    outline: '#222',
    onSurface: '#333',
    onSurfaceVariant: '#444',
  }),
  useAppSettings: () => ({
    defaultChapterSort: 'positionAsc',
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...require('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('@i18n/translations', () => ({
  getString: (key: string) => key,
}));

jest.mock('@components/index', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  return {
    Button: ({ title, onPress }: any) =>
      React.createElement(
        Pressable,
        { testID: `btn-${title}`, onPress },
        React.createElement(Text, null, title),
      ),
    LoadingScreenV2: () => React.createElement(View, { testID: 'loading' }),
  };
});

jest.mock('../RenderListChapter', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');

  return ({ item, onPress }: any) =>
    React.createElement(
      Pressable,
      { testID: `chapter-${item.id}`, onPress },
      React.createElement(Text, null, item.name),
    );
});

jest.mock('@legendapp/list/react-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  return {
    LegendList: React.forwardRef(
      ({ data = [], renderItem, onEndReached, ...props }: any, ref: any) => {
        'use no memo';
        mockLegendProps(props);
        React.useImperativeHandle(ref, () => ({
          scrollToIndex: mockScrollToIndex,
          scrollToEnd: mockScrollToEnd,
        }));
        return React.createElement(
          View,
          null,
          ...data.map((item: any, index: number) =>
            React.createElement(
              React.Fragment,
              { key: item.id ?? index },
              renderItem({ item, index }),
            ),
          ),
          React.createElement(
            Pressable,
            { testID: 'legend-end-reached', onPress: () => onEndReached?.() },
            React.createElement(Text, null, 'end'),
          ),
        );
      },
    ),
  };
});

const makeChapter = (id: number, page = '1') => ({
  id,
  novelId: 7,
  name: `Chapter ${id}`,
  path: `/chapter/${id}`,
  page,
  position: id,
  unread: true,
  isDownloaded: false,
  bookmark: false,
  progress: 0,
  releaseTime: '2026-01-01',
  updatedTime: '2026-01-01',
  readTime: '2026-01-01',
});

const createStore = (overrides: Record<string, unknown> = {}) => {
  const state = {
    chapters: [makeChapter(1, '1'), makeChapter(2, '2')],
    novelSettings: { sort: 'positionAsc', filter: [] },
    pages: ['1', '2'],
    fetching: false,
    batchInformation: { batch: 0, total: 1, totalChapters: 2 },
    getNextChapterBatch: jest.fn(),
    setPageIndex: jest.fn(),
    openPage: jest.fn(),
    ...overrides,
  };

  return {
    getState: () => state,
    subscribe: jest.fn(() => () => {}),
    state,
  };
};

describe('ChapterDrawer (task 12 context boundary cutover)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses novelStore selector-backed page index and pagination batch actions', async () => {
    const store = createStore();
    mockUseChapterContext.mockReturnValue({
      chapter: makeChapter(10, '2'),
      getChapter: jest.fn(),
      setLoading: jest.fn(),
    });
    mockUseNovelValue.mockImplementation(
      (key: keyof typeof store.state) => store.state[key],
    );
    mockUseNovelActions.mockReturnValue({
      getNextChapterBatch: store.state.getNextChapterBatch,
      openPage: store.state.openPage,
    });

    render(<ChapterDrawer />);

    await waitFor(() => {
      expect(store.state.openPage).toHaveBeenCalledWith(1);
    });

    fireEvent.press(screen.getByTestId('legend-end-reached'));

    expect(store.state.getNextChapterBatch).toHaveBeenCalledTimes(1);
  });

  it.each(['positionAsc', 'positionDesc'])(
    'scrolls to the top, bottom, and current row in %s order',
    sort => {
      const chapters = Array.from({ length: 8 }, (_, index) =>
        makeChapter(index + 1),
      );
      if (sort.endsWith('Desc')) chapters.reverse();
      const store = createStore({
        chapters,
        novelSettings: { sort, filter: [] },
      });
      mockUseChapterContext.mockReturnValue({
        chapter: chapters[4],
        getChapter: jest.fn(),
        setLoading: jest.fn(),
      });
      mockUseNovelValue.mockImplementation(
        (key: keyof typeof store.state) => store.state[key],
      );
      mockUseNovelActions.mockReturnValue(store.state);
      render(<ChapterDrawer />);

      fireEvent.press(
        screen.getByTestId('btn-readerScreen.drawer.scrollToTop'),
      );
      expect(mockScrollToIndex).toHaveBeenLastCalledWith({
        index: 0,
        animated: true,
      });
      fireEvent.press(
        screen.getByTestId('btn-readerScreen.drawer.scrollToBottom'),
      );
      expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });

      for (const [visibleIndex, buttonIndex] of [
        [0, 1],
        [7, 0],
      ]) {
        act(() => {
          mockLegendProps.mock.lastCall[0].onViewableItemsChanged({
            viewableItems: [{ index: visibleIndex }],
          });
        });
        const buttons = screen.getAllByTestId(/^btn-/);
        expect(buttons[buttonIndex].props.testID).toBe(
          'btn-readerScreen.drawer.scrollToCurrentChapter',
        );
        fireEvent.press(buttons[buttonIndex]);
        expect(mockScrollToIndex).toHaveBeenLastCalledWith({
          index: 2,
          animated: true,
        });
      }
    },
  );
});
