import { useState } from 'react';
import { Button, Spinner, Dropdown, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TAdminImageSettings } from 'librechat-data-provider';
import { useUpdateAdminToolMutation } from '~/data-provider';
import { useAdminNotify } from '../common/ui';
import { Field } from '../common/controls';
import { useLocalize } from '~/hooks';

/** Leaves the choice to `IMAGE_GEN_OAI_MODEL` or the built-in default. */
const SERVER_DEFAULT = '__server__';
const STANDARD_MODERATION = 'auto';

export default function ImageSettingsDialog({
  toolKey,
  toolName,
  settings,
  onClose,
}: {
  toolKey: string;
  toolName: string;
  settings: TAdminImageSettings;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const notify = useAdminNotify();
  const update = useUpdateAdminToolMutation();
  const [model, setModel] = useState(
    settings.modelSource === 'panel' ? settings.model : SERVER_DEFAULT,
  );
  const [moderation, setModeration] = useState<string>(settings.moderation ?? STANDARD_MODERATION);

  const models = settings.models.includes(settings.model)
    ? settings.models
    : [settings.model, ...settings.models];

  const save = () =>
    update.mutate(
      {
        key: toolKey,
        update: {
          imageSettings: {
            model: model === SERVER_DEFAULT ? null : model,
            moderation: moderation === STANDARD_MODERATION ? null : 'low',
          },
        },
      },
      {
        onSuccess: () => {
          notify.success(localize('com_admin_saved'));
          onClose();
        },
        onError: notify.error,
      },
    );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_tool_settings_title', { 0: toolName })}
        className="max-w-lg"
        main={
          <div className="flex flex-col gap-4">
            <Field
              label={localize('com_admin_tool_image_model')}
              hint={localize('com_admin_tool_image_model_hint')}
            >
              {() => (
                <Dropdown
                  portal={false}
                  variant="field"
                  ariaLabel={localize('com_admin_tool_image_model')}
                  value={model}
                  onChange={setModel}
                  options={[
                    { value: SERVER_DEFAULT, label: localize('com_admin_tool_image_model_server') },
                    ...models.map((item) => ({ value: item, label: item })),
                  ]}
                />
              )}
            </Field>
            <Field
              label={localize('com_admin_tool_image_moderation')}
              hint={localize('com_admin_tool_image_moderation_hint')}
            >
              {() => (
                <Dropdown
                  portal={false}
                  variant="field"
                  ariaLabel={localize('com_admin_tool_image_moderation')}
                  value={moderation}
                  onChange={setModeration}
                  options={[
                    {
                      value: STANDARD_MODERATION,
                      label: localize('com_admin_tool_moderation_auto'),
                    },
                    { value: 'low', label: localize('com_admin_tool_moderation_low') },
                  ]}
                />
              )}
            </Field>
          </div>
        }
        selection={
          <Button onClick={save} disabled={update.isLoading}>
            {update.isLoading ? <Spinner className="size-4" /> : localize('com_admin_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
