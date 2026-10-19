import { render } from '@testing-library/react';
import SplitText from './SplitText';

describe('SplitText', () => {
  it('renders emojis correctly', () => {
    const emojis = ['🚧', '❤️‍🔥', '💜', '🦎', '❌', '✅', '⚠️'];
    const originalText = emojis.join('');

    const { container } = render(<SplitText text={originalText} />);
    const textSpans = container.querySelectorAll('p > span > span.inline-block');

    // Reconstruct the text by joining all span contents
    const reconstructedText = Array.from(textSpans)
      .map((span) => span.textContent)
      .join('')
      .trim();
    // Compare the reconstructed text with the original
    expect(reconstructedText).toBe(originalText);

    // Check the first character specifically as the reconstructed text could hide issues
    for (let i = 0; i < emojis.length; i++) {
      expect(Array.from(textSpans)[i].textContent).toBe(emojis[i]);
    }
  });

  it('splits left-to-right text into per-letter blocks inside an auto-direction paragraph', () => {
    const { container } = render(<SplitText text="Hi there" />);
    const paragraph = container.querySelector('p');
    const letters = Array.from(container.querySelectorAll('p > span > span.inline-block'));

    expect(paragraph?.getAttribute('dir')).toBe('auto');
    expect(letters.map((span) => span.textContent)).toEqual(['H', 'i', 't', 'h', 'e', 'r', 'e']);
  });

  it.each([
    ['Arabic', 'وكيل ثاني', ['وكيل', 'ثاني']],
    ['Hebrew', 'סוכן שני', ['סוכן', 'שני']],
    ['mixed-direction', 'مساعد ChatGPT Pro', ['مساعد', 'ChatGPT', 'Pro']],
  ])(
    'keeps %s words whole as inline text so letters join and bidi orders them',
    (_, text, expected) => {
      const { container } = render(<SplitText text={text} />);
      const paragraph = container.querySelector('p');
      const words = Array.from(container.querySelectorAll('p > span'));

      expect(paragraph?.getAttribute('dir')).toBe('auto');
      expect(paragraph?.textContent).toBe(text);
      expect(container.querySelectorAll('.inline-block')).toHaveLength(0);
      expect(words.map((span) => span.textContent)).toEqual(expected);
    },
  );
});
