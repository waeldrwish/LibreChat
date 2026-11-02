import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TAttachment } from 'librechat-data-provider';
import { MediaContext } from '~/Providers/MediaContext';
import { buildFilesByName } from '~/utils/media';
import Markdown from '../Markdown';

const report: TAttachment = {
  file_id: 'r1',
  filename: 'report.docx',
  filepath: '/api/files/code/download/sess/abc',
  conversationId: 'c1',
} as unknown as TAttachment;

/** Through the real markdown pipeline, so the `urlTransform` that keeps
 *  `sandbox:` is exercised along with the anchor that resolves it. */
const renderMarkdown = (content: string, attachments: TAttachment[] = [report]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecoilRoot>
        <MediaContext.Provider value={{ filesByName: buildFilesByName(attachments) }}>
          <Markdown content={content} isLatestMessage={false} />
        </MediaContext.Provider>
      </RecoilRoot>
    </QueryClientProvider>,
  );

describe('markdown a', () => {
  it.each([
    ['the sandbox: scheme', 'sandbox:/mnt/data/report.docx'],
    ['a bare sandbox path', '/mnt/data/report.docx'],
    ['a bare filename', 'report.docx'],
  ])('links %s to the file the run produced', (_label, href) => {
    renderMarkdown(`[Download the report](${href})`);
    expect(screen.getByRole('link', { name: 'Download the report' })).toHaveAttribute(
      'href',
      report.filepath,
    );
  });

  it('drops the link for a sandbox file the turn did not deliver', () => {
    renderMarkdown('[Download the report](sandbox:/mnt/data/missing.docx)');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Download the report')).toBeInTheDocument();
  });

  it('leaves an ordinary link alone', () => {
    renderMarkdown('[docs](https://example.com/report.docx)');
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute(
      'href',
      'https://example.com/report.docx',
    );
  });

  it('still blanks a dangerous scheme', () => {
    renderMarkdown('[click](javascript:alert(1))');
    expect(screen.getByText('click').closest('a')?.getAttribute('href') ?? '').not.toMatch(
      /javascript/i,
    );
  });
});
