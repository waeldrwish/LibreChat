import { DEFAULT_OPENAI_IMAGE_MODEL } from 'librechat-data-provider';
import {
  checkImageSize,
  resolveImageQuality,
  imageModelCapabilities,
  resolveOpenAIImageModel,
} from './imaging';

describe('imageModelCapabilities', () => {
  it('knows each GPT Image family, including dated snapshots', () => {
    expect(imageModelCapabilities('gpt-image-2.5-flare-2026-09-08')).toEqual({
      extendedQuality: true,
      customSizes: true,
    });
    expect(imageModelCapabilities('gpt-image-2')).toEqual({
      extendedQuality: false,
      customSizes: true,
    });
    expect(imageModelCapabilities('gpt-image-1-mini')).toEqual({
      extendedQuality: false,
      customSizes: false,
    });
  });

  it('leaves unknown names to the API', () => {
    expect(imageModelCapabilities('my-azure-deployment')).toBeUndefined();
  });
});

describe('resolveOpenAIImageModel', () => {
  it('prefers the panel setting, then the environment, then the default', () => {
    const env = { IMAGE_GEN_OAI_MODEL: 'gpt-image-1.5' };
    expect(resolveOpenAIImageModel({ openai: { model: 'gpt-image-2.5-flare' } }, env)).toBe(
      'gpt-image-2.5-flare',
    );
    expect(resolveOpenAIImageModel({}, env)).toBe('gpt-image-1.5');
    expect(resolveOpenAIImageModel(undefined, {})).toBe(DEFAULT_OPENAI_IMAGE_MODEL);
  });
});

describe('resolveImageQuality', () => {
  it('keeps the new tiers on models that have them', () => {
    expect(resolveImageQuality('gpt-image-2.5-sunburst', 'max')).toBe('max');
  });

  it('steps them down to high elsewhere', () => {
    expect(resolveImageQuality('gpt-image-1', 'xhigh')).toBe('high');
    expect(resolveImageQuality('gpt-image-2', 'max')).toBe('high');
    expect(resolveImageQuality('gpt-image-1', 'medium')).toBe('medium');
  });
});

describe('checkImageSize', () => {
  it('accepts the standard sizes everywhere', () => {
    expect(checkImageSize('gpt-image-1', '1536x1024')).toBeUndefined();
    expect(checkImageSize('gpt-image-2.5-flare', 'auto')).toBeUndefined();
  });

  it('refuses custom sizes on models without them', () => {
    expect(checkImageSize('gpt-image-1', '2048x2048')).toContain('only supports');
  });

  it('applies the custom size limits', () => {
    expect(checkImageSize('gpt-image-2.5-flare', '3840x2160')).toBeUndefined();
    expect(checkImageSize('gpt-image-2.5-flare', '2050x2048')).toContain('multiples of 16');
    expect(checkImageSize('gpt-image-2.5-flare', '4096x2048')).toContain('3840');
    expect(checkImageSize('gpt-image-2.5-flare', '3840x1024')).toContain('aspect ratio');
    expect(checkImageSize('gpt-image-2.5-flare', '640x640')).toContain('pixels');
    expect(checkImageSize('gpt-image-2', 'large')).toContain('WIDTHxHEIGHT');
  });

  it('lets unknown models through', () => {
    expect(checkImageSize('my-azure-deployment', '999x999')).toBeUndefined();
  });
});
