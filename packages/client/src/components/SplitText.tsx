import { Fragment, useEffect, useRef, useState } from 'react';
import { useSprings, animated, SpringConfig } from '@react-spring/web';

interface SegmenterOptions {
  granularity?: 'grapheme' | 'word' | 'sentence';
  localeMatcher?: 'lookup' | 'best fit';
}

interface SegmentData {
  segment: string;
  index: number;
  input: string;
  isWordLike?: boolean;
}

interface Segments {
  [Symbol.iterator](): IterableIterator<SegmentData>;
}

interface IntlSegmenter {
  segment(input: string): Segments;
}

interface IntlSegmenterConstructor {
  new (locales?: string | string[], options?: SegmenterOptions): IntlSegmenter;
}

declare global {
  interface Intl {
    Segmenter: IntlSegmenterConstructor;
  }
}

interface SplitTextProps {
  text?: string;
  className?: string;
  delay?: number;
  animationFrom?: { opacity: number; transform: string };
  animationTo?: { opacity: number; transform: string };
  easing?: SpringConfig['easing'];
  threshold?: number;
  rootMargin?: string;
  textAlign?: 'left' | 'right' | 'center' | 'justify' | 'start' | 'end';
  onLetterAnimationComplete?: () => void;
  onLineCountChange?: (lineCount: number) => void;
}

const splitGraphemes = (text: string): string[] => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new (Intl as typeof Intl & { Segmenter: IntlSegmenterConstructor }).Segmenter(
      'en',
      { granularity: 'grapheme' },
    );
    const segments = segmenter.segment(text);
    return Array.from(segments).map((s: SegmentData) => s.segment);
  } else {
    return [...text];
  }
};

/**
 * Hebrew, Arabic and the other right-to-left scripts. A per-letter inline-block is shaped on
 * its own, so Arabic letters lose their joins, and bidi treats each block as a neutral object,
 * so the letters follow the container's direction instead of the script's. Text containing
 * these scripts animates word by word as plain inline spans, which the browser shapes and
 * orders like any other text.
 */
const RTL_SCRIPT = /[֐-ࣿיִ-﷿ﹰ-ﻼ\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

const SplitText: React.FC<SplitTextProps> = ({
  text = '',
  className = '',
  delay = 100,
  animationFrom = { opacity: 0, transform: 'translate3d(0,40px,0)' },
  animationTo = { opacity: 1, transform: 'translate3d(0,0,0)' },
  easing = (t: number) => t,
  threshold = 0.1,
  rootMargin = '-100px',
  textAlign = 'center',
  onLetterAnimationComplete,
  onLineCountChange,
}) => {
  const isRtl = RTL_SCRIPT.test(text);
  const words = text.split(' ').map((word) => (isRtl ? [word] : splitGraphemes(word)));
  const letters = words.flat();
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const animatedCount = useRef(0);

  const [springs] = useSprings(
    letters.length,
    (i) => ({
      from: animationFrom,
      to: inView
        ? async (next) => {
            await next(animationTo);
            animatedCount.current += 1;
            if (animatedCount.current === letters.length && onLetterAnimationComplete) {
              onLetterAnimationComplete();
            }
          }
        : animationFrom,
      delay: i * delay,
      config: { easing },
    }),
    [inView, text, delay, animationFrom, animationTo, easing, onLetterAnimationComplete],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (ref.current) {
            observer.unobserve(ref.current);
          }
        }
      },
      { threshold, rootMargin },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  useEffect(() => {
    if (ref.current && inView) {
      const element = ref.current;
      setTimeout(() => {
        const lineHeight =
          parseInt(getComputedStyle(element).lineHeight) ||
          parseInt(getComputedStyle(element).fontSize) * 1.2;
        const height = element.offsetHeight;
        const lines = Math.round(height / lineHeight);

        if (onLineCountChange) {
          onLineCountChange(lines);
        }
      }, 100);
    }
  }, [inView, text, onLineCountChange]);

  return (
    <>
      <span className="sr-only">{text}</span>
      <p
        ref={ref}
        dir="auto"
        className={`split-parent inline overflow-hidden ${className}`}
        style={{ textAlign, whiteSpace: 'normal', wordWrap: 'break-word' }}
        aria-hidden="true"
      >
        {isRtl &&
          words.map(([word], wordIndex) => (
            <Fragment key={wordIndex}>
              <animated.span style={springs[wordIndex]}>{word}</animated.span>
              {wordIndex < words.length - 1 && ' '}
            </Fragment>
          ))}
        {!isRtl &&
          words.map((word, wordIndex) => (
            <span key={wordIndex} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
              {word.map((letter, letterIndex) => {
                const index =
                  words.slice(0, wordIndex).reduce((acc, w) => acc + w.length, 0) + letterIndex;

                return (
                  <animated.span
                    key={index}
                    style={springs[index]}
                    className="inline-block transform transition-opacity will-change-transform"
                  >
                    {letter}
                  </animated.span>
                );
              })}
              {wordIndex < words.length - 1 && (
                <span style={{ display: 'inline-block', width: '0.3em' }}>&nbsp;</span>
              )}
            </span>
          ))}
      </p>
    </>
  );
};

export default SplitText;
