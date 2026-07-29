import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthedWrapper } from '../../test-utils';
import { MediaKindTabs } from './MediaKindTabs';

afterEach(cleanup);

function renderTabs(value: 'all' | 'image' | 'video', onChange = vi.fn()) {
  render(
    <AuthedWrapper>
      <MediaKindTabs value={value} onChange={onChange} counts={{ all: 30, image: 20, video: 10 }} />
    </AuthedWrapper>,
  );
  return onChange;
}

describe('MediaKindTabs', () => {
  it('renders a tablist with three tabs and marks the active one', () => {
    renderTabs('all');
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByTestId('media-kind-tab-all')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('media-kind-tab-image')).toHaveAttribute('aria-selected', 'false');
  });

  it('shows server counts', () => {
    renderTabs('all');
    expect(screen.getByTestId('media-kind-count-all')).toHaveTextContent('30');
    expect(screen.getByTestId('media-kind-count-image')).toHaveTextContent('20');
    expect(screen.getByTestId('media-kind-count-video')).toHaveTextContent('10');
  });

  it('calls onChange when a tab is clicked', async () => {
    const onChange = renderTabs('all');
    await userEvent.click(screen.getByTestId('media-kind-tab-video'));
    expect(onChange).toHaveBeenCalledWith('video');
  });

  it('supports arrow-key navigation with wrap-around', async () => {
    const onChange = renderTabs('all');
    screen.getByTestId('media-kind-tab-all').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('image');
    // Left from the first tab wraps to the last.
    screen.getByTestId('media-kind-tab-all').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('video');
    screen.getByTestId('media-kind-tab-all').focus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('video');
  });

  it('uses a roving tabindex (only the active tab is tabbable)', () => {
    renderTabs('image');
    expect(screen.getByTestId('media-kind-tab-image')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('media-kind-tab-all')).toHaveAttribute('tabindex', '-1');
  });
});
