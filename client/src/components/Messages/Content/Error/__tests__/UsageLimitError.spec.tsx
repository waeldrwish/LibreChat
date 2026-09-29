import React from 'react';
import { render, screen } from '@testing-library/react';
import { ViolationTypes } from 'librechat-data-provider';
import UsageLimitError from '../UsageLimitError';
import { errorRenderers } from '../registry';

describe('UsageLimitError', () => {
  it('is the renderer for usage-limit refusals', () => {
    expect(errorRenderers[ViolationTypes.USAGE_LIMIT]).toBe(UsageLimitError);
  });

  it('names the exhausted allowance and tells the user who to contact', () => {
    render(
      <UsageLimitError
        text=""
        json={{
          type: 'usage_limit',
          metric: 'messagesPerDay',
          limit: 20,
          used: 20,
          resetAt: '2026-10-01T00:00:00.000Z',
        }}
      />,
    );
    /** The count is formatted in the runtime's default locale, so only the wording is pinned. */
    expect(
      screen.getByText(/You have sent your daily allowance of .+ messages\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your allowance resets on/)).toBeInTheDocument();
    expect(screen.getByText('Contact your administrator if you need more.')).toBeInTheDocument();
  });

  it('falls back to a generic message for an unknown metric', () => {
    render(<UsageLimitError text="" json={{ type: 'usage_limit' }} />);
    expect(
      screen.getByText('You have reached a usage limit set by your administrator.'),
    ).toBeInTheDocument();
  });
});
