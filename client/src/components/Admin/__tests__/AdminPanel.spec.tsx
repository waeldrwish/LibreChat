import React from 'react';
import { render, screen } from '@testing-library/react';
import AdminPanel from '../AdminPanel';

const mockNavigate = jest.fn();
const mockSummary = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider/AdminPanel', () => ({
  useAdminPanelSummary: () => mockSummary(),
  useAdminPanelUsage: () => ({ data: undefined, isError: false, error: undefined }),
  useAdminPanelUsers: () => ({ data: { users: [], total: 0 } }),
  useAdminPanelBalance: () => ({ data: undefined }),
  useCreateAdminPanelUser: () => ({ mutate: jest.fn(), isError: false, isLoading: false }),
  useUpdateAdminPanelBalance: () => ({ mutate: jest.fn(), isLoading: false, isSuccess: false }),
}));

describe('AdminPanel access gate', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSummary.mockReset();
  });

  it('renders nothing and redirects to chat when the caller is denied', () => {
    mockSummary.mockReturnValue({
      isSuccess: false,
      error: { response: { status: 403 } },
    });
    const { container } = render(<AdminPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true });
  });

  it('does not redirect on a non-access failure and keeps the page hidden', () => {
    mockSummary.mockReturnValue({
      isSuccess: false,
      error: { response: { status: 500 } },
    });
    const { container } = render(<AdminPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders the panel with its tabs once access is granted', () => {
    mockSummary.mockReturnValue({
      isSuccess: true,
      error: null,
      data: { users: 2, requests: 5, inputTokens: 100, spentCredits: 1500, range: {} },
    });
    render(<AdminPanel />);
    expect(screen.getByText('com_admin_title')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
