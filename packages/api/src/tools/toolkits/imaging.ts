import { DEFAULT_OPENAI_IMAGE_MODEL } from 'librechat-data-provider';
import type { TImageGenerationConfig } from 'librechat-data-provider';

export const OPENAI_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenAIImageQuality = (typeof OPENAI_IMAGE_QUALITIES)[number];

type ImageModelCapabilities = {
  /** `xhigh` and `max` quality tiers. */
  extendedQuality: boolean;
  /** Any `WIDTHxHEIGHT` within the API's limits rather than the three standard sizes. */
  customSizes: boolean;
};

/** The sizes every GPT Image model accepts. */
const STANDARD_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);
const SIZE_STEP = 16;
const MAX_EDGE = 3840;
const MAX_ASPECT_RATIO = 3;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;

/**
 * What a GPT Image model supports, by family. An unrecognized name (an Azure deployment,
 * a newer model) returns `undefined` and is passed through for the API to judge.
 */
export function imageModelCapabilities(model: string): ImageModelCapabilities | undefined {
  if (model.startsWith('gpt-image-2.5')) {
    return { extendedQuality: true, customSizes: true };
  }
  if (model.startsWith('gpt-image-2')) {
    return { extendedQuality: false, customSizes: true };
  }
  if (model.startsWith('gpt-image-1')) {
    return { extendedQuality: false, customSizes: false };
  }
  return undefined;
}

/** Model from the admin panel or `librechat.yaml`, then `IMAGE_GEN_OAI_MODEL`, then the default. */
export function resolveOpenAIImageModel(
  config: TImageGenerationConfig | null | undefined,
  env: Record<string, string | undefined>,
): string {
  return config?.openai?.model || env.IMAGE_GEN_OAI_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
}

/** Steps `xhigh`/`max` down to `high` on models that stop there. */
export function resolveImageQuality(model: string, quality: string): string {
  const capabilities = imageModelCapabilities(model);
  if (capabilities && !capabilities.extendedQuality && (quality === 'xhigh' || quality === 'max')) {
    return 'high';
  }
  return quality;
}

/**
 * Why `size` will not work for `model`, phrased for the agent to correct its call, or
 * `undefined` when it will (or the model is unrecognized and the API should decide).
 */
export function checkImageSize(model: string, size: string): string | undefined {
  const capabilities = imageModelCapabilities(model);
  if (!capabilities || STANDARD_SIZES.has(size)) {
    return undefined;
  }
  if (!capabilities.customSizes) {
    return `${model} only supports ${[...STANDARD_SIZES].join(', ')}.`;
  }
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) {
    return 'Size must be auto or WIDTHxHEIGHT, e.g. 2048x2048.';
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const longest = Math.max(width, height);
  const pixels = width * height;
  if (width % SIZE_STEP !== 0 || height % SIZE_STEP !== 0) {
    return `Both dimensions must be multiples of ${SIZE_STEP}.`;
  }
  if (longest > MAX_EDGE) {
    return `No side may exceed ${MAX_EDGE} pixels.`;
  }
  if (longest / Math.min(width, height) > MAX_ASPECT_RATIO) {
    return `The aspect ratio may not exceed ${MAX_ASPECT_RATIO}:1.`;
  }
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) {
    return `The image must have between ${MIN_PIXELS} and ${MAX_PIXELS} pixels in total.`;
  }
  return undefined;
}
