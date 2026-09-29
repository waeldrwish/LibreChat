import type { UsageLimitMetric } from 'librechat-data-provider';
import type { ErrorRendererProps } from './parts';
import type { TranslationKeys } from '~/hooks';
import { ErrorBody, formatNumber, formatTimestamp, readNumber, readString } from './parts';
import { useLocalize } from '~/hooks';

const HEADLINES: Record<UsageLimitMetric, TranslationKeys> = {
  tokensPerDay: 'com_error_usage_limit_tokens_day',
  tokensPerMonth: 'com_error_usage_limit_tokens_month',
  messagesPerDay: 'com_error_usage_limit_messages_day',
  messagesPerMonth: 'com_error_usage_limit_messages_month',
};

/** An administrator-assigned usage limit refused the turn; says which one and when it resets. */
export default function UsageLimitError({ json }: ErrorRendererProps) {
  const localize = useLocalize();
  const metric = readString(json, 'metric') as UsageLimitMetric | undefined;
  const limit = readNumber(json, 'limit');
  const resetAt = readString(json, 'resetAt');
  const headlineKey = metric ? HEADLINES[metric] : undefined;

  return (
    <ErrorBody>
      <p>
        {headlineKey && limit != null
          ? localize(headlineKey, { 0: formatNumber(limit) })
          : localize('com_error_usage_limit')}
      </p>
      {resetAt && (
        <p className="text-text-secondary">
          {localize('com_error_usage_limit_reset', { 0: formatTimestamp(resetAt) })}
        </p>
      )}
      <p className="text-text-secondary">{localize('com_error_usage_limit_contact')}</p>
    </ErrorBody>
  );
}
