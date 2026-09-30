import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OGDialog, OGDialogContent, OGDialogTitle } from './OriginalDialog';
import MultiSelect from './MultiSelect';

function DialogWithSelect({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogContent>
        <OGDialogTitle>Edit user</OGDialogTitle>
        <MultiSelect
          portal={false}
          label="Groups"
          placeholder="Pick groups"
          items={['Finance', 'Legal']}
          selectedValues={values}
          setSelectedValues={setValues}
        />
        <output data-testid="picked">{values.join(',')}</output>
      </OGDialogContent>
    </OGDialog>
  );
}

describe('MultiSelect inside a dialog', () => {
  it('opens its options within the dialog and keeps the dialog open while picking', async () => {
    const onOpenChange = jest.fn();
    render(<DialogWithSelect onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Legal' });
    expect(screen.getByRole('dialog', { name: 'Edit user' })).toContainElement(option);

    fireEvent.click(option);
    await waitFor(() => expect(screen.getByTestId('picked')).toHaveTextContent('Legal'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
