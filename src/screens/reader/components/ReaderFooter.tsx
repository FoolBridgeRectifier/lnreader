import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import color from 'color';
import Animated, {
  Easing,
  ReduceMotion,
  withTiming,
} from 'react-native-reanimated';
import { useChapterContext } from '../ChapterContext';
import { useTheme } from '@hooks/persisted';
import { useNovelLayout } from '@screens/novel/NovelContext';
import { getString } from '@i18n/translations';

interface ChapterFooterProps {
  openReaderSheet: () => void;
  scrollToStart: () => void;
  openDrawer: () => void;
}

const fastOutSlowIn = Easing.bezier(0.4, 0.0, 0.2, 1.0);

const createEntering = (navigationBarHeight: number) => () => {
  'worklet';
  const animations = {
    transform: [
      {
        translateY: withTiming(0, {
          duration: 250,
          easing: fastOutSlowIn,
          reduceMotion: ReduceMotion.System,
        }),
      },
    ],
    opacity: withTiming(1, { duration: 150 }),
  };
  const initialValues = {
    transform: [{ translateY: 64 + navigationBarHeight }],
    opacity: 0,
  };
  return { initialValues, animations };
};

const createExiting = (navigationBarHeight: number) => () => {
  'worklet';
  const animations = {
    transform: [
      {
        translateY: withTiming(64 + navigationBarHeight, {
          duration: 250,
          easing: fastOutSlowIn,
          reduceMotion: ReduceMotion.System,
        }),
      },
    ],
    opacity: withTiming(0, { duration: 150 }),
  };
  const initialValues = {
    transform: [{ translateY: 0 }],
    opacity: 1,
  };
  return { initialValues, animations };
};

const ChapterFooter = ({
  openReaderSheet,
  scrollToStart,
  openDrawer,
}: ChapterFooterProps) => {
  const { continuous, nextChapter, prevChapter, navigateChapter } =
    useChapterContext();
  const theme = useTheme();
  const { navigationBarHeight } = useNovelLayout();

  const style = useMemo(
    () => [
      {
        backgroundColor: color(theme.surface).alpha(0.9).string(),
        paddingBottom: navigationBarHeight,
      },
    ],
    [theme.surface, navigationBarHeight],
  );

  const entering = useMemo(
    () => createEntering(navigationBarHeight),
    [navigationBarHeight],
  );
  const exiting = useMemo(
    () => createExiting(navigationBarHeight),
    [navigationBarHeight],
  );

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      style={[styles.footer, style]}
    >
      <View style={styles.buttonsContainer}>
        <View style={styles.buttonStyles}>
          <IconButton
            onPress={() => navigateChapter('PREV')}
            accessibilityLabel={getString('readerScreen.previousChapterButton')}
            icon="chevron-left"
            size={26}
            disabled={!continuous && !prevChapter}
            iconColor={theme.onSurface}
          />
        </View>
        <View style={styles.buttonStyles}>
          <IconButton
            onPress={scrollToStart}
            accessibilityLabel={getString('readerScreen.drawer.scrollToTop')}
            icon="arrow-collapse-up"
            size={26}
            iconColor={theme.onSurface}
          />
        </View>
        <View style={styles.buttonStyles}>
          <IconButton
            onPress={openDrawer}
            accessibilityLabel={getString('common.chapters')}
            icon="format-list-bulleted"
            size={26}
            iconColor={theme.onSurface}
          />
        </View>
        <View style={styles.buttonStyles}>
          <IconButton
            onPress={openReaderSheet}
            accessibilityLabel={getString('common.settings')}
            icon="cog-outline"
            size={26}
            iconColor={theme.onSurface}
          />
        </View>
        <View style={styles.buttonStyles}>
          <IconButton
            onPress={() => navigateChapter('NEXT')}
            accessibilityLabel={getString('readerScreen.nextChapterButton')}
            icon="chevron-right"
            size={26}
            disabled={!continuous && !nextChapter}
            iconColor={theme.onSurface}
          />
        </View>
      </View>
    </Animated.View>
  );
};

export default React.memo(ChapterFooter);

const styles = StyleSheet.create({
  buttonStyles: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 4,
    paddingVertical: 8,
  },
  buttonsContainer: {
    flexDirection: 'row',
  },
  footer: {
    bottom: 0,
    flex: 1,
    position: 'absolute',
    width: '100%',
    zIndex: 1,
  },
});
