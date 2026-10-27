import { fireEvent, render, screen } from '@test-utils';
import ReaderFooter from '../ReaderFooter';

const mockContext = {
  continuous: true,
  nextChapter: undefined as { id: number } | undefined,
  prevChapter: undefined as { id: number } | undefined,
  navigateChapter: jest.fn(),
};

jest.mock('../../ChapterContext', () => ({
  useChapterContext: () => mockContext,
}));
jest.mock('@hooks/persisted/useTheme');
jest.mock('@hooks/persisted', () => ({
  useTheme: () => require('@hooks/persisted/useTheme').mockTheme,
}));
jest.mock('@screens/novel/NovelContext', () => ({
  NovelContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useNovelLayout: () => ({ navigationBarHeight: 0 }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@i18n/translations', () => ({ getString: (key: string) => key }));

describe('reader footer controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContext.continuous = true;
    mockContext.nextChapter = undefined;
    mockContext.prevChapter = undefined;
  });

  it('handles taps on each icon and permits continuous navigation while chapters are loading', () => {
    const scrollToStart = jest.fn();
    const openDrawer = jest.fn();
    const openReaderSheet = jest.fn();
    render(
      <ReaderFooter {...{ scrollToStart, openDrawer, openReaderSheet }} />,
    );

    fireEvent.press(
      screen.getByLabelText('readerScreen.previousChapterButton'),
    );
    fireEvent.press(screen.getByLabelText('readerScreen.nextChapterButton'));
    fireEvent.press(screen.getByLabelText('readerScreen.drawer.scrollToTop'));
    fireEvent.press(screen.getByLabelText('common.chapters'));
    fireEvent.press(screen.getByLabelText('common.settings'));

    expect(mockContext.navigateChapter.mock.calls).toEqual([
      ['PREV'],
      ['NEXT'],
    ]);
    expect(scrollToStart).toHaveBeenCalledTimes(1);
    expect(openDrawer).toHaveBeenCalledTimes(1);
    expect(openReaderSheet).toHaveBeenCalledTimes(1);
  });

  it('disables unavailable chapters in normal reading mode', () => {
    mockContext.continuous = false;
    render(
      <ReaderFooter
        scrollToStart={jest.fn()}
        openDrawer={jest.fn()}
        openReaderSheet={jest.fn()}
      />,
    );
    const previous = screen.getByLabelText(
      'readerScreen.previousChapterButton',
    );
    const next = screen.getByLabelText('readerScreen.nextChapterButton');
    expect(previous).toBeDisabled();
    expect(next).toBeDisabled();
    fireEvent.press(previous);
    fireEvent.press(next);
    expect(mockContext.navigateChapter).not.toHaveBeenCalled();
  });
});
